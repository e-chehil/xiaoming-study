"""Keep DirectWrite/font caches alive between companion panels."""
from pathlib import Path
import ctypes as C,os,time
BASE=Path(__file__).resolve().parent
k=C.windll.kernel32;k.CreateMutexW.restype=C.c_void_p
mutex=k.CreateMutexW(None,False,'Local\\XiaomingYumePanelHost')
if k.GetLastError()==183:raise SystemExit(0)
k.CreateEventW.argtypes=[C.c_void_p,C.c_int,C.c_int,C.c_wchar_p];k.CreateEventW.restype=C.c_void_p
k.WaitForSingleObject.argtypes=[C.c_void_p,C.c_ulong];k.SetEvent.argtypes=[C.c_void_p]
event=k.CreateEventW(None,False,False,'Local\\XiaomingYumePanelRequest')
ready=BASE/'panel-host.ready';ready.unlink(missing_ok=True)
try:
    u=C.windll.user32;u.GetForegroundWindow.restype=C.c_void_p
    u.GetDpiForWindow.argtypes=[C.c_void_p]
    from detail_capture import render
    warm=BASE/'panel-warmup.png'
    try:render('一','字根',warm,dpi=u.GetDpiForWindow(u.GetForegroundWindow()) or 96)
    finally:warm.unlink(missing_ok=True)
    from live_panel import show
    ready.write_text(str(os.getpid()),encoding='ascii')
    last=''
    k.SetEvent(event)
    while True:
        k.WaitForSingleObject(event,0xffffffff)
        try:token=(BASE/'active-panel.txt').read_text(encoding='ascii').strip()
        except OSError:token=''
        if token and token!=last:
            last=token;show(token)
finally:ready.unlink(missing_ok=True)
