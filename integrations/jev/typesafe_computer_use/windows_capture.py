"""Render one HWND with PrintWindow; never fall back to desktop pixels."""

import ctypes
from ctypes import wintypes

from PIL import Image

gdi = ctypes.WinDLL("gdi32", use_last_error=True)
ui = ctypes.WinDLL("user32", use_last_error=True)
ui.GetWindowDC.argtypes = [wintypes.HWND]
ui.GetWindowDC.restype = wintypes.HDC
ui.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
ui.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
ui.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
ui.GetWindowDpiAwarenessContext.argtypes = [wintypes.HWND]
ui.GetWindowDpiAwarenessContext.restype = ctypes.c_void_p
ui.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
ui.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
gdi.CreateCompatibleDC.argtypes = [wintypes.HDC]
gdi.CreateCompatibleDC.restype = wintypes.HDC
gdi.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
gdi.CreateCompatibleBitmap.restype = wintypes.HBITMAP
gdi.SelectObject.argtypes = [wintypes.HDC, wintypes.HANDLE]
gdi.SelectObject.restype = wintypes.HANDLE
gdi.DeleteObject.argtypes = [wintypes.HANDLE]
gdi.DeleteDC.argtypes = [wintypes.HDC]
gdi.GetDIBits.argtypes = [
    wintypes.HDC,
    wintypes.HBITMAP,
    wintypes.UINT,
    wintypes.UINT,
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.UINT,
]


class BitmapInfo(ctypes.Structure):
    _fields_ = [
        ("size", wintypes.DWORD),
        ("width", wintypes.LONG),
        ("height", wintypes.LONG),
        ("planes", wintypes.WORD),
        ("bits", wintypes.WORD),
        ("compression", wintypes.DWORD),
        ("imageSize", wintypes.DWORD),
        ("xppm", wintypes.LONG),
        ("yppm", wintypes.LONG),
        ("used", wintypes.DWORD),
        ("important", wintypes.DWORD),
    ]


def capture_window(hwnd, width, height):
    physical_size = (width, height)
    previous = ui.SetThreadDpiAwarenessContext(ui.GetWindowDpiAwarenessContext(hwnd))
    try:
        logical = wintypes.RECT()
        if not ui.GetWindowRect(hwnd, ctypes.byref(logical)):
            raise OSError("Cannot read target DPI geometry")
        width, height = logical.right - logical.left, logical.bottom - logical.top
    finally:
        ui.SetThreadDpiAwarenessContext(previous)
    dc = ui.GetWindowDC(hwnd)
    memory = gdi.CreateCompatibleDC(dc)
    bitmap = gdi.CreateCompatibleBitmap(dc, width, height)
    old = gdi.SelectObject(memory, bitmap)
    try:
        if not dc or not memory or not bitmap or not ui.PrintWindow(hwnd, memory, 2):
            raise OSError("The application did not render its window. No desktop fallback was used.")
        gdi.SelectObject(memory, old)
        info = BitmapInfo(ctypes.sizeof(BitmapInfo), width, -height, 1, 32, 0, width * height * 4, 0, 0, 0, 0)
        data = ctypes.create_string_buffer(width * height * 4)
        if gdi.GetDIBits(dc, bitmap, 0, height, data, ctypes.byref(info), 0) != height:
            raise OSError("Cannot read window capture pixels")
        image = Image.frombytes("RGB", (width, height), data.raw, "raw", "BGRX")
        return image.resize(physical_size) if image.size != physical_size else image
    finally:
        gdi.SelectObject(memory, old)
        gdi.DeleteObject(bitmap)
        gdi.DeleteDC(memory)
        ui.ReleaseDC(hwnd, dc)
