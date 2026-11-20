import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import tkinter as tk
from pathlib import Path
from tkinter import ttk, messagebox, filedialog
from urllib.parse import quote
import webbrowser

BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
import yume_appearance as appearance
from input_options import UPPERCASE, DIGITS, SHORTCUTS, KEYS as SHORTCUT_KEYS, DEFAULT_SHORTCUTS, shortcut_text
PROFILE=BASE.parent
DEPLOY = Path(os.environ.get("WEASEL_INSTALL", "")) / "WeaselDeployer.exe"
SKINS=["宇梦","仿 macOS","仿微软拼音","墨香","霁蓝","烛火","石绿","烟岚","流萤","月白","赭石","绀霞"]
LAYOUT=["标准","紧凑","舒展","方角","圆润","大字间距"]
DEFAULT={"skin":"宇梦","spacing":"标准","direction":"纵列","day":"跟随系统","page":6,"size":18,"note":0,"charset":0,"inline":"面板编码","font":"SimSun","labels":"数字","mode":"逐字","preview":False,"ivs":True,"quick":{},"hidden":False,"index":True,"word":False,"predict":True,"sort":"常用优先","track":"全部","hint":True,"second":"分号","third":"单引号","pgup":"减号","pgdn":"等号","accent_light":"","accent_dark":"","code_font":"Segoe UI","root_font":"SimSun","word_lengths":"234+","single_layout":False}
def atomic(path,text):
    if path.exists() and path.read_text(encoding="utf8")==text: return
    fd,name=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf8",newline="\n") as f:f.write(text)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
LABELS={"数字":list("123456789"),"上标":list("¹²³⁴⁵⁶⁷⁸⁹"),"下标":list("₁₂₃₄₅₆₇₈₉"),"带圈":list("①②③④⑤⑥⑦⑧⑨"),"黑圆":list("❶❷❸❹❺❻❼❽❾"),"字母":list("abcdefghi"),"大写字母":list("ABCDEFGHI"),"汉字":list("一二三四五六七八九"),"大写汉字":list("壹贰叁肆伍陆柒捌玖"),"带圈汉字":list("㊀㊁㊂㊃㊄㊅㊆㊇㊈"),"罗马":list("ⅠⅡⅢⅣⅤⅥⅦⅧⅨ"),"苏州码":list("〡〢〣〤〥〦〧〨〩"),"千字文":list("天地玄黄宇宙洪荒日"),"假名":list("あいうえおかきくけ"),"韩文":list("가나다라마바사아자"),"键帽":[c+'\ufe0f\u20e3' for c in '123456789']}
LABELS['带括号']=list('⑴⑵⑶⑷⑸⑹⑺⑻⑼')
LABELS['外观文件']=LABELS['数字']
KEYS={'分号':'semicolon','单引号':'apostrophe','方括号左':'bracketleft','方括号右':'bracketright','减号':'minus','等号':'equal','逗号':'comma','句号':'period','Page Up':'Page_Up','Page Down':'Page_Down'}
def js(v):return json.dumps(v,ensure_ascii=False)
def emit_patch(values):
    return 'patch:\n'+''.join('  '+js(k)+': '+js(v)+'\n' for k,v in values.items())
RUNTIME_FLAGS=['xm_sentence','xm_delay','xm_noivs','xm_words','xm_nopredict','xm_nohints','xm_noquickhint','xm_fullprefix']+[f'{p}{i}' for p,n in [('xm_note',9),('xm_charset',5),('xm_sort',5)] for i in range(n)]
RUNTIME_FIELDS=('mode','note','charset','sort','ivs','word','predict','candidate_prediction','hint','prefix_completion')
from itertools import permutations
TRACK_NAMES={'S':'通规','F':'通繁','T':'台湾'}
TRACK_ORDERS={' → '.join(TRACK_NAMES[t] for t in order):''.join(order)
              for n in (3,2,1) for order in permutations(TRACK_NAMES,n)}
NOTE_FIELDS={'roots':'拆分','holo':'全息拆分','code':'字根编码','fullcode':'完整输入码','pinyin':'拼音','meaning':'字义','region':'字集','unicode':'码位'}
NOTE_DEFAULTS=[{'name':'拆分及编码','fields':['roots','code']},
               {'name':'详细注解','fields':['roots','holo','code','pinyin','region','unicode','meaning']}]
DEFAULT.update(candidate_prediction=True,prefix_completion=False,note_profiles=NOTE_DEFAULTS,word_last=True,comment_size=0,label_size=0,sentence_space="空格上屏",footer=True)
DEFAULT.update(uppercase=UPPERCASE[3],digits=DIGITS[0],digit_outside=False,commit_on_switch=False,shortcuts={})
APPEARANCE_FIELDS={'skin','spacing','direction','day','size','font','labels','hidden','index','inline','preview','accent_light','accent_dark','code_font','root_font','single_layout','label_size','comment_size','appearance','appearance_skin','imported_glyphs','footer','page'}

def reset_input_settings(cfg):
    return cfg|{k:v for k,v in DEFAULT.items() if k not in APPEARANCE_FIELDS}

def cycle_layout(cfg):
    result=cfg.copy()
    if cfg.get('hidden'):result.update(hidden=False,single_layout=False,direction='纵列')
    elif cfg.get('single_layout'):result.update(hidden=True,single_layout=False)
    elif cfg.get('direction')=='横排':result.update(single_layout=True)
    else:result['direction']='横排'
    return result

def validate_profiles(profiles):
    if not 1<=len(profiles)<=8:
        raise ValueError('请启用一至八档注解。')
    names={'关闭'}
    for profile in profiles:
        name=profile['name'].strip()
        if not name or name in names:
            raise ValueError('请给每个启用的注解档填写不同的名称。')
        if not profile['fields'] or not set(profile['fields'])<=NOTE_FIELDS.keys():
            raise ValueError(f'注解「{name}」至少需要一个有效字段。')
        names.add(name)
