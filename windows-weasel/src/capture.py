"""Locate only visible Weasel candidate windows, including TSF client windows."""
from pathlib import Path
import ctypes as C, struct, zlib
from ctypes import wintypes as W

u=C.windll.user32;k=C.windll.kernel32;g=C.windll.gdi32;ps=C.windll.psapi
P=C.c_void_p
u.SetProcessDPIAware()
u.GetWindowLongW.argtypes=[W.HWND,C.c_int]
u.GetClassLongPtrW.argtypes=[W.HWND,C.c_int];u.GetClassLongPtrW.restype=P
u.GetWindowRect.argtypes=[W.HWND,C.POINTER(W.RECT)]
k.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];k.OpenProcess.restype=W.HANDLE
k.CloseHandle.argtypes=[W.HANDLE]
ps.EnumProcessModulesEx.argtypes=[W.HANDLE,P,W.DWORD,C.POINTER(W.DWORD),W.DWORD]
ps.GetModuleFileNameExW.argtypes=[W.HANDLE,W.HMODULE,W.LPWSTR,W.DWORD]

def is_weasel(pid,module):
    process=k.OpenProcess(0x410,False,pid)
    if not process:return False
    try:
        name=C.create_unicode_buffer(32768)
        if module and ps.GetModuleFileNameExW(process,module,name,len(name)):
            return Path(name.value).name.lower() in ('weaselserver.exe','weasel.dll','weaselx64.dll','weasel.ime','weaselx64.ime')
    finally:k.CloseHandle(process)
    return False

def find():
    windows=[];checked={}
    @C.WINFUNCTYPE(W.BOOL,W.HWND,W.LPARAM)
    def visit(hwnd,_):
        if not u.IsWindowVisible(hwnd):return True
        cls=C.create_unicode_buffer(256);u.GetClassNameW(hwnd,cls,len(cls))
        if not cls.value.startswith('ATL:'):return True
        style=u.GetWindowLongW(hwnd,-20)
        if style&0x08000080!=0x08000080:return True
        pid=W.DWORD();u.GetWindowThreadProcessId(hwnd,C.byref(pid))
        module=u.GetClassLongPtrW(hwnd,-16)
        owner=(pid.value,module)
        if owner not in checked:checked[owner]=is_weasel(pid.value,module)
        if checked[owner]:
            rect=W.RECT();u.GetWindowRect(hwnd,C.byref(rect))
            if rect.right>rect.left and rect.bottom>rect.top:windows.append((hwnd,rect))
        return True
    u.EnumWindows(visit,0)
    return windows[0] if windows else None

def png_bytes(width,height,raw):
    rows=[]
    for y in range(height):
        row=raw[y*width*4:(y+1)*width*4];rgb=bytearray(width*3)
        rgb[0::3]=row[2::4];rgb[1::3]=row[1::4];rgb[2::3]=row[0::4]
        rows.append(b'\0'+rgb)
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')

def capture(path=None,detail=False,clipboard=False):
    panel=find()
    if not panel:return False
    hwnd,rect=panel;width=rect.right-rect.left;height=rect.bottom-rect.top
    if width>4096 or height>4096:return False
    class BI(C.Structure):
        _fields_=[('size',W.DWORD),('width',W.LONG),('height',W.LONG),('planes',W.WORD),('bits',W.WORD),('compression',W.DWORD),('image_size',W.DWORD),('x',W.LONG),('y',W.LONG),('used',W.DWORD),('important',W.DWORD)]
    g.CreateCompatibleDC.restype=W.HDC;g.CreateDIBSection.restype=W.HBITMAP
    g.CreateDIBSection.argtypes=[W.HDC,P,W.UINT,P,W.HANDLE,W.DWORD]
    g.SelectObject.argtypes=[W.HDC,W.HANDLE];g.SelectObject.restype=W.HANDLE
    g.DeleteObject.argtypes=[W.HANDLE];g.DeleteDC.argtypes=[W.HDC]
    u.PrintWindow.argtypes=[W.HWND,W.HDC,W.UINT]
    dc=g.CreateCompatibleDC(None);bits=P();info=BI(C.sizeof(BI),width,-height,1,32)
    bmp=g.CreateDIBSection(dc,C.byref(info),0,C.byref(bits),None,0)
    old=g.SelectObject(dc,bmp)
    try:
        if not u.PrintWindow(hwnd,dc,2):return False
        raw=C.string_at(bits,width*height*4)
        png=png_bytes(width,height,raw)
        if path is None:path=Path(__file__).parent/'候选截图.png'
        Path(path).write_bytes(png)
        if clipboard:
            from image_clipboard import copy_image
            copy_image(width,height,raw,png)
        return str(path)
    finally:
        g.SelectObject(dc,old);g.DeleteObject(bmp);g.DeleteDC(dc)
