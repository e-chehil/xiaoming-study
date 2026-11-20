import json,pathlib,re,html,collections,unicodedata,statistics
P=pathlib.Path(__file__).resolve().parent;ROOT=P.parent;SRC=next((ROOT/'Paddle').glob('*Paddle*.json'))
HAN=re.compile(r'[\u3400-\u9fff]')
def clean(s):return unicodedata.normalize('NFC',html.unescape(re.sub('<[^>]*>','',s))).replace('（','(').replace('）',')').replace('，',',').replace('’',"'").replace('－','-').strip()
def compact(s):return re.sub(r'\s+','',clean(s))
def lex(s):return re.sub(r'\([^)]*\)','',compact(s)).strip('.,。·;；:：')
def cells(tr):return [clean(x) for x in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',tr,re.S)]
def valid_num(s):return bool(re.fullmatch(r'\d{1,6}',compact(s)))
def num(s):
 try:n=int(compact(s));return n if 1<=n<=56790 else None
 except:return None
D=json.loads(SRC.read_text('utf-8'));HEADERS={};PAGEMAP={};TABLES=[]
for pg in range(9,258):
 txt=' '.join(b['block_content'] for b in D[pg-1]['prunedResult']['parsing_res_list'] if b['block_label'] in ['header','number'])
 matches=[(int(a),int(b)) for a,b in re.findall(r'(\d{1,5})\s*[-—–－]\s*(\d{1,5})',txt) if int(a)<int(b)<=56790 and int(b)-int(a)<260]
 if len(matches)==1:HEADERS[pg]=matches[0]
HEADERS[9]=(1,185)
for pg,(lo,hi) in HEADERS.items():
 for n in range(lo,hi+1):PAGEMAP.setdefault(n,[]).append(pg)
for section,lo,hi in [('body',9,257),('index',259,672)]:
 ts=[]
 for pg in range(lo,hi+1):
  for bi,b in enumerate(D[pg-1]['prunedResult']['parsing_res_list']):
   if b['block_label']=='table' or section=='index' and b['block_label']=='content':
    kind=b['block_label'];lines=[];unparsed=[]
    if kind=='table':rows=[cells(t) for t in re.findall(r'<tr\b[^>]*>(.*?)</tr>',b['block_content'],re.S)]
    else:
     rows=[];seen_wordonly=set()
     for li,line in enumerate(b['block_content'].splitlines()):
      raw=line;line=clean(line)
      if not line:continue
      m=re.match(r'^([\u3400-\u9fff,，·、]+)\s*(.*)$',line)
      if not m:unparsed.append({'line':li,'text':raw});continue
      w,py=m[1],m[2];end=re.search(r'(\d{1,6})\s*$',py);n=''
      if end:n=end[1];py=py[:end.start()].strip()
      if not py and not n:
       if w in seen_wordonly:unparsed.append({'line':li,'text':raw,'reason':'重复无拼音词形'});continue
       seen_wordonly.add(w)
      rows.append([w,py,n]);lines.append({'source_line':li,'raw_line':raw})
    ts.append(dict(section=section,page=pg,block=bi,block_id=b.get('block_id',bi),bbox=b['block_bbox'],rows=rows,html=b['block_content'],source_kind=kind,line_map=lines,unparsed_lines=unparsed))
 for j,t in enumerate(ts):
  if not t['rows']:continue
  k=j+1
  while k<len(ts) and not ts[k]['rows']:k+=1
  t['page_candidates']=sorted({u['page'] for u in ts[j:k]});t['merged_blocks']=[{'page':u['page'],'block':u['block'],'bbox':u['bbox']} for u in ts[j:k]]
  TABLES.append(t)
BODY=[];INDEX=[];ORPHAN=[]
for ti,t in enumerate(TABLES):
 sec=t['section']
 for ri,cs in enumerate(t['rows']):
  if not cs:continue
  if sec=='body' and not any(HAN.search(x) for x in cs):
   ORPHAN.append(dict(section=sec,kind='正文全数字或无汉字异常行',source_page=t['page'],source_block=t['block'],table=ti,row=ri,cells=cs));continue
  if any(x in ['频序号','词 语','词语','拼 音','拼音'] for x in cs) and not any(valid_num(x) for x in cs):continue
  base=dict(source_page=t['page'],source_block=t['block'],source_block_id=t['block_id'],table=ti,row=ri,source_bbox=t['bbox'],page_candidates=t['page_candidates'],cells=cs,source_kind=t['source_kind'],source_line=t['line_map'][ri]['source_line'] if t['source_kind']=='content' else None,raw_line=t['line_map'][ri]['raw_line'] if t['source_kind']=='content' else None,flags=[],id_basis='原识别编号')
  if sec=='body':
   anchors=[]
   for ci,c in enumerate(cs):
    if valid_num(c):anchors.append((ci,compact(c),''))
    else:
     m=re.match(r'^(\d{1,6})\s*([\u3400-\u9fff].*)$',c)
     if m:anchors.append((ci,m[1],m[2]))
   if not anchors:
    ORPHAN.append(dict(section=sec,**base));continue
   if anchors[0][0]>0:ORPHAN.append(dict(section=sec,kind='行首无编号片段',orphan_cells=cs[:anchors[0][0]],**base))
   for j,(ci,n,tail) in enumerate(anchors):
    end=anchors[j+1][0] if j+1<len(anchors) else len(cs)
    parts=cs[ci+1:end];kept=[]
    for off,part in enumerate(parts):
     if off>0 and re.fullmatch(r'\s*[（(][^()（）]*[)）]\s*',part):
      ORPHAN.append(dict(section=sec,kind='独立括号注音片段',annotation=part,note_cell=ci+1+off,**base))
     else:kept.append(part)
    w=compact(tail+''.join(kept));r=dict(base,cell=ci,id_raw=n,id=num(n),word=w,word_key=lex(w),pinyin='',flags=[])
    if not HAN.search(w):r['flags'].append('正文词语缺失或无汉字')
    if len(cs)!=10:r['flags'].append('原表格行列数异常')
    BODY.append(r)
  else:
   # Most VL index rows are three columns; two-column rows retain missing ids.
   if len(cs) in [2,3]:
    w,py=cs[:2];n=cs[2] if len(cs)==3 else '';r=dict(base,cell=0,id_raw=compact(n),id=num(n),word=compact(w),word_key=lex(w),pinyin=clean(py),flags=[])
    if len(cs)==2:r['flags'].append('索引行缺少编号列')
    if not valid_num(n):
     m=re.search(r'\s*(\d{1,6})\s*$',py)
     if not n and m:r['id_raw']=m[1];r['id']=num(m[1]);r['pinyin']=py[:m.start()].strip();r['flags'].append('拼音编号同格拆分');r['id_basis']='同格编号拆分'
    if not HAN.search(w):r['flags'].append('索引词语缺失或无汉字')
    if not r['pinyin']:r['flags'].append('索引拼音缺失')
    if not r['id']:r['flags'].append('索引编号缺失或异常')
    if t['source_kind']=='content':r['flags'].append('从VL普通文字块提取')
    if len(r['pinyin'])>250:r['flags'].append('拼音异常过长或重复，须人工恢复')
    INDEX.append(r)
   else:ORPHAN.append(dict(section=sec,kind='索引列数异常',**base))
# Local matrix continuity only: independent of index spellings.
lookup=collections.defaultdict(list)
for r in BODY:lookup[(r['table'],r['row'])].append(r)
fixes=[];observed=collections.Counter(r['id'] for r in BODY if r['id']);pending=[]
for r in BODY:
 if not HAN.search(r['word']):continue
 prev=lookup.get((r['table'],r['row']-1),[]);nxt=lookup.get((r['table'],r['row']+1),[])
 pairs=[(a,b) for a in prev for b in nxt if a['id'] and b['id'] and b['id']==a['id']+2 and a['cell']==r['cell']==b['cell']]
 cand={a['id']+1 for a,b in pairs}
 if len(cand)==1 and r['id'] not in cand and next(iter(cand)) not in observed and (not r['id'] or observed[r['id']]>1):
  guess=next(iter(cand));same=[(a,b) for a,b in pairs if a['id']+1==guess]
  if all(abs(a['cell']-b['cell'])<=1 for a,b in same):
   fixes.append([r['id_raw'],guess,r['word'],r['source_page'],r['row']]);pending.append((r,guess))
for r,guess in pending:
 r['id']=guess;r['id_basis']='表格相邻行连续编号恢复';r['flags'].append('正文编号按相邻行连续序号恢复')
# A row's other columns can identify its original page independently of the bad number.
observed=collections.Counter(r['id'] for r in BODY if r['id']);pending=[]
for key,rr in lookup.items():
 votes=collections.Counter(pg for r in rr for pg in PAGEMAP.get(r['id'],[]))
 if not votes:continue
 pg,votes_n=votes.most_common(1)[0]
 if votes_n<3:continue
 lo,hi=HEADERS[pg]
 for r in rr:
  if not r['id'] or lo<=r['id']<=hi or observed[r['id']]<2:continue
  suffix=r['id_raw'][-3:]
  cand=[n for n in range(lo,hi+1) if str(n).endswith(suffix) and n not in observed]
  if len(cand)==1:
   pending.append((r,cand[0]))
for r,n in pending:
 r['id']=n;r['id_basis']='同排页范围与编号尾数恢复';r['flags'].append('正文编号按同排页范围和三位尾数恢复')
# Move duplicated annotation-only rows onto the preceding sequential word, when unambiguous.
byid=collections.defaultdict(list)
for r in BODY:
 if r['id'] and HAN.search(r['word']):byid[r['id']].append(r)
kept=[];attached=[]
for r in BODY:
 if r['id'] and re.fullmatch(r'\([^()]*\)',r['word']) and not HAN.search(r['word']):
  nx=lookup.get((r['table'],r['row']+1),[])
  prev=[a for a in byid.get(r['id']-1,[]) if a['table']==r['table'] and a['cell']==r['cell'] and a['row']<r['row']]
  if len(prev)==1 and any(a['id']==r['id'] and HAN.search(a['word']) and a['cell']==r['cell'] for a in nx):
   a=prev[0];a['word']+=r['word'];a['word_key']=lex(a['word']);a['flags'].append('独立括号注音续接');a.setdefault('attached_sources',[]).append({k:r[k] for k in ['source_page','source_block','table','row','cells','source_kind','source_line','raw_line']});attached.append(r);continue
 kept.append(r)
BODY=kept
ORPHAN.extend(dict(section='body',kind='已续接至前词注音的原始行',**r) for r in attached)

# Assign independent original-page candidates from VL page headers.
for r in BODY:
 pp=PAGEMAP.get(r['id'],[]);r['original_pages']=pp
 if not pp:r['flags'].append('未能按VL页眉定位正文原页')
for name,rs in [('body_raw',BODY),('index_raw',INDEX),('orphan_rows',ORPHAN)]:
 (P/f'{name}.json').write_text(json.dumps(rs,ensure_ascii=False),'utf-8')
(P/'table_manifest.json').write_text(json.dumps([{k:v for k,v in t.items() if k not in ['rows','html']} for t in TABLES],ensure_ascii=False,indent=2),'utf-8')
(P/'body_page_ranges.json').write_text(json.dumps(HEADERS,ensure_ascii=False,indent=2),'utf-8')
print('HEADERS',len(HEADERS),'PAGEMAP',len(PAGEMAP),'MISSING_HEADERS',[n for n in range(9,258) if n not in HEADERS])
print('BODY_NUMBER_FIXES',len(fixes),fixes[:20])
for name,rs in [('BODY',BODY),('INDEX',INDEX)]:
 cc=collections.Counter(r['id'] for r in rs if r['id']);print(name,'RECORDS',len(rs),'IDS',len(cc),'MISSING',56790-len(cc),'DUP_IDS',sum(n>1 for n in cc.values()),'FLAGS',collections.Counter(f for r in rs for f in r['flags']))
print('ORPHAN_ROWS',len(ORPHAN));print('INDEX_BAD',[(r['source_page'],r['word'],r['pinyin'],r['id_raw']) for r in INDEX if not r['id']][:25])