def runtime_flags(cfg):
    flags=dict(xm_sentence=cfg['mode']=='整句',xm_delay=cfg['mode']=='顶字',xm_noivs=not cfg['ivs'],xm_words=cfg['word'],xm_nopredict=not cfg['predict'],xm_nohints=not cfg.get('candidate_prediction',True),xm_noquickhint=not cfg['hint'],xm_fullprefix=cfg.get('prefix_completion',False))
    for p,n,value in [('xm_note',9,cfg['note']),('xm_charset',5,cfg['charset']),('xm_sort',5,['原始','常用优先','简体优先','传统优先','自定义优先'].index(cfg['sort']))]:
        flags.update({p+str(i):i==value for i in range(n)})
    return flags
def runtime_text(cfg):
    flags=runtime_flags(cfg)
    return ''.join(k+'\t'+str(int(flags[k]))+'\n' for k in RUNTIME_FLAGS)+'.\n'
def conf():
    cfg=DEFAULT|json.loads((BASE/'settings.json').read_text(encoding='utf8')) if (BASE/'settings.json').exists() else DEFAULT.copy()
    try:
        raw=(BASE/'runtime.tsv').read_text(encoding='utf8')
        if not raw.endswith('\n.\n'):return cfg
        flags={k:v=='1' for k,v in (line.split('\t') for line in raw.splitlines()[:-1])}
        for i in range(3,9):
            flags.setdefault('xm_note'+str(i),False)
        if set(flags)!=set(RUNTIME_FLAGS):return cfg
        cfg['mode']='整句' if flags['xm_sentence'] else '顶字' if flags['xm_delay'] else '逐字'
        for field,flag,invert in [('ivs','xm_noivs',True),('word','xm_words',False),('predict','xm_nopredict',True),('candidate_prediction','xm_nohints',True),('hint','xm_noquickhint',True),('prefix_completion','xm_fullprefix',False)]:cfg[field]=flags[flag]!=invert
        for field,prefix,n in [('note','xm_note',9),('charset','xm_charset',5),('sort','xm_sort',5)]:
            val=next((i for i in range(1,n) if flags[prefix+str(i)]),0)
            cfg[field]=['原始','常用优先','简体优先','传统优先','自定义优先'][val] if field=='sort' else val
    except (OSError,ValueError,KeyError):pass
    return cfg

def textcolor(rgb):
    linear=[((int(rgb[i:i+2],16)/255+.055)/1.055)**2.4 for i in (0,2,4)]
    return '16191e' if sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))>.36 else 'f7f8fb'
