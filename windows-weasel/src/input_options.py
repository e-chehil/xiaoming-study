"""YUME input policies and configurable shortcut contract."""
import re

UPPERCASE = ['上屏候选并切换英文', '上屏编码并切换英文', '临时英文',
             '上屏候选并切换临时英文', '上屏候选及本字母']
DIGITS = ['直接上屏，标点由下一键决定', '直接上屏，后续标点用半角',
          '直接上屏，标点跟随全局', '直接上屏并切换英文', '数字进入缓存']
# Action, caption, default key, Alt modifier. Matches the installed YUME build.
SHORTCUTS = [
    ('appearance','打开设置','O',False), ('words','编辑用户词库','U',False),
    ('schemas','方案选择器','I',False), ('cycle_schema','轮换方案','N',False),
    ('charset','轮换字集','0',False), ('sort','轮换排序','',False),
    ('comment','轮换注解','/',False), ('predict','预测候选','Y',False),
    ('mode','轮换输入模式','M',False), ('word','单字／字词','D',False),
    ('layout','轮换候选布局','L',False), ('hidden','隐藏／显示候选窗','H',False),
    ('punc','标点宽度','.',False), ('preedit','编码位置','',False),
    ('preview','首选预览','',False), ('space','空格简码提示','K',False),
    ('capture','截图候选面板','J',False), ('capture_detail','截图本地详情','J',True),
    ('annotation','注解上屏','A',False),
    *[(f'page{i}',f'每页 {i} 个候选',str(i),False) for i in range(3,10)]
]
KEYS = ['', *'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/;\'`,.-=[]\\', 'Enter']
DEFAULT_SHORTCUTS = {action:key for action,_,key,_ in SHORTCUTS}

def shortcut_text(values):
    """Complete, atomic wire format; an empty binding stays unbound."""
    unknown = set(values)-set(DEFAULT_SHORTCUTS)
    if unknown:raise ValueError('未知快捷键功能：'+', '.join(sorted(unknown)))
    merged=DEFAULT_SHORTCUTS|values
    seen=set();lines=[]
    for action,_,_,alt in SHORTCUTS:
        key=merged[action]
        if key not in KEYS:raise ValueError('快捷键须为字母、数字、标点或 Enter。')
        chord=(alt,key)
        if key and chord in seen:raise ValueError('同一组快捷键只能分配给一个功能。')
        if key=='Enter' and not alt and action!='annotation':
            raise ValueError('Ctrl+Shift+Enter 是固定的注解上屏键。')
        if key:seen.add(chord)
        lines.append(f'{action}\t{key or "-"}\t{int(alt)}\n')
    return ''.join(lines)+'.\n'

PAGES = {'set','appearance','words','lookup','keys','about','candidates','update',
         'schemas','capture','capture_detail','layout','hidden','index','preedit',
         'preview','resetlook','resetsettings', *(f'page{i}' for i in range(3,10))}

def valid_request(args):
    return bool((len(args)==1 and args[0] in PAGES) or
        (len(args)==2 and args[0] in ('panel','capture_detail') and re.fullmatch('[0-9a-f]{1,64}',args[1])) or
        (len(args)==2 and args[0]=='web' and re.fullmatch('[0-9a-f]{2,256}',args[1])))
