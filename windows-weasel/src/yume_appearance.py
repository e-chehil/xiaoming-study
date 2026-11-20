"""YUME v1 appearance files and the Weasel fields which can represent them."""
import copy
import json
import math
import os
import re
import tempfile

try:
    import tomllib
except ImportError:
    from pip._vendor import tomli as tomllib

FIELDS=('candidate','comment','index','subscript','header','footer','background','border','highlight',
        'highlight_special','highlight_reverse','highlight_text','highlight_sub')
DAYS={'跟随系统':'auto','固定浅色':'light','固定深色':'dark'}
WEASEL={'candidate_text_color':'candidate','comment_text_color':'comment','label_color':'index',
        'text_color':'header','hilited_text_color':'header','back_color':'background','hilited_back_color':'background',
        'border_color':'border','hilited_candidate_back_color':'highlight','hilited_candidate_text_color':'highlight_text',
        'hilited_comment_text_color':'highlight_sub','hilited_label_color':'highlight_sub'}

YUME_DEFAULT_FALLBACK=('WenJin Mincho Plane 0', 'WenJin Mincho Plane 2', 'WenJin Mincho Plane 3', 'Yuniversus', 'TH-Tshyn-P0', 'TH-Tshyn-P1', 'TH-Tshyn-P2', 'TH-Tshyn-P16', 'Yu Mincho', 'WenJinMinchoP0-Regular', 'WenJinMinchoP2-Regular', 'WenJinMinchoP3-Regular', 'SimSun', 'NSimSun', 'PMingLiU', 'MingLiU', 'MS Mincho', 'Microsoft YaHei UI')

def font_stack(primary,latin,font):
    markers=[face+':e000:f8ff' for face in (font.get('pua_fallback') or ('Yuniversus','SunmanPUA'))]
    families=[latin+':0020:007e',*markers,primary,*(font.get('fallback') or YUME_DEFAULT_FALLBACK)]
    return ', '.join(dict.fromkeys(families))

def preset(raw):
    return {side:{field:raw[side][str(16416+i)] for i,field in enumerate(FIELDS)} for side in ('light','dark')}

def colors(cfg, raw):
    values=preset(raw)
    imported=cfg.get('appearance',{})
    if cfg.get('appearance_skin')==cfg['skin']:
        for side in values:
            values[side].update(imported.get('color',{}).get(side,{}))
    for side,table in values.items():
        accent=cfg.get('accent_'+side,'').strip().lstrip('#')
        if accent:
            if not re.fullmatch('[a-fA-F0-9]{6}',accent):
                raise ValueError('高亮颜色须为 #RRGGBB。')
            table['highlight']='#'+accent
    return values

def read(path):
    data=tomllib.loads(path.read_text(encoding='utf-8-sig'))
    if data.get('version')!=1 or not isinstance(data.get('color'),dict):
        raise ValueError('请选择 YUME 的 version = 1 外观 TOML 文件。')
    for name in ('color','font','size','index'):
        if not isinstance(data.get(name,{}),dict):
            raise ValueError('外观字段格式错误 '+name)
    for side in ('light','dark'):
        table=data['color'].get(side,{})
        if not isinstance(table,dict):
            raise ValueError('配色必须是 TOML 表。')
        for key in FIELDS:
            value=table.get(key,'auto')
            if not isinstance(value,str) or (value!='auto' and not re.fullmatch(r'#[a-fA-F0-9]{6}',value)):
                raise ValueError('颜色无效 '+side+'.'+key)
    for key in ('candidate','comment','index','subscript','header','footer'):
        value=data.get('size',{}).get(key,10)
        if not isinstance(value,(int,float)) or isinstance(value,bool) or not 6<=value<=96:
            raise ValueError('字号范围为 6 至 96 点。')
    for key in ('family','latin','zigen'):
        if not isinstance(data.get('font',{}).get(key,''),str):
            raise ValueError('字体名称必须是字符串。')
    for key in ('fallback','pua_fallback'):
        value=data.get('font',{}).get(key,[])
        if not isinstance(value,list) or not all(isinstance(item,str) for item in value):
            raise ValueError('字体回退表必须是字符串列表。')
    return data

def import_config(cfg,data,palettes,skins):
    result=copy.deepcopy(cfg)
    for index,raw in enumerate(palettes):
        values=preset(raw)
        if all(str(data['color'].get(side,{}).get(key,'')).lower()==v.lower() for side in values for key,v in values[side].items()):
            result['skin']=skins[index]
            break
    result.update(appearance=copy.deepcopy(data),appearance_skin=result['skin'],accent_light='',accent_dark='')
    mode=data['color'].get('mode','auto')
    result['day']=next((label for label,val in DAYS.items() if mode==val),'跟随系统')
    font=data.get('font',{})
    # An empty YUME family asks the OS for its serif fallback.
    result['font']=font.get('family') or 'Yu Mincho'
    result['code_font']=font.get('latin') or result['font']
    result['root_font']=font.get('zigen') or result['font']
    for target,source in [('size','candidate'),('comment_size','comment'),('label_size','index')]:
        if source in data.get('size',{}):result[target]=int(data['size'][source])
    glyphs=data.get('index',{}).get('glyphs','')
    if glyphs and not isinstance(glyphs,str):raise ValueError('候选序号格式错误。')
    result['imported_glyphs']=glyphs
    return result

