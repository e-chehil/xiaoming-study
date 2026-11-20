"""Serve local, allowlisted UI requests without blocking the Rime Lua thread."""
from pathlib import Path
import ctypes, re, subprocess, sys, time
from input_options import valid_request

BASE=Path(__file__).resolve().parent
REQUESTS=BASE/'requests';REQUESTS.mkdir(exist_ok=True)
kernel=ctypes.windll.kernel32
kernel.CreateEventW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_wchar_p];kernel.CreateEventW.restype=ctypes.c_void_p
kernel.SetEvent.argtypes=[ctypes.c_void_p]
kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
kernel.FindFirstChangeNotificationW.argtypes=[ctypes.c_wchar_p,ctypes.c_int,ctypes.c_ulong];kernel.FindFirstChangeNotificationW.restype=ctypes.c_void_p
kernel.FindNextChangeNotification.argtypes=[ctypes.c_void_p]
kernel.CreateMutexW.restype=ctypes.c_void_p
mutex=kernel.CreateMutexW(None,False,'Local\\XiaomingYumeSettingsBroker')
if kernel.GetLastError()==183:raise SystemExit(0)
panel_event=kernel.CreateEventW(None,False,False,'Local\\XiaomingYumePanelRequest')
changes=kernel.FindFirstChangeNotificationW(str(REQUESTS),False,0x11)
panel_host=subprocess.Popen([sys.executable,str(BASE/'panel_host.pyw')],cwd=BASE)
while True:
    for job in REQUESTS.glob('*.job'):
        try:
            text=job.read_text(encoding='utf8').strip()
            args=text.split(' ')
            valid=valid_request(args)
            job.unlink()
            if valid and args[0]=='panel':
                target=BASE/'active-panel.txt';pending=target.with_suffix('.tmp')
                pending.write_text(args[1],encoding='ascii');pending.replace(target)
                if panel_host.poll() is not None:panel_host=subprocess.Popen([sys.executable,str(BASE/'panel_host.pyw')],cwd=BASE)
                kernel.SetEvent(panel_event)
            elif valid:subprocess.Popen([sys.executable,str(BASE/'settings.pyw'),*args],cwd=BASE)
        except (OSError,UnicodeError):pass
    if changes and changes!=ctypes.c_void_p(-1).value:
        if kernel.WaitForSingleObject(changes,500)==0:kernel.FindNextChangeNotification(changes)
    else:time.sleep(.05)
