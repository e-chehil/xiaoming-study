"""Render local character information at twice logical resolution with Weasel fonts."""
from pathlib import Path
import ctypes as C, json, re, winreg
from ctypes import wintypes as W
from capture import png_bytes
from yume_appearance import colors, font_stack

BASE=Path(__file__).resolve().parent

def render(word,annotation,path,clipboard=False,dpi=192):
    cfg=json.loads((BASE/'settings.json').read_text(encoding='utf8'))
    skins=['宇梦','仿 macOS','仿微软拼音','墨香','霁蓝','烛火','石绿','烟岚','流萤','月白','赭石','绀霞']
    palette=json.loads((BASE/'yume-palettes.json').read_text(encoding='utf8'))[skins.index(cfg['skin'])]
    dark=False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize') as key:
            dark=not winreg.QueryValueEx(key,'AppsUseLightTheme')[0]
    except OSError:pass
    dark={'固定浅色':False,'固定深色':True}.get(cfg.get('day'),dark)
    palette=colors(cfg,palette)['dark' if dark else 'light']
    def rgb(field):return int.from_bytes(bytes.fromhex(palette[field].lstrip('#')),'little')
    wordlines=[word[i:i+14] for i in range(0,len(word),14)]
    lines=[part[i:i+30] for part in annotation.split(' · ') for i in range(0,len(part),30)]
    size=int(cfg.get('size',20));comment=int(cfg.get('comment_size') or 10)
    wordheight=round(size*dpi/72*1.3);lineheight=round(comment*dpi/72*1.5)
    width=980;height=94+len(wordlines)*wordheight+len(lines)*lineheight
    if height>8192:raise ValueError('本地详情过长')
    g=C.windll.gdi32;u=C.windll.user32
    g.CreateCompatibleDC.restype=W.HDC;g.CreateDIBSection.restype=W.HBITMAP
    g.CreateDIBSection.argtypes=[W.HDC,C.c_void_p,W.UINT,C.c_void_p,W.HANDLE,W.DWORD]
    g.SelectObject.argtypes=[W.HDC,W.HANDLE];g.SelectObject.restype=W.HANDLE
    g.DeleteObject.argtypes=[W.HANDLE];g.DeleteDC.argtypes=[W.HDC]
    g.CreateSolidBrush.argtypes=[W.DWORD];g.CreateSolidBrush.restype=W.HBRUSH
    u.FillRect.argtypes=[W.HDC,C.POINTER(W.RECT),W.HBRUSH]
    info=C.create_string_buffer(__import__('struct').pack('<IiiHHIIiiII',40,width,-height,1,32,0,width*height*4,0,0,0,0))
    dc=g.CreateCompatibleDC(None);bits=C.c_void_p()
    bitmap=g.CreateDIBSection(dc,info,0,C.byref(bits),None,0)
    if not dc or not bitmap:
        if dc:g.DeleteDC(dc)
        raise C.WinError()
    old=g.SelectObject(dc,bitmap)
    try:
        rect=W.RECT(0,0,width,height);brush=g.CreateSolidBrush(rgb('background'))
        try:u.FillRect(dc,C.byref(rect),brush)
        finally:g.DeleteObject(brush)
        draw=C.WinDLL(str(BASE/'xm_native_text.dll')).DrawPanelText
        draw.argtypes=[W.HDC,C.POINTER(W.RECT),W.LPCWSTR,W.LPCWSTR,C.c_int,W.UINT,W.DWORD];draw.restype=C.c_long
        options=cfg.get('appearance',{}).get('font',{});main=cfg.get('font','');latin=cfg.get('code_font') or main
        mainface=font_stack(main,latin,options);noteface=font_stack(cfg.get('root_font') or main,latin,options)
        top=20
        def line(text,point,height,face,color):
            nonlocal top
            r=W.RECT(24,top,width-24,top+height)
            if draw(dc,C.byref(r),text,face,point,dpi,rgb(color))<0:raise OSError('DirectWrite 详情绘制失败')
            top+=height
        line('潇明 · 本地字根详情',10,40,noteface,'header')
        for text in wordlines:line(text,size,wordheight,mainface,'candidate')
        for text in lines:line(text,comment,lineheight,noteface,'comment')
        raw=C.string_at(bits,width*height*4);png=png_bytes(width,height,raw)
        Path(path).write_bytes(png)
        if clipboard:
            from image_clipboard import copy_image
            copy_image(width,height,raw,png)
        return str(path)
    finally:g.SelectObject(dc,old);g.DeleteObject(bitmap);g.DeleteDC(dc)

def capture_token(token):
    if not re.fullmatch('[0-9a-f]{1,64}',token):raise ValueError('截图标识无效')
    source=BASE/('capture-'+token+'.tsv')
    try:
        word,annotation=source.read_text(encoding='utf8').split('\t',1)
        return render(word,annotation,BASE/'字根详情截图.png',clipboard=True)
    finally:source.unlink(missing_ok=True)
