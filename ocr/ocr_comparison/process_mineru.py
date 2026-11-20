import pathlib, json, re, html, collections, unicodedata, csv, hashlib, sys, functools
from html.parser import HTMLParser

ROOT=pathlib.Path(__file__).resolve().parent.parent
HAN=re.compile(r'[\u3400-\u9fff]')
LAT=r'A-Za-zÀ-žǍ-ǜɑɡḿǹ\u0300-\u036f'
ATOM=re.compile(r'\d+|[A-Z]*[\u3400-\u9fff□]+(?:[A-Z]+)?(?:\s*[,，·]\s*[A-Z]*[\u3400-\u9fff□]+(?:[A-Z]+)?)*(?:[,，])?|['+LAT+r"]["+LAT+r"'’·\-]*(?:[ ,]+(?=["+LAT+r"])["+LAT+r"'’·\-]+)*")
N=56790

def compact(s):
 return re.sub(r'\s+','',unicodedata.normalize('NFC',s)).translate(str.maketrans({'（':'(', '）':')','，':',','’':"'",'－':'-'}))
def lex(s):return re.sub(r'\([^)]*\)','',compact(s)).strip('.,。·;；:：')
def pins(s):return re.sub(r"[\s\-·,'，’]",'',unicodedata.normalize('NFC',s)).lower()
def validid(s):return int(s) if re.fullmatch(r'\d{1,5}',s) and 1<=int(s)<=N else None

def notation(s):
 accents={'acute':'\u0301','grave':'\u0300','bar':'\u0304','check':'\u030c','hat':'\u0302','tilde':'\u0303','ddot':'\u0308','breve':'\u0306','dot':'\u0307'}
 for _ in range(5):
  old=s
  s=re.sub(r'\\(acute|grave|bar|check|hat|tilde|ddot|breve|dot)\s*\{\s*([^{}])\s*\}',lambda m:unicodedata.normalize('NFC',m[2]+accents[m[1]]),s)
  s=re.sub(r'\\(?:mathrm|text|operatorname)\s*\{([^{}]*)\}',r'\1',s)
  s=re.sub(r'\^\s*\{\s*\\circledR\s*\}', '®',s)
  if s==old:break
 return s.replace('$','').replace('\\(','').replace('\\)','').strip()

class Table(HTMLParser):
 def __init__(self,s):
  super().__init__(convert_charrefs=True);self.rows=[];self.row=None;self.cell=None;self.feed(s)
 def handle_starttag(self,t,a):
  if t=='tr':self.row=[]
  if t in ['td','th']:self.cell={'text':'','attrs':dict(a)}
  if t in ['br','p','div'] and self.cell:self.cell['text']+=' '
 def handle_data(self,s):
  if self.cell is not None:self.cell['text']+=s
 def handle_endtag(self,t):
  if t in ['td','th'] and self.cell is not None:
   self.cell['text']=html.unescape(self.cell['text']).strip();self.row.append(self.cell);self.cell=None
  if t=='tr' and self.row is not None:self.rows.append(self.row);self.row=None

def spans(obj,path=()):
 if isinstance(obj,dict):
  if 'html' in obj:yield path,obj
  for k,v in obj.items():yield from spans(v,path+(k,))
 elif isinstance(obj,list):
  for i,v in enumerate(obj):yield from spans(v,path+(i,))

def semantic(row):
 out={'word':[],'pinyin':[],'number':[]}
 if any('频序号' in c['text'] for c in row):return out
 for ci,c in enumerate(row):
  s=notation(unicodedata.normalize('NFC',c['text']))
  if s and not HAN.search(s) and not re.search(r'\d',s) and any(ch.isalpha() for ch in s):
   out['pinyin'].append({'text':s,'cell':ci,'offset':[0,len(s)],'notation_decoded':s!=c['text']});continue
  for m in ATOM.finditer(s):
   t=m[0];kind='number' if t.isdigit() else 'word' if HAN.search(t) or '□' in t else 'pinyin'
   out[kind].append({'text':t,'cell':ci,'offset':[m.start(),m.end()]})
 return out

def ref(tab,ri,atoms=None):
 return {'table':tab['table'],'row':ri,'cells':[c['text'] for c in tab['rows'][ri]],'atoms':atoms or []}

def record(tab,ri,w='',py='',nr='',refs=None,basis='原识别编号',flags=None):
 return dict(id_raw=nr,id=validid(nr),word=w,word_key=lex(w),pinyin=py,
             page=tab['page'],book_page=tab['book_page'],source_file=tab['source_file'],
             source_page=tab['source_page'],table=tab['table'],row=ri,
             source_path=tab['source_path'],source_bbox=tab['bbox'],
             refs=refs or [ref(tab,ri)],id_basis=basis,flags=flags or [])

