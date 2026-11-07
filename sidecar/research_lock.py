"""Avalon OS lock supervisor. Standard library only; no Hermes imports.

The lock file is permanent: never unlink or replace its inode. JSON/PID files
are not consulted. EOF on the owning worker's pipe releases the lock.
"""
import errno
import json
import os
from pathlib import Path
import sys


def hold_lock(filename):
    filename = Path(filename)
    filename.parent.mkdir(parents=True, exist_ok=True)
    lock = open(filename, "a+b")
    if os.fstat(lock.fileno()).st_size == 0:
        lock.write(b"0")
        lock.flush()
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        lock.close()
        if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
            return None
        raise
    return lock


if __name__ == "__main__":
    try:
        with_lock = hold_lock(sys.argv[1])
        if with_lock is None:
            print(json.dumps({"protocol": 2, "acquired": False}), flush=True)
        else:
            with with_lock:
                print(json.dumps({"protocol": 2, "acquired": True, "pid": os.getpid()}), flush=True)
                # Parent death closes this pipe too. No PID polling/reaping.
                sys.stdin.buffer.readline()
    except Exception:
        print(json.dumps({"protocol": 2, "error": "OS lock unavailable"}), flush=True)
        sys.exit(1)