def config_files(cfg):
    shortcuts=shortcut_text(cfg.get('shortcuts',{}))
    profiles=cfg.get('note_profiles',NOTE_DEFAULTS)
    validate_profiles(profiles)
    if not 0<=cfg['note']<=len(profiles):
        raise ValueError('所选注解档已停用。')
    size=int(cfg['size']);page=int(cfg['page']);skin=SKINS.index(cfg['skin']);layout=LAYOUT.index(cfg['spacing'])
    if not (6<=size<=96 and 3<=page<=9):raise ValueError('字号限 6–96，每页限 3–9。')
    colors=json.loads((BASE/'palettes.json').read_text(encoding='utf8'))
    margin,gap,radius=[(9,5,7),(5,2,4),(13,8,9),(8,4,0),(10,5,13),(16,10,10)][layout]
    sides=["light","dark"]; chosen={"跟随系统":sides,"固定浅色":["light"]*2,"固定深色":["dark"]*2}[cfg["day"]]
    style={"style/color_scheme":"xm_"+chosen[0],"style/color_scheme_dark":"xm_"+chosen[1],"style/horizontal":cfg["direction"]=="横排",
      "style/inline_preedit":cfg["inline"]=="行内编码","style/preedit_type":"preview" if cfg["preview"] else "composition",
      "style/font_face":cfg['font']+", SimSun-ExtB, SimSun-ExtG, Segoe UI Emoji","style/font_point":size,
      "style/label_font_face":"Segoe UI","style/label_font_point":max(9,size-6),
      "style/comment_font_face":"Yuniversus:e000:f8ff, "+cfg['font']+", SimSun-ExtB, Segoe UI Symbol","style/comment_font_point":max(10,size-5),
      "style/label_format":"%s","style/layout/margin_x":margin+3,"style/layout/margin_y":margin,
      "style/layout/spacing":gap+2,"style/layout/candidate_spacing":gap+3,"style/layout/hilite_padding":4,
      "style/layout/border_width":1,"style/layout/round_corner":radius,"style/layout/corner_radius":radius+2,
      "style/layout/shadow_radius":3,"style/layout/shadow_offset_y":1,"style/layout/max_width":880}
    if cfg['spacing']=='标准':
        style.update({'style/layout/margin_x':10,'style/layout/margin_y':7,
                      'style/layout/spacing':8,'style/layout/candidate_spacing':8,
                      'style/layout/hilite_spacing':9,'style/layout/hilite_padding_x':6,
                      'style/layout/hilite_padding_y':4,'style/layout/linespacing':110,
                      'style/layout/baseline':88,'style/layout/shadow_radius':0,
                      'style/layout/shadow_offset_y':0,'style/layout/round_corner':6})
    if cfg.get('single_layout'):style.update({'style/inline_preedit':True,'style/preedit_type':'preview_all','style/layout/margin_x':-1,'style/layout/margin_y':-1})
    if cfg.get("hidden"):style["style/layout/margin_x"]=-1;style["style/layout/margin_y"]=-1
    if not cfg.get("index",True):style["style/label_font_point"]=0;style["style/label_format"]=""
    style['style/label_font_face']=cfg.get('code_font','Segoe UI');style['style/comment_font_face']='Yuniversus:e000:f8ff, '+cfg.get('root_font','SimSun')+', SimSun-ExtB, Segoe UI Symbol'
    for side in sides:
        bg,hi=colors[side][skin];accent=cfg.get('accent_'+side,'').strip().lstrip('#');
        if accent:
            if not re.fullmatch('[0-9a-fA-F]{6}',accent):raise ValueError('高亮颜色须为 #RRGGBB。')
            hi=accent
        fg=textcolor(bg);sel=textcolor(hi)
        def mix(a,b,r):return ''.join('%02x'%round(int(a[i:i+2],16)*r+int(b[i:i+2],16)*(1-r)) for i in (0,2,4))
        shade=mix(fg,bg,.62);border=mix(fg,bg,.18)
        v=dict(back_color=bg,text_color=fg,candidate_text_color=fg,label_color=shade,comment_text_color=shade,border_color=border,
          hilited_back_color=bg,hilited_text_color=fg,hilited_candidate_back_color=hi,hilited_candidate_text_color=sel,hilited_label_color=sel,
          hilited_comment_text_color=sel,hilited_mark_color=None,shadow_color=None)
        style["preset_color_schemes/xm_"+side]={"name":cfg['skin']+" · "+side,"color_format":"argb"}|{k:('0xff'+c if c else ('0x22000000' if k=='shadow_color' else '0x00000000')) for k,c in v.items()}
    # Extracted from the same-version YUME settings controls, not screenshot sampling.
    official=BASE/'yume-palettes.json'
    if official.exists():
        data=json.loads(official.read_text(encoding='utf8'))[SKINS.index(cfg['skin'])]
        fields=appearance.colors(cfg,data)
        for side in sides:
            palette=style['preset_color_schemes/xm_'+side]
            for target,source in appearance.WEASEL.items():
                value=fields[side][source]
                if re.fullmatch(r'#[0-9a-fA-F]{6}',value):palette[target]='0xff'+value[1:].lower()
            accent=cfg.get('accent_'+side,'').strip().lstrip('#')
            if accent:
                palette['hilited_candidate_back_color']='0xff'+accent
                for field in ('hilited_candidate_text_color','hilited_comment_text_color','hilited_label_color'):palette[field]='0xff'+textcolor(accent)
    font_options=cfg.get('appearance',{}).get('font',{})
    latin=cfg.get('code_font') or cfg['font']
    style['style/font_face']=appearance.font_stack(cfg['font'],latin,font_options)
    style['style/comment_font_face']=appearance.font_stack(cfg.get('root_font') or cfg['font'],latin,font_options)
    style['style/label_font_face']=appearance.font_stack(latin,latin,font_options)
    for field,target in [('comment_size','comment'),('label_size','label')]:
        val=int(cfg.get(field) or 0)
        if val and not 6<=val<=96:raise ValueError('注解和序号字号范围为 6 至 96，填 0 为自动。')
        if val and (target!='label' or cfg.get('index',True)):style['style/'+target+'_font_point']=val
    style_text=emit_patch(style)
    switches=[{"name":"ascii_mode","reset":0,"states":["中文","西文"]},{"name":"ascii_punct","states":["中文标点","西文标点"]},{"name":"full_shape","states":["半角","全角"]},{"name":"xm_sentence","reset":int(cfg["mode"]=="整句"),"states":["逐字","整句"]},{"name":"xm_noivs","reset":int(not cfg["ivs"]),"states":["显示变体","隐藏变体"]}]
    for prefix,labels,index in [('xm_note',['关闭注解']+[item['name'] for item in profiles],cfg['note']),('xm_charset',['全部字集','常用字集','简体规范','传统通用','自定义字集'],cfg['charset'])]:
        switches.append({"options":[prefix+str(i) for i in range(len(labels))],"reset":int(index),"states":labels})
    switches += [{"name":"xm_nohints","reset":int(not cfg.get("candidate_prediction",True)),"states":["顶字候选预测","关闭候选预测"]},{"name":"xm_words","reset":int(cfg.get("word",False)),"states":["单字","字词"]},{"name":"xm_nopredict","reset":int(not cfg.get("predict",True)),"states":["预测","顺序"]},{"name":"xm_delay","reset":int(cfg["mode"]=="顶字"),"states":["自动","顶字"]}]
    switches.append({"name":"xm_fullprefix","reset":int(cfg.get("prefix_completion",False)),"states":["单键补全","任意前缀补全"]})
    sort=["原始","常用优先","简体优先","传统优先","自定义优先"].index(cfg.get("sort","原始"))
    switches.append({"options":["xm_sort"+str(i) for i in range(5)],"reset":sort,"states":["原始","常用优先","简体优先","传统优先","自定优先"]})
    labels=LABELS[cfg['labels']]
    if cfg['labels']=='外观文件' and cfg.get('imported_glyphs'):
        import unicodedata
        labels=[]
        for glyph in cfg['imported_glyphs']:
            if labels and (unicodedata.category(glyph).startswith('M') or ord(glyph) in range(0xe0100,0xe01f0)):labels[-1]+=glyph
            else:labels.append(glyph)
        if len(labels)!=9:raise ValueError('外观文件里的自定义序号需要九个字形。')
    patch={"switches":switches+[{"name":"xm_noquickhint","reset":int(not cfg.get("hint",True)),"states":["提示空格简码","隐藏空格简码"]}],"speller/auto_select_pattern":"^([defijk]|.{2,})$","menu/page_size":page,"menu/alternative_select_labels":list(labels),
      "engine/processors/@before 0":"lua_processor@*xm_process","engine/translators/@before 0":"lua_translator@*xm_translate",
      "engine/filters/@before 0":"lua_filter@*xm_filter","recognizer/patterns/xm_tools":"^(/.*|;|:|~.*|[!#].+|=[.,:])$"}
    mappings=cfg.get('functional_keys',{})
    if mappings:
        specification=json.loads((BASE/'functional-keys.json').read_text(encoding='utf8'))
        for key,actions in mappings.items():
            if key not in specification['keys'] or len(actions)!=3:raise ValueError('功能键设置格式有误。')
            contexts=specification['keys'][key]['contexts']
            if any(a!='default' and a not in ctx['actions'] for a,ctx in zip(actions,contexts)):
                raise ValueError('当前按键状态不支持所选动作。')
            if any(a!='default' for a in actions):patch['xm_keys/'+key]=','.join(actions)
    keys=[KEYS[cfg.get(k,DEFAULT[k])] for k in ('second','third','pgup','pgdn')]
    if len(set(keys))!=4 or set(keys)&{'slash','space'}:raise ValueError('候选和翻页键需要互不相同。')
    patch['key_binder/bindings']=[{'when':'has_menu','accept':keys[0],'send':2},{'when':'has_menu','accept':keys[1],'send':3},{'when':'has_menu','accept':'space','send':1},{'when':'composing','accept':'space','send':'underscore'},{'when':'paging','accept':keys[2],'send':'Page_Up'},{'when':'has_menu','accept':keys[3],'send':'Page_Down'}]
    patch['xm_options/second']=keys[0];patch['xm_options/third']=keys[1]
    patch['xm_options/sentence_space']=['空格上屏','只分隔未完成的编码段','分隔所有编码段'].index(cfg.get('sentence_space','空格上屏'))
    patch['xm_options/tracks']=TRACK_ORDERS.get(cfg.get('track','全部'),'SFT')
    patch['xm_options/quick_complete']='yes' if cfg.get('quick_complete') else 'no'
    patch['xm_options/note_count']=len(profiles)
    for i,profile in enumerate(profiles,1):
        patch['xm_options/note_fields'+str(i)]=','.join(profile['fields'])
    patch['xm_options/word_annotation']='last' if cfg.get('word_last',True) else 'off'
    patch['xm_options/direction']='horizontal' if cfg['direction']=='横排' else 'vertical'
    patch['xm_options/word_lengths']=cfg.get('word_lengths','234+')
    patch['xm_options/uppercase']=UPPERCASE.index(cfg.get('uppercase',UPPERCASE[3]))
    patch['xm_options/digits']=DIGITS.index(cfg.get('digits',DIGITS[0]))
    patch['xm_options/digit_outside']=bool(cfg.get('digit_outside',False))
    patch['xm_options/commit_on_switch']=bool(cfg.get('commit_on_switch',False))
    appearance.write_native_header(BASE,cfg)
    atomic(PROFILE/'weasel.custom.yaml',style_text)
    atomic(PROFILE/'xiaoming.custom.yaml',emit_patch(patch))
    atomic(BASE/'runtime.tsv',runtime_text(cfg))
    atomic(BASE/'shortcuts.tsv',shortcuts)
