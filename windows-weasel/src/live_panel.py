from pathlib import Path
import os,re,time,ctypes as C,struct
from ctypes import wintypes as W
import capture
from panel_layout import viewport

BASE=Path(__file__).resolve().parent
u=C.windll.user32;g=C.windll.gdi32;k=C.windll.kernel32;P=C.c_void_p
CB=C.WINFUNCTYPE(C.c_ssize_t,W.HWND,W.UINT,W.WPARAM,W.LPARAM)
class WC(C.Structure):
    _fields_=[('style',W.UINT),('proc',CB),('ce',C.c_int),('we',C.c_int),('inst',W.HINSTANCE),('icon',W.HICON),('cursor',W.HANDLE),('brush',W.HBRUSH),('menu',W.LPCWSTR),('cls',W.LPCWSTR)]
class PS(C.Structure):
    _fields_=[('hdc',W.HDC),('erase',W.BOOL),('rect',W.RECT),('restore',W.BOOL),('inc',W.BOOL),('reserved',C.c_byte*32)]
u.DefWindowProcW.restype=C.c_ssize_t;u.DefWindowProcW.argtypes=[W.HWND,W.UINT,W.WPARAM,W.LPARAM]
u.GetForegroundWindow.restype=W.HWND
u.GetDpiForWindow.argtypes=[W.HWND];u.GetDpiForWindow.restype=W.UINT
u.CreateWindowExW.restype=W.HWND
u.CreateWindowExW.argtypes=[W.DWORD,W.LPCWSTR,W.LPCWSTR,W.DWORD,C.c_int,C.c_int,C.c_int,C.c_int,W.HWND,W.HMENU,W.HINSTANCE,P]
u.BeginPaint.restype=W.HDC;g.CreateFontW.restype=W.HFONT;g.CreateSolidBrush.restype=W.HBRUSH
u.BeginPaint.argtypes=[W.HWND,C.POINTER(PS)];u.EndPaint.argtypes=[W.HWND,C.POINTER(PS)]
u.DestroyWindow.argtypes=[W.HWND];u.DestroyWindow.restype=W.BOOL
u.SetTimer.argtypes=[W.HWND,C.c_size_t,W.UINT,P];u.SetTimer.restype=C.c_size_t
u.InvalidateRect.argtypes=[W.HWND,C.POINTER(W.RECT),W.BOOL]
u.MonitorFromRect.argtypes=[C.POINTER(W.RECT),W.DWORD];u.MonitorFromRect.restype=W.HANDLE
u.GetMonitorInfoW.argtypes=[W.HANDLE,P]
u.GetMessageW.argtypes=[C.POINTER(W.MSG),W.HWND,W.UINT,W.UINT];u.GetMessageW.restype=W.BOOL
u.TranslateMessage.argtypes=[C.POINTER(W.MSG)]
u.DispatchMessageW.argtypes=[C.POINTER(W.MSG)];u.DispatchMessageW.restype=C.c_ssize_t
u.SetWindowPos.argtypes=[W.HWND,W.HWND,C.c_int,C.c_int,C.c_int,C.c_int,W.UINT]
g.DeleteObject.argtypes=[W.HANDLE];g.SelectObject.argtypes=[W.HDC,W.HANDLE];g.SelectObject.restype=W.HANDLE
u.FillRect.argtypes=[W.HDC,C.POINTER(W.RECT),W.HBRUSH];u.DrawTextW.argtypes=[W.HDC,W.LPCWSTR,C.c_int,C.POINTER(W.RECT),W.UINT]
g.SetTextColor.argtypes=[W.HDC,W.DWORD];g.SetBkMode.argtypes=[W.HDC,C.c_int]
g.CreateCompatibleDC.argtypes=[W.HDC];g.CreateCompatibleDC.restype=W.HDC
g.CreateDIBSection.argtypes=[W.HDC,P,W.UINT,P,W.HANDLE,W.DWORD];g.CreateDIBSection.restype=W.HBITMAP
g.DeleteDC.argtypes=[W.HDC]
g.BitBlt.argtypes=[W.HDC,C.c_int,C.c_int,C.c_int,C.c_int,W.HDC,C.c_int,C.c_int,W.DWORD]
def rgb(hexcode):return int.from_bytes(bytes.fromhex(hexcode),'little')
def show(token):
    if not re.fullmatch('[0-9a-f]+',token):return
    path=BASE/('panel-'+token+'.tsv');pick=path.with_suffix('.pick')
    if not path.exists():return
    fg=u.GetForegroundWindow();start=time.monotonic()
    name='XiaomingYumePanel_'+token;current='';rows=[];buttons=[];title='';hint='';kind='';w=430;h=140;last=start;cols=3
    pref={}
    bg,ink,muted,hi,sel=map(rgb,['fcfcfc','17191d','596370','0063e1','ffffff'])
    try:
        import json,winreg
        pref=json.loads((BASE/'settings.json').read_text(encoding='utf8')) if (BASE/'settings.json').exists() else {}
        names=['宇梦','仿 macOS','仿微软拼音','墨香','霁蓝','烛火','石绿','烟岚','流萤','月白','赭石','绀霞']
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize') as key:
            dark=not winreg.QueryValueEx(key,'AppsUseLightTheme')[0]
        dark={'固定浅色':False,'固定深色':True}.get(pref.get('day'),dark)
        from yume_appearance import colors as theme_colors
        raw=json.loads((BASE/'yume-palettes.json').read_text(encoding='utf8'))[names.index(pref.get('skin','宇梦'))]
        side='dark' if dark else 'light'
        colors=theme_colors(pref,raw)[side]
        def resolved(field,default):
            value=colors.get(field,'').lstrip('#')
            return rgb(value) if re.fullmatch('[0-9a-fA-F]{6}',value) else rgb(default)
        bg=resolved('background','fcfcfc');hi=resolved('highlight','0063e1')
        ink=resolved('candidate','17191d');muted=resolved('comment','596370');sel=resolved('highlight_text','ffffff')
        selected_comment=resolved('highlight_sub','ffffff')
    except (OSError,ValueError,KeyError):
        selected_comment=sel
    size=int(pref.get('size',18));comment_size=int(pref.get('comment_size') or max(10,size-5))
    dpi=u.GetDpiForWindow(fg) or 96
    native_text=None
    try:
        from yume_appearance import font_stack
        library=C.WinDLL(str(BASE/'xm_native_text.dll'))
        native_text=library.DrawPanelText
        native_text.argtypes=[W.HDC,C.POINTER(W.RECT),W.LPCWSTR,W.LPCWSTR,C.c_int,W.UINT,W.DWORD]
        native_text.restype=C.c_long
        options=pref.get('appearance',{}).get('font',{})
        main=pref.get('font','Yu Mincho');latin=pref.get('code_font') or main
        faces=[font_stack(main,latin,options),font_stack(main,latin,options),font_stack(pref.get('root_font') or main,latin,options)]
        points=[int(pref.get('appearance',{}).get('size',{}).get('header',10)),size,comment_size]
    except (OSError,AttributeError):pass
    fonts=[g.CreateFontW(-n,0,0,0,weight,0,0,0,1,0,0,5,0,face) for n,weight,face in
           ((19,600,pref.get('font','SimSun')),(round(size*4/3),400,pref.get('font','SimSun')),
            (round(comment_size*4/3),400,pref.get('root_font','SimSun')),(round(comment_size*4/3),400,'Yuniversus'))]
    word_height=max(30,round(size*dpi/72*1.1)+8)
    comment_height=max(25,round(comment_size*dpi/72*1.1)+8)
    row_height=word_height+comment_height+4
    cached_dc=None;cached_bitmap=None;cached_previous=None
    def detail_lines(comment):
        return [part[i:i+30] for part in comment.split(' · ') for i in range(0,len(part),30)]
    def fill(dc,r,color):
        b=g.CreateSolidBrush(color);u.FillRect(dc,C.byref(r),b);g.DeleteObject(b)
    def text(dc,t,r,font,color):
        if native_text is not None and native_text(dc,C.byref(r),t,faces[font],points[font],dpi,color)>=0:
            return
        g.SetTextColor(dc,color);g.SetBkMode(dc,1)
        x=r.left
        for run in re.findall(r'[\ue000-\uf8ff]+|[^\ue000-\uf8ff]+',t):
            g.SelectObject(dc,fonts[3 if '\ue000'<=run[0]<='\uf8ff' else font])
            bounds=W.RECT(x,r.top,r.right,r.bottom)
            u.DrawTextW(dc,run,-1,C.byref(bounds),0x20|0x4|0x800|0x8000)
            extent=W.SIZE()
            g.GetTextExtentPoint32W.argtypes=[W.HDC,W.LPCWSTR,C.c_int,C.POINTER(W.SIZE)]
            g.GetTextExtentPoint32W(dc,run,len(run.encode('utf-16le'))//2,C.byref(extent))
            x+=extent.cx
            if x>=r.right:break
    def dispatch(hwnd,msg,wp,lp):
        nonlocal current,rows,buttons,title,hint,kind,w,h,last,cols,row_height,cached_dc,cached_bitmap,cached_previous
        if msg==0x21:return 3
        if msg==0x14:return 1
        if msg in (0xf,0x317,0x318):
            ps=PS();target=u.BeginPaint(hwnd,C.byref(ps)) if msg==0xf else wp
            if cached_dc:g.BitBlt(target,0,0,w,h,cached_dc,0,0,0x00CC0020)
            if msg==0xf:u.EndPaint(hwnd,C.byref(ps))
            return 0
        if msg==0x8001:
            dc=g.CreateCompatibleDC(None);bits=P()
            info=C.create_string_buffer(struct.pack('<IiiHHIIiiII',40,w,-h,1,32,0,w*h*4,0,0,0,0))
            bitmap=g.CreateDIBSection(dc,info,0,C.byref(bits),None,0)
            if not dc or not bitmap:
                if dc:g.DeleteDC(dc)
                return 0
            previous=g.SelectObject(dc,bitmap)
            fill(dc,W.RECT(0,0,w,h),bg);text(dc,title,W.RECT(12,4,w-10,36),0,ink);buttons=[]
            for j,(idx,active,word,comment) in enumerate(rows):
                x=7+(j%cols)*(w-14)//cols;y=39+(j//cols)*row_height;right=7+(j%cols+1)*(w-14)//cols-2
                r=W.RECT(x,y,right,y+row_height-3);buttons.append((r,idx))
                if active=='1':fill(dc,r,hi)
                if kind=='sentence':
                    code,_,letter=comment.rpartition(' · ')
                    small=comment_height
                    text(dc,code,W.RECT(x+6,y,right-4,y+small),2,selected_comment if active=='1' else muted)
                    text(dc,word,W.RECT(x+6,y+small,right-4,y+small+word_height),1,sel if active=='1' else ink)
                    text(dc,letter,W.RECT(x+6,y+small+word_height,right-4,y+row_height),2,selected_comment if active=='1' else muted)
                elif kind=='detail':
                    text(dc,word,W.RECT(x+6,y,right-4,y+word_height),1,sel if active=='1' else ink)
                    for n,line in enumerate(detail_lines(comment)):
                        top=y+word_height+n*comment_height
                        text(dc,line,W.RECT(x+6,top,right-4,top+comment_height),2,selected_comment if active=='1' else muted)
                else:
                    text(dc,word,W.RECT(x+6,y,right-4,y+word_height),1,sel if active=='1' else ink)
                    text(dc,comment,W.RECT(x+6,y+word_height-1,right-4,y+word_height+comment_height),2,selected_comment if active=='1' else muted)
            text(dc,hint,W.RECT(10,h-28,w-8,h-3),2,muted)
            if cached_dc:
                g.SelectObject(cached_dc,cached_previous);g.DeleteObject(cached_bitmap);g.DeleteDC(cached_dc)
            cached_dc,cached_bitmap,cached_previous=dc,bitmap,previous
            return 0
        if msg==0x202:
            x=lp&65535;y=(lp>>16)&65535
            if fg==u.GetForegroundWindow() and path.exists() and capture.find():
                for r,idx in buttons:
                    if r.left<=x<r.right and r.top<=y<r.bottom:
                        pick.write_text(idx,encoding='ascii');u.keybd_event(0x87,0,0,0);u.keybd_event(0x87,0,2,0);break
            return 0
        if msg==0x113:
            try:active=(BASE/'active-panel.txt').read_text(encoding='ascii').strip()
            except OSError:active=token
            if active!=token:u.DestroyWindow(hwnd);return 0
            try:data=path.read_text(encoding='utf8')
            except FileNotFoundError:u.DestroyWindow(hwnd);return 0
            except OSError:return 0
            panel=capture.find()
            if panel:last=time.monotonic()
            if time.monotonic()-last>1 or time.monotonic()-start>300 or fg!=u.GetForegroundWindow():u.DestroyWindow(hwnd);return 0
            if data!=current and panel:
                try:
                    lines=data.splitlines();kind,title,hint=lines[0].split('\t',2)
                    rows=[line.split('\t',3) for line in lines[1:] if line.count('\t')==3]
                    if not rows:return 0
                except (ValueError,IndexError):return 0
                current=data
                row_height=word_height+comment_height*(2 if kind=='sentence' else 1)+4
                if kind=='schemas':row_height=word_height+6
                if kind=='detail':row_height=word_height+comment_height*max(1,len(detail_lines(rows[0][3])))+4
                anchor=panel[1]
                class MI(C.Structure):_fields_=[('size',W.DWORD),('monitor',W.RECT),('work',W.RECT),('flags',W.DWORD)]
                mi=MI(C.sizeof(MI));u.GetMonitorInfoW(u.MonitorFromRect(C.byref(anchor),2),C.byref(mi));area=mi.work
                active=next((i for i,row in enumerate(rows) if row[1]=='1'),0)
                cols,w,h,offset,capacity=viewport(kind,len(rows),active,dpi,area.right-area.left,area.bottom-area.top,row_height)
                rows=rows[offset:offset+capacity]
                path.with_suffix('.layout').write_text(f'{cols}\t{capacity}',encoding='ascii')
                dispatch(hwnd,0x8001,0,0)
                x=anchor.right+5 if anchor.right+w+5<=area.right else max(area.left,anchor.left-w-5);y=max(area.top,min(area.bottom-h,anchor.top))
                u.SetWindowPos(hwnd,-1,x,y,w,h,0x10|0x40);u.InvalidateRect(hwnd,None,False)
                u.SetTimer(hwnd,1,40,None)
            return 0
        if msg==2:u.PostQuitMessage(0);return 0
        return u.DefWindowProcW(hwnd,msg,wp,lp)
    @CB
    def proc(hwnd,msg,wp,lp):
        try:return dispatch(hwnd,msg,wp,lp)
        except Exception:
            import traceback
            with (BASE/'panel-error.log').open('a',encoding='utf8') as log:log.write(traceback.format_exc())
            if msg==0xf:u.ValidateRect(hwnd,None)
            return 0
    k.GetModuleHandleW.restype=W.HINSTANCE
    inst=k.GetModuleHandleW(None)
    wc=WC(0,proc,0,0,inst,None,None,None,None,name)
    if not u.RegisterClassW(C.byref(wc)):return
    hwnd=u.CreateWindowExW(0x08000088,name,'潇明 · 查阅与候选',0x80800000,0,0,w,h,None,None,inst,None)
    if not hwnd:return
    try:
        u.SetTimer(hwnd,1,10,None);m=W.MSG()
        while u.GetMessageW(C.byref(m),None,0,0)>0:u.TranslateMessage(C.byref(m));u.DispatchMessageW(C.byref(m))
    finally:
        if cached_dc:
            g.SelectObject(cached_dc,cached_previous);g.DeleteObject(cached_bitmap);g.DeleteDC(cached_dc)
        for font in fonts:g.DeleteObject(font)
        u.UnregisterClassW.argtypes=[W.LPCWSTR,W.HINSTANCE];u.UnregisterClassW(name,inst)

