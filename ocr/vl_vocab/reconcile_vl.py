import json,pathlib,re,collections,unicodedata,csv,copy,hashlib
P=pathlib.Path(__file__).resolve().parent;ROOT=P.parent;SRC=next((ROOT/'Paddle').glob('*Paddle*.json'))
HAN=re.compile(r'[\u3400-\u9fff]')
def compact(s):return re.sub(r'\s+','',unicodedata.normalize('NFC',s)).replace('（','(').replace('）',')').replace('，',',').replace('’',"'")
def lex(s):return re.sub(r'\([^)]*\)','',compact(s)).strip('.,。·;；:：')
def pins(s):return re.sub(r"[\s\-·,'，’]",'',unicodedata.normalize('NFC',s)).lower()
def nums(s):
 if re.fullmatch(r'\d{1,6}',s):
  n=int(s);return n if 1<=n<=56790 else None
 return None
B=json.loads((P/'body_raw.json').read_text('utf-8'));I=json.loads((P/'index_raw.json').read_text('utf-8'))
for r in B+I:
 r['refs']=[{k:r[k] for k in ['source_page','source_block','table','row','cells','source_kind','source_line','raw_line']}]+r.get('attached_sources',[])
 r['pinyin']=r['pinyin'].replace('\\n',' ').replace('\\t',' ').strip();r['word_key']=lex(r['word'])
# Rejoin explicit numbered continuation rows, including empty cells in a second line.
BM=collections.defaultdict(list)
for r in B:
 if r['id'] and HAN.search(r['word_key']):BM[r['id']].append(r)
J=[];at=0
while at<len(I):
 r=I[at]
 if at+1<len(I) and not r['id'] and r['word']:
  nx=I[at+1]
  if r['table']==nx['table'] and nx['row']==r['row']+1 and nx['id']:
   target={a['word_key'] for a in BM.get(nx['id'],[])}
   empty_next=not HAN.search(nx['word'])
   overlap=max([k for k in range(1,min(len(r['word']),len(nx['word']))+1) if r['word'].endswith(nx['word'][:k])]+[0])
   joined_word=r['word']+nx['word'][overlap:]
   joined=lex(joined_word)
   prefix_supported=any(min(len(w),len(r['word_key']))>=3 and (w.startswith(r['word_key']) or r['word_key'].startswith(w)) for w in target)
   known_continuation=(r['word'],nx['word']) in {('不费吹灰之','力'),('不管三七','二十一'),('浪子回头金','不换'),('无所不用其','极'),('一竿子插到底','底'),('一失足成千古恨','千古恨'),('打铁还需自身硬','身硬')}
   competing_word=nx['word'].startswith(r['word'][:2]) and nx['word']!=r['word'] and len(nx['word'])>=3
   if empty_next or joined in target or known_continuation or prefix_supported and not competing_word:
    r['word']=joined_word;r['word_key']=lex(r['word']);r['pinyin']=' '.join(s for s in [r['pinyin'],nx['pinyin']] if s);r['id']=nx['id'];r['id_raw']=nx['id_raw'];r['id_basis']='编号续行合并' if empty_next else '跨行词形合并（正文佐证）';r['flags']+=['索引跨行记录合并'];r['refs']+=nx['refs'];at+=2;J.append(r);continue
 J.append(r);at+=1
I=J
# Both recovery directions keep explicit dependency labels; no inferred record is used as independent proof.
IW=collections.defaultdict(set)
for r in I:
 if r['id'] and HAN.search(r['word_key']):IW[r['word_key']].add(r['id'])
counts=collections.Counter(r['id'] for r in B if r['id']);occupied={r['id'] for r in B if r['id']}
for r in B:
 cand=IW.get(r['word_key'],set())
 if len(cand)==1:
  n=next(iter(cand))
  if n!=r['id'] and n not in occupied and (not r['id'] or counts[r['id']]>1):
   r['id']=n;r['id_basis']='按索引唯一同词推定';r['flags'].append('正文编号按索引同词推定，不能独立验证');occupied.add(n)
BW=collections.defaultdict(set)
for r in B:
 if r['id'] and HAN.search(r['word_key']) and r['id_basis']!='按索引唯一同词推定':BW[r['word_key']].add(r['id'])
counts=collections.Counter(r['id'] for r in I if r['id']);occupied={r['id'] for r in I if r['id']}
for r in I:
 cand=BW.get(r['word_key'],set());r['body_id_candidates']=sorted(cand)
 if len(cand)==1:
  n=next(iter(cand))
  if n!=r['id'] and (not r['id'] or n not in occupied and counts.get(r['id'],0)>1):
   r['id']=n;r['id_basis']='按正文唯一同词推定';r['flags'].append('索引编号按正文同词推定，不能独立验证');occupied.add(n)
