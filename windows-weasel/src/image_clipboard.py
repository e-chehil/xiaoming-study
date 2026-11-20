"""Publish PNG and CF_DIB together; transfer HGLOBAL ownership exactly once."""
import ctypes as C
from ctypes import wintypes as W
import struct, time

def dib(width,height,bgra):
    if width<1 or height<1 or len(bgra)!=width*height*4:raise ValueError('图像尺寸无效')
    opaque=bytearray(bgra);opaque[3::4]=b'\xff'*(width*height)
    # Negative height preserves the top-down ordering of the DIB section.
    return struct.pack('<IiiHHIIiiII',40,width,-height,1,32,0,len(opaque),0,0,0,0)+opaque

def copy_image(width,height,bgra,png):
    u=C.windll.user32;k=C.windll.kernel32
    u.CreateWindowExW.argtypes=[W.DWORD,W.LPCWSTR,W.LPCWSTR,W.DWORD,C.c_int,C.c_int,C.c_int,C.c_int,W.HWND,W.HMENU,W.HINSTANCE,C.c_void_p]
    u.CreateWindowExW.restype=W.HWND
    u.DestroyWindow.argtypes=[W.HWND];u.OpenClipboard.argtypes=[W.HWND]
    u.SetClipboardData.argtypes=[W.UINT,W.HANDLE];u.SetClipboardData.restype=W.HANDLE
    u.RegisterClipboardFormatW.argtypes=[W.LPCWSTR]
    k.GlobalAlloc.argtypes=[W.UINT,C.c_size_t];k.GlobalAlloc.restype=W.HGLOBAL
    k.GlobalLock.argtypes=[W.HGLOBAL];k.GlobalLock.restype=C.c_void_p
    k.GlobalUnlock.argtypes=[W.HGLOBAL];k.GlobalFree.argtypes=[W.HGLOBAL]
    pending=[];owner=None;opened=False
    try:
        for fmt,data in [(8,dib(width,height,bgra)),(u.RegisterClipboardFormatW('PNG'),png)]:
            if not fmt:raise C.WinError()
            block=k.GlobalAlloc(2,len(data))
            if not block:raise MemoryError('无法分配截图剪贴板')
            pending.append([fmt,block])
            pointer=k.GlobalLock(block)
            if not pointer:raise C.WinError()
            try:C.memmove(pointer,data,len(data))
            finally:k.GlobalUnlock(block)
        owner=u.CreateWindowExW(0,'STATIC','',0,0,0,0,0,W.HWND(-3),None,None,None)
        if not owner:raise C.WinError()
        for _ in range(10):
            if u.OpenClipboard(owner):opened=True;break
            time.sleep(.03)
        if not opened:raise OSError('剪贴板正忙，请重试截图。')
        if not u.EmptyClipboard():raise C.WinError()
        for entry in pending:
            if not u.SetClipboardData(*entry):raise C.WinError()
            entry[1]=None # Windows now owns the allocation.
        return True
    finally:
        if opened:u.CloseClipboard()
        if owner:u.DestroyWindow(owner)
        for _,block in pending:
            if block:k.GlobalFree(block)
