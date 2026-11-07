"""Read-only CPython 3.12 x64 await-chain inspection on Windows.

Uses PROCESS_VM_READ only; never suspends, injects into, or changes the target.
Prints code identities and await types, never request bodies or credentials.
Offsets correspond to the installed Python 3.12 headers.
"""
import ctypes
from ctypes import wintypes
import json
import re
import struct
import subprocess
import sys
import time


kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.ReadProcessMemory.argtypes = (wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t))
kernel.ReadProcessMemory.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = (wintypes.HANDLE,)


class Reader:
    def __init__(self, pid):
        self.handle = kernel.OpenProcess(0x10, False, pid)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())

    def read(self, address, size):
        if address < 0x10000 or not 0 < size <= 65536:
            raise ValueError("Invalid read bounds")
        buffer = ctypes.create_string_buffer(size)
        count = ctypes.c_size_t()
        if not kernel.ReadProcessMemory(self.handle, address, buffer, size, ctypes.byref(count)) or count.value != size:
            raise ctypes.WinError(ctypes.get_last_error())
        return buffer.raw

    def ptr(self, address):
        return struct.unpack("<Q", self.read(address, 8))[0]

    def integer(self, address):
        return struct.unpack("<i", self.read(address, 4))[0]

    def type_name(self, address):
        type_ptr = self.ptr(address + 8)
        name_ptr = self.ptr(type_ptr + 24)
        return self.read(name_ptr, 128).split(b"\0", 1)[0].decode("ascii", "replace")

    def text(self, address):
        header = self.read(address, 40)
        length = struct.unpack_from("<q", header, 16)[0]
        flags = struct.unpack_from("<I", header, 32)[0]
        kind, compact, ascii_only = (flags >> 2) & 7, (flags >> 5) & 1, (flags >> 6) & 1
        if not compact or not 0 <= length <= 4096 or kind not in (1, 2, 4):
            raise ValueError("Unexpected Unicode layout")
        if not length:
            return ""
        raw = self.read(address + (40 if ascii_only else 56), length * kind)
        return raw.decode({1: "latin1", 2: "utf-16-le", 4: "utf-32-le"}[kind])

    def chain(self, address):
        result, seen = [], set()
        for _ in range(100):
            if address in seen:
                break
            seen.add(address)
            kind = self.type_name(address)
            entry = {"type": kind, "address": hex(address)}
            result.append(entry)
            if kind not in ("coroutine", "generator", "async_generator"):
                # CPython async-generator asend/athrow objects store ag_gen
                # immediately after PyObject_HEAD.
                if kind in ("async_generator_asend", "async_generator_athrow"):
                    address = self.ptr(address + 16)
                    continue
                break
            frame = address + 72
            code = self.ptr(frame)
            entry.update(name=self.text(self.ptr(code + 128)), file=self.text(self.ptr(code + 112)), first_line=self.integer(code + 68))
            entry["instruction_offset"] = self.ptr(frame + 56) - (code + 192)
            state = struct.unpack("<b", self.read(address + 67, 1))[0]
            entry["frame_state"] = state
            stack_top = self.integer(frame + 64)
            nlocals = self.integer(code + 72)
            entry["diagnostic_locals"] = self.safe_locals(frame, code, nlocals)
            exception = self.ptr(address + 40)
            if exception and self.type_name(exception) != "NoneType":
                entry["handled_exception"] = self.exception_chain(exception)
            if state != -1 or not 0 <= nlocals < stack_top <= 4096:
                break
            address = self.ptr(frame + 72 + 8 * (stack_top - 1))
        return result

    def safe_locals(self, frame, code, count):
        allowed = {"deadline", "budget", "attempt_timeout", "delay", "attempt", "max_attempts", "response", "paragraph", "content", "stream", "writing", "exhausted", "timeout", "chunk_timeout", "chunks_received", "chunk", "is_first_chunk", "first_chunk", "completed", "report"}
        values = {}
        if not 0 <= count <= 4096:
            return values
        names = self.ptr(code + 96)
        for index in range(count):
            name = self.text(self.ptr(names + 24 + index * 8))
            if name not in allowed:
                continue
            ptr = self.ptr(frame + 72 + index * 8)
            if not ptr:
                continue
            kind = self.type_name(ptr)
            if kind == "cell":
                ptr = self.ptr(ptr + 16)
                if not ptr:
                    continue
                kind = self.type_name(ptr)
            if kind == "str":
                values[name] = {"type": kind, "characters": struct.unpack("<q", self.read(ptr + 16, 8))[0]}
            elif kind == "float":
                values[name] = struct.unpack("<d", self.read(ptr + 16, 8))[0]
            elif kind in ("int", "bool"):
                tag = self.ptr(ptr + 16)
                digits = tag >> 3
                if digits <= 2:
                    number = sum(struct.unpack("<I", self.read(ptr + 24 + j * 4, 4))[0] << (30 * j) for j in range(digits))
                    if tag & 3 == 2:
                        number = -number
                    values[name] = bool(number) if kind == "bool" else number
            elif kind == "NoneType":
                values[name] = None
            elif name == "chunk" and kind == "dict":
                values[name] = self.chunk_summary(ptr)
        return values

    def dict_items(self, ptr):
        keys, split_values = self.ptr(ptr + 32), self.ptr(ptr + 40)
        header = self.read(keys, 32)
        log_index, kind = header[9], header[10]
        count = struct.unpack_from("<q", header, 24)[0]
        if not 0 <= count <= 500 or log_index > 16:
            return {}
        entries, result = keys + 32 + (1 << log_index), {}
        for i in range(count):
            key_offset, value_offset, stride = (8, 16, 24) if kind == 0 else (0, 8, 16)
            key = self.ptr(entries + i * stride + key_offset)
            value = self.ptr(split_values + i * 8) if split_values else self.ptr(entries + i * stride + value_offset)
            if key and value and self.type_name(key) == "str":
                result[self.text(key)] = value
        return result

    def chunk_summary(self, ptr):
        result = {}
        items = self.dict_items(ptr)
        for key in ("choices", "delta", "content", "reasoning", "reasoning_content", "finish_reason", "usage"):
            if key not in items:
                continue
            value = items[key]
            kind = self.type_name(value)
            if kind == "str":
                result[key] = {"characters": struct.unpack("<q", self.read(value + 16, 8))[0]}
                if key == "finish_reason":
                    reason = self.text(value)
                    if reason in ("stop", "length", "tool_calls", "content_filter"):
                        result[key] = reason
            elif kind == "NoneType":
                result[key] = None
            elif kind == "dict":
                result[key] = self.chunk_summary(value)
            elif key == "choices" and kind == "list":
                size = self.ptr(value + 16)
                if 0 < size <= 5:
                    array = self.ptr(value + 24)
                    result[key] = [self.chunk_summary(self.ptr(array + i * 8)) for i in range(size)]
        return result

    def exception_chain(self, ptr):
        result, seen = [], set()
        while ptr and ptr not in seen and len(result) < 8:
            seen.add(ptr)
            kind = self.type_name(ptr)
            if kind == "NoneType":
                break
            entry = {"type": kind}
            args = self.ptr(ptr + 24)
            if args and self.type_name(args) == "tuple" and self.ptr(args + 16):
                arg = self.ptr(args + 24)
                if self.type_name(arg) == "str":
                    try:
                        message = self.text(arg)
                        entry["classification"] = [label for label, phrase in (("empty_response", "empty response"), ("provider_request_failed", "failed to get response"), ("timeout", "timeout"), ("timeout", "timed out"), ("context_limit", "context length")) if phrase in message.lower()]
                        entry["http_status"] = re.findall(r"(?:HTTP|Error code:)\s*(\d{3})", message)
                    except ValueError:
                        entry["message_too_long"] = True
            result.append(entry)
            ptr = self.ptr(ptr + 56) or self.ptr(ptr + 48)
        return result


def main():
    pid = int(sys.argv[1])
    output = subprocess.check_output(["uv", "tool", "run", "--from", "py-spy", "py-spy", "dump", "--pid", str(pid), "--nonblocking", "--json", "--locals"], text=True, encoding="utf-8")
    threads = json.loads(output)
    root = next(local["addr"] for thread in threads for frame in thread["frames"] if frame["name"] == "Runner.run" for local in frame.get("locals", []) if local["name"] == "coro")
    reader = Reader(pid)
    try:
        chain = reader.chain(root)
        print(json.dumps({"monotonic_now": time.monotonic(), "chain": chain}, ensure_ascii=True, indent=2))
    finally:
        kernel.CloseHandle(reader.handle)


if __name__ == "__main__":
    main()