# Preserve unresolved alternatives, including apparent model-generated headers.
BM=collections.defaultdict(list);IM=collections.defaultdict(list)
for r in B:
 if r['id']:BM[r['id']].append(r)
for r in I:
 if r['id']:IM[r['id']].append(r)
page_ranges=json.loads((P/'body_page_ranges.json').read_text('utf-8'));PAGE={n:int(pg) for pg,(lo,hi) in page_ranges.items() for n in range(lo,hi+1)}
def span(xs):
 a=sorted(set(xs));ranges=[]
 for v in a:
  if ranges and v==ranges[-1][1]+1:ranges[-1][1]=v
  else:ranges.append([v,v])
 return ' / '.join(str(a) if a==b else f'{a}–{b}' for a,b in ranges)
def location(rs):return ' / '.join(f"记录页{r['source_page']}:块{r['source_block']}:行{r['row']+1}:格{r['cell']+1}" for r in rs)
H=['频序号','词语（正文唯一优先）','拼音（索引优先）','正文词形','索引词形','核对结果','正文括号注音','注音核对','正文原页（VL页眉）','索引原页候选','正文原编号','索引原编号','编号处理','处理说明','正文表块记录页','索引表块记录页','词语来源','拼音来源','正文定位','索引定位','索引原始拼音']
ROWS=[];DIFF=[];REVIEW=[];ST=collections.Counter();EX=[]
for n in range(1,56791):
 br=BM.get(n,[]);ir=IM.get(n,[]);bw=sorted({r['word_key'] for r in br if HAN.search(r['word_key'])});iw=sorted({r['word_key'] for r in ir if HAN.search(r['word_key'])});py=sorted({r['pinyin'] for r in ir if r['pinyin'] and len(r['pinyin'])<=250})
 bi=any(r['id_basis']=='按索引唯一同词推定' for r in br);ii=any(r['id_basis']=='按正文唯一同词推定' for r in ir)
 if not bw and not iw:status='双侧词语待恢复'
 elif not bw:status='正文词语待恢复'
 elif not iw:status='索引词语待恢复'
 elif len(bw)>1:status='正文同编号多词形'
 elif len(iw)>1:status='索引同编号多词形'
 elif len(py)>1:status='索引拼音多候选'
 elif bi:status='正文编号推定待核对'
 elif ii:status='索引编号推定待核对'
 elif bw!=iw:status='词形不一致'
 else:status='词形一致'
 if len(bw)==1:word=bw[0];word_source='正文'
 elif len(iw)==1:word=iw[0];word_source='索引（正文缺失或多候选）'
 else:word='';word_source='缺失或双方均有多候选'
 ip=' / '.join(py);pin_source='索引' if py else ''
 notes=sorted({x for r in br if HAN.search(r['word']) for x in re.findall(r'\(([^)]*)\)',r['word'])})
 # Single-character words can safely take their own complete parenthetical pronunciation.
 if not ip and len(word)==1 and HAN.fullmatch(word) and len(notes)==1 and re.fullmatch(r"[A-Za-zÀ-žüÜ'\- ]+",notes[0]):
  ip=notes[0];pin_source='正文单字括号注音（索引缺失）'
 ps='正文无括号注音'
 if notes:
  if not py:ps='索引拼音缺失'
  elif len(notes)>1 or len(py)>1:ps='多注音候选待核对'
  elif pins(notes[0])==pins(py[0]):ps='注音一致'
  else:ps='注音不一致'
 flags=list(dict.fromkeys(f for r in br+ir for f in r['flags']))
 if len(br)>1:flags.append(f'正文编号关联{len(br)}条原始记录')
 if len(ir)>1:flags.append(f'索引编号关联{len(ir)}条原始记录')
 if not ip:flags.append('拼音未恢复')
 elif re.search(r'\d|[\u3400-\u9fff]',ip):flags.append('拼音字符异常')
 if not br:flags.append('正文编号记录缺失')
 if not ir:flags.append('索引编号记录缺失')
 if bi or ii:flags.append('跨部分推定记录不计作独立核对一致')
 basis='正文：'+(' / '.join(sorted({r['id_basis'] for r in br})) or '无记录')+'；索引：'+(' / '.join(sorted({r['id_basis'] for r in ir})) or '无记录')
 row=[n,word,ip,' / '.join(sorted({r['word'] for r in br})), ' / '.join(sorted({r['word'] for r in ir})),status,' / '.join(notes),ps,PAGE.get(n) if br else '',span([pg for r in ir for pg in r['page_candidates']]),' / '.join(sorted({r['id_raw'] for r in br})), ' / '.join(sorted({r['id_raw'] for r in ir})),basis,'；'.join(flags),span([r['source_page'] for r in br]),span([r['source_page'] for r in ir]),word_source,pin_source,location(br),location(ir),' / '.join(sorted({r['pinyin'] for r in ir if r['pinyin']}))]
 ROWS.append(row);ST[status]+=1
 if status!='词形一致' or ps in ['注音不一致','多注音候选待核对','索引拼音缺失']:DIFF.append(row+['','',''])
 if status!='词形一致' or ps!='正文无括号注音' and ps!='注音一致' or any(r['id_basis']!='原识别编号' for r in br+ir) or not ip or len(br)>1 or len(ir)>1:REVIEW.append(row+['','',''])
 if status=='词形不一致' and len(EX)<15:EX.append([n,row[3],row[4],ip,row[8],row[9]])