def deploy():
    result=subprocess.run([str(DEPLOY),'/deploy'],creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:raise RuntimeError('小狼毫部署失败，退出码 '+str(result.returncode))
def auto_code(word,meta):
    rows=[meta.get(ch) for ch in word]
    if not rows or any(not v for v in rows):return ''
    if len(rows)==1:return max(rows[0][1].split(),key=len)
    r=[v[5].split() for v in rows]
    if any(not a or '?' in a for a in r):return ''
    a,b=r[0],r[-1]
    if len(r)==2:return (a[0][:2]+(a[-1][0] if len(a)>1 else '')+(b[0][0]+b[-1][:2] if len(b)>1 else b[0][:2]))[:5]
    if len(r)==3:return a[-1][:2]+r[1][-1][0]+(b[0][0]+b[-1][0] if len(b)>1 else b[0][:2])
    return a[-1][:2]+r[1][-1][0]+r[2][-1][0]+b[-1][0]
def run():
    root=tk.Tk();root.title('潇明 · 小狼毫设置');root.geometry('940x650');root.minsize(800,565)
    style=ttk.Style(root);style.configure('Header.TLabel',font=('Microsoft YaHei UI',17))
    shell=ttk.Frame(root,padding=16);shell.pack(fill='both',expand=True)
    ttk.Label(shell,text='潇明输入设置',style='Header.TLabel').pack(anchor='w',pady=(0,10))
    body=ttk.Frame(shell);body.pack(fill='both',expand=True)
    sidebar=tk.Listbox(body,width=14,exportselection=False,activestyle='none',borderwidth=0,
                       font=('Microsoft YaHei UI',11),selectbackground='#1f4e79',selectforeground='#ffffff')
    sidebar.pack(side='left',fill='y',padx=(0,10))
    style.layout('Pages.TNotebook.Tab',[])
    book=ttk.Notebook(body,style='Pages.TNotebook');book.pack(side='left',fill='both',expand=True)
    tabs={};pages={};field_boxes={};field_counts={}
    sections=('输入方案','上屏','整句','字集','自定义字集','词语','候选外观','字体与配色','极简内嵌','注解','功能键','快捷键','快捷字符','关于','字根查阅')
    for name in sections:
        outer=ttk.Frame(book,padding=12);book.add(outer,text=name);pages[name]=outer
        ttk.Label(outer,text=name,style='Header.TLabel').pack(anchor='w',pady=(0,10))
        tabs[name]=ttk.Frame(outer);tabs[name].pack(fill='both',expand=True)
        sidebar.insert('end',name)
    def navigate(name):
        idx=sections.index(name)
        sidebar.selection_clear(0,'end');sidebar.selection_set(idx);sidebar.activate(idx);sidebar.see(idx)
        book.select(pages[name])
    sidebar.bind('<<ListboxSelect>>',lambda e:navigate(sections[sidebar.curselection()[0]]) if sidebar.curselection() else None)
    def field_box(name):
        if name not in field_boxes:
            field_boxes[name]=ttk.Frame(tabs[name]);field_boxes[name].pack(anchor='nw',fill='x',pady=4)
            field_counts[name]=0
        return field_boxes[name]
    def place_field(name,title,variable,options=None):
        box=field_box(name);i=field_counts[name];field_counts[name]+=1
        row,col=divmod(i,2);col*=2
        ttk.Label(box,text=title).grid(row=row,column=col,sticky='w',padx=3,pady=4)
        widget=ttk.Combobox(box,textvariable=variable,values=options,width=16,state='readonly') if options is not None else ttk.Entry(box,textvariable=variable,width=18)
        widget.grid(row=row,column=col+1,sticky='w',padx=(2,10),pady=4)
        return widget
    cfg=conf();vars={}
    for key,title,choices in [('uppercase','大写字母',UPPERCASE),('digits','数字键',DIGITS)]:
        vars[key]=tk.StringVar(value=cfg[key]);place_field('上屏',title,vars[key],choices).configure(width=28)
    for key,title in [('digit_outside','数字超出候选数时直接上屏'),('commit_on_switch','切换方案时自动上屏高亮候选')]:
        vars[key]=tk.BooleanVar(value=cfg[key]);ttk.Checkbutton(tabs['上屏'],text=title,variable=vars[key]).pack(anchor='w',pady=3)
    ttk.Label(tabs['输入方案'],text='潇明 · 官方完整码表',font=('Microsoft YaHei UI',13)).pack(anchor='w',pady=6)
    ttk.Label(tabs['输入方案'],text='124,233 条编码。F4 切换输入方案，Ctrl+Shift+I 打开方案选择器。').pack(anchor='w',pady=6)
    ttk.Button(tabs['输入方案'],text='打开小狼毫方案管理',command=lambda:subprocess.Popen([str(DEPLOY)],cwd=DEPLOY.parent)).pack(anchor='w',pady=6)
    ttk.Label(tabs['关于'],text='潇明 v2 · 小狼毫\nYUME 对照版本 3.14.0-beta.20261028234829',justify='left').pack(anchor='w',pady=6)
    ttk.Button(tabs['关于'],text='打开本机使用说明',command=lambda:os.startfile(str(BASE/'功能与按键.txt'))).pack(anchor='w')
    notes=['关闭']+[profile['name'] for profile in cfg['note_profiles']];sets=["全部","常用","简体规范","传统通用","自定义"]
    fields=[('skin','主题',SKINS),('spacing','间距与圆角',LAYOUT),('day','明暗',['跟随系统','固定浅色','固定深色']),('direction','排列',['纵列','横排']),('font','候选字体',['Noto Serif CJK SC','SimSun','Microsoft YaHei UI','LXGW WenKai','Yu Mincho','KaiTi']),('size','字号',list(range(6,97))),('page','每页候选',list(range(3,10))),('labels','序号',list(LABELS)),('inline','编码位置',['面板编码','行内编码']),('mode','启动模式',['逐字','整句','顶字']),('note','初始注解',notes),('charset','初始字集',sets),('sort','候选排序',['原始','常用优先','简体优先','传统优先','自定义优先'])]
    destinations={'skin':'字体与配色','spacing':'字体与配色','day':'字体与配色','font':'字体与配色','size':'字体与配色','labels':'字体与配色',
                  'mode':'上屏','charset':'字集','sort':'字集','inline':'极简内嵌'}
    for k,label,options in fields:
        val=options[cfg[k]] if k in ('note','charset') else cfg[k]
        v=tk.StringVar(value=val);vars[k]=v
        widget=place_field(destinations.get(k,'候选外观'),label,v,options)
        if k=='note':initial_note_picker=widget
    sentence_tab=tabs['整句']
    ttk.Label(sentence_tab,text='整句字集轨道').pack(anchor='w',pady=6)
    ttk.Label(sentence_tab,text='第一条轨道决定首选。其他轨道产生不同的整句时，可在候选列表中另选。').pack(anchor='w',pady=6)
    vars['track']=tk.StringVar(value=cfg.get('track') if cfg.get('track') in TRACK_ORDERS else next(iter(TRACK_ORDERS)))
    ttk.Combobox(sentence_tab,textvariable=vars['track'],values=list(TRACK_ORDERS),state='readonly',width=36).pack(anchor='w')
    ttk.Label(sentence_tab,text='整句中的空格键').pack(anchor='w',pady=(16,5))
    vars['sentence_space']=tk.StringVar(value=cfg.get('sentence_space','空格上屏'))
    ttk.Combobox(sentence_tab,textvariable=vars['sentence_space'],values=['空格上屏','只分隔未完成的编码段','分隔所有编码段'],state='readonly',width=36).pack(anchor='w')
    note_tab=tabs['注解']
    ttk.Label(note_tab,text='启用的档位按从上到下的顺序循环。每档至少勾选一项。').grid(row=0,column=0,columnspan=9,sticky='w',pady=8)
    for col,title in enumerate(['启用','名称',*NOTE_FIELDS.values()]):
        ttk.Label(note_tab,text=title).grid(row=1,column=col,padx=3)
    note_rows=[]
    for index in range(8):
        item=cfg['note_profiles'][index] if index<len(cfg['note_profiles']) else None
        enabled=tk.BooleanVar(value=item is not None)
        name=tk.StringVar(value=item['name'] if item else '')
        flags={field:tk.BooleanVar(value=bool(item and field in item['fields'])) for field in NOTE_FIELDS}
        ttk.Checkbutton(note_tab,variable=enabled).grid(row=index+2,column=0)
        ttk.Entry(note_tab,textvariable=name,width=14).grid(row=index+2,column=1,padx=3,pady=3)
        for col,flag in enumerate(flags.values(),2):
            ttk.Checkbutton(note_tab,variable=flag).grid(row=index+2,column=col)
        note_rows.append((enabled,name,flags))
    vars['word_last']=tk.BooleanVar(value=cfg['word_last'])
    ttk.Checkbutton(note_tab,text='多字候选显示末字的注解',variable=vars['word_last']).grid(row=10,column=0,columnspan=9,sticky='w',pady=8)
    for i,(k,label) in enumerate([('preview','行内预览首选候选'),('ivs','显示异体字序列'),('word','启用 YUME 词组'),('predict','启用整句搭配与词频预测'),('index','显示候选序号'),('footer','显示方案页脚'),('hidden','隐藏候选窗'),('hint','提示一码空格简码'),('single_layout','极简行内候选'),('candidate_prediction','显示末码预测候选'),('prefix_completion','扩展为任意前缀补全')]):
        where={'preview':'极简内嵌','single_layout':'极简内嵌','ivs':'字集','word':'词语','predict':'整句','hint':'上屏','candidate_prediction':'上屏','prefix_completion':'上屏'}.get(k,'候选外观')
        v=tk.BooleanVar(value=cfg.get(k,DEFAULT[k]));vars[k]=v
        ttk.Checkbutton(tabs[where],text=label,variable=v).pack(anchor='w',pady=3)
    def editor(tab,description,filename):
        panel=tabs[tab];ttk.Label(panel,text=description,wraplength=630).pack(anchor='w')
        box=tk.Text(panel,wrap='none',height=8,undo=True,font=('Microsoft YaHei UI',11))
        box.pack(fill='both',expand=True,pady=4)
        path=BASE/filename
        if path.exists():box.insert('1.0',path.read_text(encoding='utf8'))
        return box
    words=editor('词语','每行填写「词语  编码  权重」。只填词语会按潇明末根规则取码；多个编码可分多行。','words.txt')
    def transfer(save):
        f=filedialog.asksaveasfilename(defaultextension='.tsv') if save else filedialog.askopenfilename()
        if f:
            if save:Path(f).write_text(words.get('1.0','end-1c'),encoding='utf8')
            else:words.insert('end','\n'+Path(f).read_text(encoding='utf-8-sig'))
    bar=ttk.Frame(tabs['词语']);bar.pack(fill='x')
    for label,val in [('追加导入',False),('导出',True)]:ttk.Button(bar,text=label,command=lambda v=val:transfer(v)).pack(side='left')
    quick=editor('快捷字符','每行一个小写字母、一个空格、一段快捷文本。清空后可关闭快捷字符。','quick.tsv')
    if not cfg.get('quick_complete'):
        defaults={}
        for filename in ('quick-defaults.tsv','quick.tsv'):
            path=BASE/filename
            if path.exists():
                for line in path.read_text(encoding='utf8').splitlines():
                    if '\t' in line:
                        key,value=line.split('\t',1)
                        defaults[key]=value
        quick.delete('1.0','end')
        quick.insert('1.0','\n'.join(key+'\t'+value for key,value in defaults.items() if value))
    chars=tk.StringVar(value=(BASE/'charset.txt').read_text(encoding='utf8') if (BASE/'charset.txt').exists() else '')
    ttk.Label(tabs['自定义字集'],text='输入要保留的汉字，再在「字集」选择自定义。').pack(anchor='w',pady=5)
    ttk.Entry(tabs['自定义字集'],textvariable=chars).pack(fill='x');cache={}
    # 快捷造词单列于日志。用保存时的快照合并，保留窗口打开后新增的词。
    ledger=BASE/'created.tsv'
    learned=ledger.read_text(encoding='utf8') if ledger.exists() else ''
    if learned:words.insert('end','\n'+learned)
    def metadata():
        if not cache:
            for line in (BASE/'meta.tsv').read_text(encoding='utf8').splitlines():
                f=line.split('\t');cache[f[0]]=f[1:]
        return cache
    lookup=tabs['字根查阅'];q=tk.StringVar();ttk.Entry(lookup,textvariable=q).pack(fill='x');result=tk.Text(lookup,wrap='word',height=10,font=('Microsoft YaHei UI',12));result.pack(fill='both',expand=True)
    def search():
        word=q.get().strip();meta=metadata();row=meta.get(word)
        if not row:return
        roots,code,py,region,group,holo=row; similar=[]
        for ch,v in meta.items():
            if roots and ch!=word:
                it=iter(v[0])
                if all(r in it for r in roots):similar.append(ch)
                if len(similar)>=100:break
        result.delete('1.0','end');result.insert('end',f'{word}    {code}\n\n拆分   {roots}\n根码   {holo}\n拼音   {py}\n字区   {region}   '+ ' '.join(f'U+{ord(c):04X}' for c in word)+'\n\n含相同部件\n'+'  '.join(similar))
        if (BASE/'readings.tsv').exists():
            with (BASE/'readings.tsv').open(encoding='utf8') as f:
                for l in f:
                    if l.startswith(word+'\t'):
                        _,pron,meaning=l.rstrip('\r\n').split('\t',2);result.insert('end','\n\nUnihan   '+pron+'  '+meaning);break
        result.tag_configure('yuniversus',font=('Yuniversus',12))
        pos='1.0'
        while True:
            pos=result.search('[\ue000-\uf8ff]',pos,stopindex='end',regexp=True)
            if not pos:break
            end=result.index(pos+'+1c');result.tag_add('yuniversus',pos,end);pos=end
    b=ttk.Frame(lookup);b.pack(fill='x');ttk.Button(b,text='查本地字料',command=search).pack(side='left');ttk.Button(b,text='在汉典查这个字词 ↗',command=lambda:webbrowser.open('https://www.zdic.net/hans/'+quote(q.get().strip())) if q.get().strip() else None).pack(side='left')
    ttk.Label(tabs['快捷键'],text='Ctrl+Shift+O   打开设置       Ctrl+Shift+U   打开个人词库\nCtrl+Shift+D   单字／词组     Ctrl+Shift+Y   顶字候选预测\nCtrl+Shift+M   逐字／整句     Ctrl+Shift+I   全拼\n选字时 /    循环注解       0    循环字集       ; 和单引号    选二、三\nTab    查当前字    Shift+Tab    含相同部件的字    Esc    返回\nz    本次输入历史     z+拼音    反查形码     //56e7    Unicode\n空缓冲 ; 加字母    快捷字符     /    命令列表\n整句输入编码后按 Tab，a–t 或左右键定位，数字换字，退格撤销。\n空格确认，Enter 可提交至当前字。空格一码简仍用空格收码。\nF4    方案切换      /flypy    小鹤双拼      /ziran    自然码双拼',justify='left').pack(anchor='nw')
    key_tab=tabs['功能键']
    ttk.Label(key_tab,text='按键依据当前输入状态执行。选择「沿用方案」可恢复这个位置的原有行为。').pack(anchor='w')
    frame=ttk.Frame(key_tab);frame.pack(fill='both',expand=True,pady=5)
    canvas=tk.Canvas(frame,highlightthickness=0)
    scroll=ttk.Scrollbar(frame,orient='vertical',command=canvas.yview)
    canvas.configure(yscrollcommand=scroll.set)
    canvas.pack(side='left',fill='both',expand=True);scroll.pack(side='right',fill='y')
    grid=ttk.Frame(canvas);canvas.create_window((0,0),window=grid,anchor='nw')
    grid.bind('<Configure>',lambda e:canvas.configure(scrollregion=canvas.bbox('all')))
    spec=json.loads((BASE/'functional-keys.json').read_text(encoding='utf8'))
    action_names={'default':'沿用方案'}|spec['actions'];action_ids={label:key for key,label in action_names.items()}
    key_vars={}
    for i,caption in enumerate(('按键','无编码','有编码无候选','有候选')):
        ttk.Label(grid,text=caption).grid(row=0,column=i,sticky='w',padx=2,pady=5)
    for row,(key,item) in enumerate(spec['keys'].items(),1):
        ttk.Label(grid,text=item['name']).grid(row=row,column=0,sticky='w',padx=2)
        key_vars[key]=[]
        saved=cfg.get('functional_keys',{}).get(key,['default']*3)
        for col,(context,selected) in enumerate(zip(item['contexts'],saved),1):
            labels=[action_names[a] for a in ['default',*context['actions']]]
            variable=tk.StringVar(value=action_names.get(selected,'沿用方案'));key_vars[key].append(variable)
            ttk.Combobox(grid,textvariable=variable,values=labels,state='readonly',width=18).grid(row=row,column=col,padx=2,pady=2)
    def reset_keys():
        for variables in key_vars.values():
            for variable in variables:variable.set('沿用方案')
    ttk.Button(key_tab,text='功能键全部沿用方案',command=reset_keys).pack(anchor='w')
    shortcut_vars={};shortcut_guard=False
    shortcut_box=ttk.Frame(tabs['快捷键']);shortcut_box.pack(fill='x')
    ttk.Label(shortcut_box,text='Ctrl+Shift+所选键；另一种截图额外按 Alt。改动立即生效。').grid(row=0,column=0,columnspan=4,sticky='w')
    def update_shortcut(action):
        nonlocal shortcut_guard
        if shortcut_guard:return
        shortcut_guard=True
        try:
            value=shortcut_vars[action].get();alt=next(a for k,_,_,a in SHORTCUTS if k==action)
            if value=='Enter' and not alt and action!='annotation':
                shortcut_vars[action].set('未绑定');value='未绑定'
            if value!='未绑定':
                for other,_,_,other_alt in SHORTCUTS:
                    if other!=action and alt==other_alt and shortcut_vars[other].get()==value:shortcut_vars[other].set('未绑定')
            values={k:'' if v.get()=='未绑定' else v.get() for k,v in shortcut_vars.items()}
            atomic(BASE/'shortcuts.tsv',shortcut_text(values))
            current=conf();current['shortcuts']=values;atomic(BASE/'settings.json',js(current))
        except (OSError,ValueError) as e:messagebox.showerror('快捷键',str(e))
        finally:shortcut_guard=False
    for i,(action,caption,default,alt) in enumerate(SHORTCUTS):
        row=i%13+1;col=(i//13)*2
        ttk.Label(shortcut_box,text=caption+('（Alt）' if alt else '')).grid(row=row,column=col,sticky='w',padx=4,pady=2)
        v=tk.StringVar(value=(DEFAULT_SHORTCUTS|cfg.get('shortcuts',{}))[action] or '未绑定');shortcut_vars[action]=v
        widget=ttk.Combobox(shortcut_box,textvariable=v,values=['未绑定',*SHORTCUT_KEYS[1:]],state='readonly',width=8)
        widget.grid(row=row,column=col+1,padx=4,pady=2);widget.bind('<<ComboboxSelected>>',lambda e,a=action:update_shortcut(a))
    extra=[('second','选第二候选',list(KEYS)),('third','选第三候选',list(KEYS)),('pgup','向前翻页',list(KEYS)),('pgdn','向后翻页',list(KEYS)),('comment_size','注解字号（0 自动）',None),('label_size','序号字号（0 自动）',None),('code_font','序号字体',None),('root_font','注解字体',None),('accent_light','浅色高亮（留空跟随主题）',None),('accent_dark','深色高亮（留空跟随主题）',None),('word_lengths','词长筛选（2、3、4、+ 表示五字以上）',None)]
    for k,title,options in extra:
        vars[k]=tk.StringVar(value=cfg.get(k,DEFAULT[k]))
        where='快捷键' if k in ('second','third','pgup','pgdn') else '词语' if k=='word_lengths' else '字体与配色'
        place_field(where,title,vars[k],options)
    style_keys=('skin','spacing','day','direction','font','size','labels','inline','index','preview','accent_light','accent_dark','code_font','root_font','single_layout','label_size','comment_size')
    extra_style={key:cfg[key] for key in ('appearance','appearance_skin','imported_glyphs') if key in cfg}
    def current_style():
        result=conf()|extra_style|{key:vars[key].get() for key in style_keys}
        for key in ('size','label_size','comment_size'):result[key]=int(result[key] or 0)
        return result
    def export_style():
        f=filedialog.asksaveasfilename(defaultextension='.toml',filetypes=[('YUME 外观','*.toml'),('小狼毫外观','*.json')])
        if not f:return
        try:
            values=current_style()
            if Path(f).suffix.lower()=='.toml':
                raw=json.loads((BASE/'yume-palettes.json').read_text(encoding='utf8'))[SKINS.index(values['skin'])]
                doc=appearance.document(values,raw)
                glyphs=values.get('imported_glyphs','') if values['labels']=='外观文件' else ''.join(LABELS[values['labels']])
                doc.setdefault('index',{})['glyphs']='' if glyphs=='123456789' else glyphs
                atomic(Path(f),appearance.dumps(doc))
            else:atomic(Path(f),js({k:values[k] for k in (*style_keys,*extra_style)}))
        except (ValueError,OSError,TypeError) as e:messagebox.showerror('导出外观',str(e))
    def import_style():
        f=filedialog.askopenfilename(filetypes=[('YUME / 小狼毫外观','*.toml *.json')])
        if not f:return
        try:
            if Path(f).suffix.lower()=='.toml':
                raw=json.loads((BASE/'yume-palettes.json').read_text(encoding='utf8'))
                data=appearance.import_config(current_style(),appearance.read(Path(f)),raw,SKINS)
                glyphs=data.get('imported_glyphs','')
                data['labels']=next((key for key,val in LABELS.items() if ''.join(val)==glyphs),'外观文件') if glyphs else '数字'
            else:data=json.loads(Path(f).read_text(encoding='utf-8-sig'))
            for k in style_keys:
                if k in data:vars[k].set(data[k])
            extra_style.clear()
            extra_style.update({key:data[key] for key in ('appearance','appearance_skin','imported_glyphs') if key in data})
        except (OSError,ValueError,KeyError,TypeError) as e:messagebox.showerror('导入外观',str(e))
    rowbar=ttk.Frame(tabs['字体与配色']);rowbar.pack(anchor='w',pady=6)
    ttk.Button(rowbar,text='导出外观',command=export_style).pack(side='left')
    ttk.Button(rowbar,text='导入外观',command=import_style).pack(side='left')
    def save():
        try:
            new=conf()|extra_style|{k:v.get() for k,v in vars.items()};selected_note=new['note']
            new['shortcuts']={k:'' if v.get()=='未绑定' else v.get() for k,v in shortcut_vars.items()}
            profiles=[{'name':name.get().strip(),'fields':[field for field,flag in flags.items() if flag.get()]} for enabled,name,flags in note_rows if enabled.get()]
            validate_profiles(profiles)
            names=['关闭']+[profile['name'] for profile in profiles]
            new['functional_keys']={key:[action_ids[v.get()] for v in variables] for key,variables in key_vars.items()
                                    if any(v.get()!='沿用方案' for v in variables)}
            new['note_profiles']=profiles
            new['note']=names.index(selected_note) if selected_note in names else 0
            new['charset']=sets.index(new['charset']);new['size']=int(new['size']);new['page']=int(new['page'])
            wordtext=words.get('1.0','end-1c');data=[]
            for i,line in enumerate(wordtext.splitlines(),1):
                if not line.strip():continue
                parts=line.split();w=parts[0];c=parts[1] if len(parts)>1 else auto_code(w,metadata())
                if len(parts)>3 or not re.fullmatch('[a-y_]{1,5}',c):raise ValueError(f'词库第 {i} 行不能自动编码或编码无效，请填写编码。')
                weight=int(parts[2]) if len(parts)>2 else 0
                if weight<0:raise ValueError('权重须为非负整数')
                data.append((w,c,weight))
            shortcuts={}
            for line in quick.get('1.0','end-1c').splitlines():
                if not line.strip():continue
                k,v=line.split('\t',1) if '\t' in line else line.split(None,1)
                if not re.fullmatch('[a-z]',k):raise ValueError('快捷字符须用 a–z 引导。')
                shortcuts[k]=v
            new['quick_complete']=True
            if new['charset']==4 and not chars.get().strip():raise ValueError('请先填写自定义字集。')
            if not re.fullmatch(r'[234+]*',new['word_lengths']):raise ValueError('词长筛选只接受 2、3、4、+。')
            config_files(new);atomic(BASE/'settings.json',js(new));atomic(BASE/'words.txt',wordtext)
            atomic(BASE/'user.tsv',''.join(f'{w}\t{c}\t{n}\n' for w,c,n in sorted(data,key=lambda v:-v[2])))
            atomic(BASE/'quick.tsv',''.join(f'{k}\t{v}\n' for k,v in shortcuts.items()));atomic(BASE/'charset.txt',chars.get().strip())
            if ledger.exists() and learned:
                current=ledger.read_text(encoding='utf8')
                if current.startswith(learned):atomic(ledger,current[len(learned):])
            deploy()
            notes[:]=names
            initial_note_picker.configure(values=names)
            vars['note'].set(names[new['note']])
            last_runtime['note']=new['note']
            messagebox.showinfo('潇明','已重新部署。')
        except Exception as e:messagebox.showerror('潇明',str(e))
    ttk.Button(shell,text='功能与快捷键对照',command=lambda:os.startfile(str(BASE/'功能与按键.txt'))).pack(side='left',pady=(10,0))
    ttk.Button(shell,text='保存并应用到小狼毫',command=save).pack(anchor='e',pady=(10,0))
    navigate({'words':'词语','lookup':'字根查阅','keys':'功能键','about':'关于','candidates':'候选外观'}.get(sys.argv[1] if len(sys.argv)>1 else '','上屏'))
    last_runtime={k:cfg[k] for k in RUNTIME_FIELDS}
    def refresh_runtime():
        current=conf()
        for k in RUNTIME_FIELDS:
            old=last_runtime[k];new=current[k]
            def display(v):return notes[min(v,len(notes)-1)] if k=='note' else sets[v] if k=='charset' else v
            if k in vars and new!=old and vars[k].get()==display(old):vars[k].set(display(new))
            last_runtime[k]=new
        root.after(500,refresh_runtime)
    root.after(500,refresh_runtime)
    if '--smoke' in sys.argv:root.after(250,root.destroy)
    root.mainloop()
if __name__=='__main__':
    if '--init' in sys.argv:config_files(conf())
    elif len(sys.argv)>1 and sys.argv[1]=='update':webbrowser.open('https://github.com/rime/weasel/releases')
    elif len(sys.argv)>1 and sys.argv[1]=='schemas':
        subprocess.Popen([str(DEPLOY)],cwd=DEPLOY.parent)
    elif len(sys.argv)==3 and sys.argv[1]=='panel':
        from live_panel import show
        show(sys.argv[2])
    elif len(sys.argv)==3 and sys.argv[1]=='web' and re.fullmatch(r'[0-9a-f]{2,256}',sys.argv[2]):
        word=bytes.fromhex(sys.argv[2]).decode('utf8')
        webbrowser.open(('https://zi.tools/zi/' if len(word)==1 else 'https://www.zdic.net/hans/')+quote(word))
    elif len(sys.argv)==3 and sys.argv[1]=='capture_detail':
        from detail_capture import capture_token
        capture_token(sys.argv[2])
    elif len(sys.argv)>1 and sys.argv[1] in ('capture','capture_detail'):
        from capture import capture
        capture(detail=sys.argv[1]=='capture_detail',clipboard=True)
    elif len(sys.argv)>1 and sys.argv[1] in ('layout','hidden','index','preedit','preview','resetlook','resetsettings',*['page'+str(n) for n in range(3,10)]):
        action=sys.argv[1];cfg=conf()
        if action=='layout':cfg=cycle_layout(cfg)
        elif action=='resetsettings':cfg=reset_input_settings(cfg)
        elif action=='preedit':cfg['inline']='行内编码' if cfg['inline']=='面板编码' else '面板编码'
        elif action in ('index','hidden','preview'):cfg[action]=not cfg[action]
        elif action=='resetlook':
            for k in ('skin','spacing','direction','day','size','font','labels','hidden','index','inline','preview'):cfg[k]=DEFAULT[k]
        else:cfg['page']=int(action[-1])
        config_files(cfg);atomic(BASE/'settings.json',js(cfg));deploy()
    else:run()