def extract_body_flat(tab):
 out=[];orph=[]
 for ri,row in enumerate(tab['rows']):
  texts=[c['text'] for c in row]
  s='\t'.join(texts)
  if not s.strip() or '频序号' in s:continue
  matches=list(re.finditer(r'(?<![^\s])\d{1,6}(?!\d)',s))
  if not matches:
   if HAN.search(s):orph.append({'table':tab['table'],'row':ri,'text':s,'reason':'正文行无可识别编号'})
   continue
  for j,m in enumerate(matches):
   w=s[m.end():matches[j+1].start() if j+1<len(matches) else len(s)].strip()
   w=re.sub(r'\s+','',w)
   out.append(record(tab,ri,w,nr=m[0],flags=['正文单元格含合并字段'] if len(texts)!=10 else []))
 return out,orph

def extract_body(tab):
 # Reconstruct the HTML grid, retaining origins of rowspan/colspan cells.
 # Continuations attach within their own book column, never across columns.
 grid=[];active={};origins={}
 for ri,row in enumerate(tab['rows']):
  line={c:v for c,(until,v) in active.items() if until>ri};active={c:(u,v) for c,(u,v) in active.items() if u>ri};ci0=0
  for ci,cell in enumerate(row):
   while ci0 in line:ci0+=1
   cs=max(1,int(cell['attrs'].get('colspan',1)));rs=max(1,int(cell['attrs'].get('rowspan',1)))
   origin=(ri,ci);origins[origin]=cell
   for col in range(ci0,ci0+cs):
    line[col]=origin
    if rs>1:active[col]=(ri+rs,origin)
   ci0+=cs
  grid.append(line)
 hist=collections.Counter()
 for ri,line in enumerate(grid):
  seen=set()
  for col,o in sorted(line.items()):
   if o in seen:continue
   seen.add(o)
   if re.match(r'^\s*\d{1,6}(?!\d)',origins[o]['text']) and o[0]==ri:hist[col]+=1
 if len(hist)<5:return extract_body_flat(tab)
 anchors=sorted(c for c,n in hist.most_common(5));tab['body_column_anchors']=anchors
 width=max(max(line,default=0) for line in grid)+1;out=[];orph=[];previous={};seen_text=set()
 for ri,line in enumerate(grid):
  for group,start in enumerate(anchors):
   end=anchors[group+1] if group+1<len(anchors) else width
   oo=[]
   for col in range(start,end):
    o=line.get(col)
    if o is not None and o not in oo:oo.append(o)
   fresh=[o for o in oo if o[0]==ri and o not in seen_text]
   if not fresh:continue
   s='\t'.join(origins[o]['text'] for o in fresh)
   if not s.strip() or '频序号' in s:seen_text.update(fresh);continue
   matches=list(re.finditer(r'(?<![^\s])\d{1,6}(?!\d)',s))
   if matches:
    for j,m in enumerate(matches):
     w=s[m.end():matches[j+1].start() if j+1<len(matches) else len(s)].strip();w=re.sub(r'\s+','',w)
     r=record(tab,ri,w,nr=m[0]);r['col']=group;r['cell_origins']=[list(o) for o in fresh]
     if len(matches)>1:r['flags'].append('同栏单元格含多个编号，词形分配待核对')
     if any(int(origins[o]['attrs'].get('rowspan',1))>1 for o in fresh):r['flags'].append('正文含纵向合并单元格')
     out.append(r);previous[group]=r
   elif s.strip() and group in previous:
    r=previous[group];r['word']+=re.sub(r'\s+','',s);r['word_key']=lex(r['word']);r['refs'].append(ref(tab,ri));r['flags'].append('正文同栏无编号续行合并');r.setdefault('continuations',[]).append({'row':ri,'text':s,'origins':[list(o) for o in fresh]})
   elif s.strip():orph.append({'table':tab['table'],'row':ri,'text':s,'reason':'正文同栏续行缺少前置编号'})
   seen_text.update(fresh)
 return out,orph