def document(cfg,raw):
    result=copy.deepcopy(cfg.get('appearance') or {})
    result['version']=1
    font=result.setdefault('font',{})
    for role,field in [('family','font'),('latin','code_font'),('zigen','root_font')]:
        chosen=cfg[field]
        inherited='Yu Mincho' if role=='family' else cfg['font']
        if not (role in font and not font[role] and chosen==inherited):font[role]=chosen
    font.setdefault('fallback',[]);font.setdefault('pua_fallback',[])
    color=result.setdefault('color',{})
    color.update(colors(cfg,raw));color['mode']=DAYS[cfg['day']]
    size=result.setdefault('size',{})
    size.update(candidate=int(cfg['size']),comment=int(cfg.get('comment_size') or max(10,cfg['size']-5)),
                index=int(cfg.get('label_size') or max(9,cfg['size']-6)))
    return result

def write_native_header(directory,cfg):
    """Write the DirectWrite header settings in Windows Unicode INI format."""
    doc=cfg.get('appearance',{})
    point=int(doc.get('size',{}).get('header',10))
    if not 6<=point<=96:
        raise ValueError('编码行字号范围为 6 至 96 点。')
    font=doc.get('font',{})
    face=font.get('header') or cfg.get('code_font') or cfg['font']
    if not isinstance(face,str) or any(ord(c)<32 for c in face):
        raise ValueError('编码行字体名称无效。')
    face=font_stack(face,face,font)
    raw=json.loads((directory/'yume-palettes.json').read_text(encoding='utf8'))
    skin_names=['宇梦','仿 macOS','仿微软拼音','墨香','霁蓝','烛火','石绿','烟岚','流萤','月白','赭石','绀霞']
    palette=colors(cfg,raw[skin_names.index(cfg['skin'])])
    def abgr(value):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}',value):return '00000000'
        return 'ff'+value[5:7]+value[3:5]+value[1:3]
    footer_point=int(doc.get('size',{}).get('footer',10))
    if not 6<=footer_point<=96:raise ValueError('页脚字号范围为 6 至 96 点。')
    footer_face=font_stack(cfg['font'],cfg.get('code_font') or cfg['font'],font)
    subscript_point=int(doc.get('size',{}).get('subscript',10))
    if not 6<=subscript_point<=96:raise ValueError('候选下标字号范围为 6 至 96 点。')
    payload=('[header]\r\npoint='+str(point)+'\r\nface='+face+'\r\n'
             '[footer]\r\nenabled='+str(int(cfg.get('footer',True)))+'\r\npoint='+str(footer_point)+'\r\nface='+footer_face+'\r\n'
             'color_light='+abgr(palette['light']['footer'])+'\r\ncolor_dark='+abgr(palette['dark']['footer'])+'\r\n'
             'background_dark='+abgr(palette['dark']['background'])+'\r\n'
             'subscript_point='+str(subscript_point)+'\r\nsubscript_light='+abgr(palette['light']['subscript'])+'\r\n'
             'subscript_dark='+abgr(palette['dark']['subscript'])+'\r\n'
             'special_light='+abgr(palette['light']['highlight_special'])+'\r\nspecial_dark='+abgr(palette['dark']['highlight_special'])+'\r\n'
             'reverse_light='+abgr(palette['light']['highlight_reverse'])+'\r\nreverse_dark='+abgr(palette['dark']['highlight_reverse'])+'\r\n').encode('utf-16')
    target=directory/'native-appearance.ini'
    if target.exists() and target.read_bytes()==payload:
        return
    fd,name=tempfile.mkstemp(dir=directory)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(payload)
        os.replace(name,target)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def dumps(data):
    lines=[]
    def quote_key(key):
        return key if re.fullmatch(r'[A-Za-z0-9_-]+',key) else json.dumps(key,ensure_ascii=False)
    def value(v):
        if isinstance(v,bool):return 'true' if v else 'false'
        if isinstance(v,int):return str(v)
        if isinstance(v,float) and math.isfinite(v):return repr(v)
        if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
        if isinstance(v,list):return '['+', '.join(value(item) for item in v)+']'
        raise ValueError('不支持的外观数据 '+type(v).__name__)
    def visit(table,path):
        if path:lines.extend(['','['+'.'.join(map(quote_key,path))+']'])
        for key,item in table.items():
            if not isinstance(item,dict):lines.append(quote_key(key)+' = '+value(item))
        for key,item in table.items():
            if isinstance(item,dict):visit(item,path+[key])
    visit(data,[])
    return '\n'.join(lines)+'\n'