# Detect consecutive discrepancies consistent with a number shift; do not repair them.
segments=[]
for delta in [-2,-1,1,2]:
 run=[]
 for n in range(1,56791):
  j=n+delta
  ok=1<=j<=56790 and ROWS[n-1][5]=='词形不一致' and ROWS[j-1][16]=='正文' and ROWS[j-1][1]==ROWS[n-1][4] and bool(ROWS[n-1][4])
  if ok:run.append(n)
  else:
   if len(run)>=3:segments.append([run[0],run[-1],delta,len(run)])
   run=[]
 if len(run)>=3:segments.append([run[0],run[-1],delta,len(run)])
for lo,hi,delta,count in segments:
 for n in range(lo,hi+1):
  note=f'疑似连续编号错位：索引本词见正文编号{n+delta}'
  ROWS[n-1][13]+=('；' if ROWS[n-1][13] else '')+note
# Refresh derived views after adding review notes.
byid={r[0]:r for r in ROWS}
DIFF=[byid[r[0]]+['','',''] for r in DIFF];REVIEW=[byid[r[0]]+['','',''] for r in REVIEW]
with (P/'VL疑似连续错位段.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['起始编号','结束编号','正文相对索引编号偏移','条数']);w.writerows(segments)

UN=[('正文',r) for r in B if not r['id']]+[('索引',r) for r in I if not r['id']]
UH=['部分','表块记录页','原页候选','块序号','表内行','词语','拼音','原编号','编号候选','处理说明','复核编号','复核词语','复核拼音','复核备注']
UR=[[side,r['source_page'],span(r['page_candidates']),r['source_block'],r['row']+1,r['word'],r['pinyin'],r['id_raw'],' / '.join(str(n) for n in r.get('body_id_candidates',[])),'；'.join(r['flags']),'','','',''] for side,r in UN]
S=dict(source=SRC.name,expected_entries=56790,body_records=len(B),body_ids=len(BM),index_records=len(I),index_ids=len(IM),body_unresolved=sum(not r['id'] for r in B),index_unresolved=sum(not r['id'] for r in I),status_counts=dict(ST),with_word=sum(bool(r[1]) for r in ROWS),with_pinyin=sum(bool(r[2]) for r in ROWS),pinyin_from_body=sum(r[17].startswith('正文') for r in ROWS),number_repaired_body=sum(r['id_basis'] not in ['原识别编号','按索引唯一同词推定'] for r in B),body_inferred_records=sum(r['id_basis']=='按索引唯一同词推定' for r in B),index_inferred_records=sum(r['id_basis']=='按正文唯一同词推定' for r in I),pronunciation_differences=sum(r[7]=='注音不一致' for r in ROWS),difference_rows=len(DIFF),review_rows=len(REVIEW),offset_segments=len(segments),examples=EX)
for name,head,rows in [('VL完整词库',H,ROWS),('VL正文索引差异',H+['复核词语','复核拼音','复核备注'],DIFF),('VL待核对记录',H+['复核词语','复核拼音','复核备注'],REVIEW),('VL未定编号',UH,UR)]:
 with (P/f'{name}.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.writer(f);w.writerow(head);w.writerows(rows)
for name,obj in [('body_recovered',B),('index_recovered',I),('summary',S)]:
 (P/f'{name}.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2 if name=='summary' else None),'utf-8')
(P/'workbook_data.json').write_text(json.dumps(dict(header=H,rows=ROWS,differences=DIFF,review=REVIEW,unresolved_header=UH,unresolved=UR,summary=S),ensure_ascii=False),'utf-8')
print(json.dumps(S,ensure_ascii=False,indent=2))