def extract_index(tab):
 allfields={k:[] for k in ['word','pinyin','number']};parsed=[]
 for ri,row in enumerate(tab['rows']):
  v=semantic(row);parsed.append(v)
  for kind,aa in v.items():
   for a in aa:allfields[kind].append(dict(a,row=ri))
 words=allfields['word'];numbers=allfields['number'];out=[];orph=[]
 tab['counts']={k:len(v) for k,v in allfields.items()}
 # Align the word and number columns by order only when both complete streams
 # have the same length. Keep both source rows so repairs remain auditable.
 if len(words)==len(numbers) and words:
  for w,n in zip(words,numbers):
   ri=w['row'];pys=parsed[ri]['pinyin'];wr=parsed[ri]['word']
   py=pys[0]['text'] if len(pys)==1 and len(wr)==1 else ''
   shifted=ri!=n['row']
   rr=record(tab,ri,w['text'],py,n['text'],refs=[ref(tab,ri),ref(tab,n['row'])] if shifted else None,
             basis='表内列序恢复' if shifted else '原识别编号',flags=['索引词语与编号分居异行，按同表列序配对'] if shifted else [])
   rr['word_atom']=w;rr['number_atom']=n
   rr['pinyin_atoms']=pys if py else []
   out.append(rr)
 else:
  for ri,v in enumerate(parsed):
   ww=v['word'];nn=v['number'];pp=v['pinyin']
   if not any(v.values()):continue
   if len(ww)==1:
    w=ww[0]['text'];py=pp[0]['text'] if len(pp)==1 else ''
    nr=nn[0]['text'] if len(nn)==1 else ''
    rr=record(tab,ri,w,py,nr,flags=['表内词语与编号数量不等，保留行级候选'])
    rr['word_atom']=dict(ww[0],row=ri);rr['number_atom']=dict(nn[0],row=ri) if len(nn)==1 else None;rr['pinyin_atoms']=pp if py else []
    rr['number_candidates']=[x['text'] for x in nn];out.append(rr)
   elif len(ww)>1:
    for j,w in enumerate(ww):
     nr=nn[j]['text'] if len(nn)==len(ww) else ''
     rr=record(tab,ri,w['text'],'',nr,flags=['一行含多个词形，拼音分配待恢复'])
     rr['word_atom']=dict(w,row=ri);rr['number_atom']=dict(nn[j],row=ri) if nr else None;rr['pinyin_atoms']=[]
     rr['number_candidates']=[x['text'] for x in nn];out.append(rr)
   else:orph.append({'table':tab['table'],'row':ri,'text':'\t'.join(c['text'] for c in tab['rows'][ri]),'reason':'无词形的拼音或编号行'})
 # Preserve all semantic fields for the second, model-local recovery pass.
 tab['fields']=allfields;tab['parsed']=parsed
 return out,orph

def load(name,folder):
 out=ROOT/folder;out.mkdir(exist_ok=True);tabs=[];manifest=[];B=[];I=[];orph=[]
 for side in ['正文','音序索']:
  book_start=1 if side=='正文' else 251;cnt=0
  for f in sorted((ROOT/name/side).glob('*.json')):
   raw=f.read_bytes();d=json.loads(raw)
   manifest.append({'file':str(f.relative_to(ROOT)),'sha256':hashlib.sha256(raw).hexdigest(),'pages':len(d['pdf_info']),'backend':d.get('_backend'),'effort':d.get('_effort'),'version':d.get('_version_name'),'book_start':book_start+cnt})
   for pg in d['pdf_info']:
    book=book_start+cnt;cnt+=1
    for path,sp in spans(pg['preproc_blocks']):
     rows=Table(sp['html']).rows
     tab={'table':len(tabs),'side':side,'page':book+8,'book_page':book,'source_file':str(f.relative_to(ROOT)),'source_page':pg['page_idx']+1,'source_path':list(path),'bbox':sp.get('bbox'),'rows':rows}
     tabs.append(tab)
     records,o=extract_body(tab) if side=='正文' else extract_index(tab)
     (B if side=='正文' else I).extend(records);orph+=o
   
  assert cnt==(249 if side=='正文' else 414),(side,cnt)
 for fn,obj in [('body_raw',B),('index_raw',I),('table_manifest',tabs),('source_manifest',manifest),('orphan_rows',orph)]:
  (out/(fn+'.json')).write_text(json.dumps(obj,ensure_ascii=False),'utf-8')
 print(name,'body',len(B),'body IDs',len({r['id'] for r in B if r['id']}),'index',len(I),'index IDs',len({r['id'] for r in I if r['id']}),'unresolved',sum(not r['id'] for r in I))
 print('index tables unequal streams',[(t['page'],t['counts']) for t in tabs if t['side']=='音序索' and t['counts']['word']!=t['counts']['number']][:40])
 return out

if __name__=='__main__':
 for name,folder in [('MinerU VLM','mineru_vlm_vocab'),('MinerU','mineru_vocab')]:load(name,folder)
