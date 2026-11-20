import json,pathlib,re,collections,unicodedata,csv,html,hashlib
from build_lexicon import lex,compact,HAN
P=pathlib.Path(__file__).resolve().parent;ROOT=P.parent
B=json.loads((P/'body_raw.json').read_text('utf-8'));B.sort(key=lambda r:(r['page'],r['col'],r['y']))
for i,r in enumerate(B):
 r['id_basis']='原识别编号'
 if i and i+1<len(B) and B[i-1]['id']+2==B[i+1]['id'] and r['id']!=B[i-1]['id']+1:
  r['id']=B[i-1]['id']+1;r['id_basis']='相邻连续序号恢复';r['flags'].append('正文编号按相邻连续序号恢复')
BM={r['id']:r for r in B};assert len(BM)==56790 and set(BM)==set(range(1,56791))
WM=collections.defaultdict(list)
for r in B:
 if HAN.search(r['word_key']):WM[r['word_key']].append(r['id'])
I=json.loads((P/'index_raw.json').read_text('utf-8'));I.sort(key=lambda r:(r['page'],r['col'],r['y']))
# Finish exact line continuations; no new characters are generated.
J=[]
for r in I:
 if J:
  pr=J[-1]
  if not pr['id'] and pr['page']==r['page'] and pr['col']==r['col'] and 15<r['y']-pr['y']<40 and r['id'] in BM and lex(pr['word']+r['word'])==BM[r['id']]['word_key']:
   pr['word']+=r['word'];pr['word_key']=lex(pr['word']);pr['pinyin']+=' '+r['pinyin'];pr['id_raw']=r['id_raw'];pr['id']=r['id'];pr['tokens']+=r['tokens'];pr['flags']=[f for f in pr['flags'] if f!='索引编号缺失或多候选']+['跨行合并（正文词形佐证）'];continue
 J.append(r)
I=J
# Split orphan second-row pinyin/number when the first row already owns a number.
J=[]
for r in I:
 lower=[t for t in r['tokens'][1:] if t['y']>r['y']+20]
 upper=[t for t in r['tokens'][1:] if t['y']<=r['y']+20]
 upnums=[t for t in upper if re.fullmatch(r'[1-9]\d{0,4}',t['text'])]
 lonums=[t for t in lower if re.fullmatch(r'[1-9]\d{0,4}',t['text'])]
 lopin=[t for t in lower if re.search('[A-Za-zÀ-ž]',t['text']) and not HAN.search(t['text'])]
 if len(upnums)==1 and len(lonums)==1 and lopin and all(not HAN.search(t['text']) for t in lower):
  r['tokens']=[t for t in r['tokens'] if t not in lower];r['pinyin']=' '.join(t['text'] for t in upper if re.search('[A-Za-zÀ-ž]',t['text']) and not HAN.search(t['text']));r['id_raw']=upnums[0]['text'];r['id']=int(r['id_raw']);r['flags'].append('剔除相邻空词语行的拼音编号')
  rr=dict(id_raw=lonums[0]['text'],id=int(lonums[0]['text']),word='',word_key='',pinyin=' '.join(t['text'] for t in lopin),page=r['page'],book_page=r['book_page'],col=r['col'],y=lonums[0]['y'],tokens=lower,method='坐标配对',flags=['索引词语框缺失，保留拼音编号'])
  J.extend([r,rr])
 else:J.append(r)
I=J
for r in I:
 r['observed_id']=r['id'];r['id_basis']='原识别编号' if r['id'] else '未确定'
 # Extract trailing number including cases initially split from word+pronunciation.
 m=re.search(r'\s*(\d{1,6})[.;。]*\s*$',r['pinyin'])
 if m:
  if not r['id_raw']:r['id_raw']=m[1];r['id']=int(m[1]) if 1<=int(m[1])<=56790 else None;r['observed_id']=r['id'];r['id_basis']='拼音框末尾拆分';r['pinyin']=r['pinyin'][:m.start()].strip();r['flags'].append('词语拼音框末尾编号拆分')
  else:r['flags'].append('拼音仍含数字待核对')
 # Drop an extra zero only when one remaining number exists; preserve original text.
 nums=re.findall(r'\d+',r['id_raw']);valid=[int(n) for n in nums if 1<=int(n)<=56790]
 if not r['id'] and len(valid)==1:
  r['id']=valid[0];r['observed_id']=valid[0];r['id_basis']='排除无效零编号';r['flags'].append('多数字框排除无效零')
 r['word_key']=lex(r['word'])
# Recover number links only for uniquely matching body words and missing or duplicated ids.
# These are never treated as independent agreements in the comparison.
for _ in range(3):
 counts=collections.Counter(r['id'] for r in I if r['id'])
 occupied={r['id'] for r in I if r['id'] and r['word_key']==BM[r['id']]['word_key']}
 for r in I:
  candidates=WM.get(r['word_key'],[]);r['body_word_id_candidates']=candidates
  if len(candidates)!=1:continue
  n=candidates[0]
  if r['id']==n:continue
  if (r['id'] is None or counts.get(r['id'],0)>1) and n not in occupied:
   r['id']=n;r['id_basis']='按正文唯一同词推定';r['flags'].append('索引编号推定，原编号保留');occupied.add(n)
# Source table fallbacks for missing pinyin/word only, never replace competing text.
D=json.loads(next((ROOT/'Paddle').glob('*Struct*.json')).read_text('utf-8'));TM=collections.defaultdict(list)
for pg in range(259,673):
 for block in D[pg-1]['prunedResult']['parsing_res_list']:
  if block['block_label']!='table':continue
  for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>',block['block_content'],re.S):
   cells=[compact(html.unescape(re.sub('<[^>]*>','',c))) for c in re.findall(r'<td\b[^>]*>(.*?)</td>',tr,re.S)]
   if len(cells)%3:continue
   for j in range(0,len(cells),3):
    w,py,n=cells[j:j+3]
    if re.fullmatch(r'\d{1,5}',n) and 1<=int(n)<=56790 and HAN.search(w):TM[int(n)].append((w,py,pg))
for r in I:
 if r['id'] and not r['pinyin']:
  alts={py for w,py,pg in TM[r['id']] if lex(w)==r['word_key'] and py}
  if len(alts)==1:r['pinyin']=next(iter(alts));r['flags'].append('拼音从PP表格补取')
IM=collections.defaultdict(list)
for r in I:
 if r['id']:IM[r['id']].append(r)
HEAD=['频序号','词语（正文优先）','拼音（索引）','正文词形','索引词形','核对结果','正文括号注音','注音核对','正文PDF页','索引PDF页','正文原编号','索引原编号','编号处理','处理说明']
ROWS=[];DIFF=[];REVIEW=[];stats=collections.Counter();examples=[]
def pins(s):return re.sub(r"[\s\-·,'，’]",'',unicodedata.normalize('NFC',s)).lower()
for n in range(1,56791):
 b=BM[n];rr=IM[n];bw=b['word_key'];words=sorted({r['word_key'] for r in rr if HAN.search(r['word_key'])});py=sorted({r['pinyin'].strip() for r in rr if r['pinyin'].strip()});iw=' / '.join(words);ip=' / '.join(py)
 inferred=any(r['id_basis']=='按正文唯一同词推定' for r in rr);validb=bool(HAN.search(bw))
 if not rr:status='索引记录未恢复'
 elif len(rr)>1:status='索引同编号多记录'
 elif not words and not validb:status='双侧词语待恢复'
 elif not words:status='索引词语待恢复'
 elif not validb:status='正文词语待恢复'
 elif inferred:status='索引编号推定待核对'
 elif bw!=iw:status='词形不一致'
 else:status='词形一致'
 notes=re.findall(r'\(([^)]*)\)',b['word']);bp=' / '.join(notes)
 pinstatus='正文无括号注音'
 if notes:
  pinstatus='注音一致' if any(pins(x)==pins(y) for x in notes for y in py) else ('注音不一致' if py else '索引拼音缺失')
 flags=list(dict.fromkeys(b['flags']+[f for r in rr for f in r['flags']]))
 if not ip:flags.append('索引拼音未恢复')
 if ip and (re.search(r'\d',ip) or HAN.search(ip)):flags.append('拼音字符异常')
 # Expose multi-candidate source spellings and number repairs.
 basis=b['id_basis']+'；'+' / '.join(sorted({r['id_basis'] for r in rr}))
 word=bw if validb else (words[0] if len(words)==1 else '')
 row=[n,word,ip,b['word'],iw,status,bp,pinstatus,b['page'],' / '.join(str(x) for x in sorted({r['page'] for r in rr})),b['id_raw'],' / '.join(r['id_raw'] for r in rr),basis,'；'.join(flags)]
 ROWS.append(row);stats[status]+=1
 if status!='词形一致' or pinstatus in ['注音不一致','索引拼音缺失']:DIFF.append(row+['','',''])
 if status!='词形一致' or pinstatus=='注音不一致' or b['id_basis']!='原识别编号' or not ip or any('待核对' in f or '异常' in f or '缺失' in f for f in flags):REVIEW.append(row+['','',''])
 if status=='词形不一致' and len(examples)<20:examples.append([n,b['word'],iw,ip,b['page'],row[9]])
UNRES=[r for r in I if not r['id']]
UNHEAD=['PDF页','书内页','栏','纵坐标','词语','拼音','原始编号','正文同词编号候选','处理说明','复核编号','复核词语','复核拼音','复核备注']
UNROWS=[[r['page'],r['book_page'],r['col'],r['y'],r['word'],r['pinyin'],r['id_raw'],' / '.join(str(n) for n in WM.get(r['word_key'],[])),'；'.join(r['flags']),'','','',''] for r in UNRES]
summary=dict(source=next((ROOT/'Paddle').glob('*Struct*.json')).name,expected_entries=56790,body_records=len(B),index_records=len(I),index_ids=sum(bool(v) for v in IM.values()),index_unresolved=len(UNRES),status_counts=dict(stats),number_repaired_body=sum(r['id_basis']!='原识别编号' for r in B),index_inferred_records=sum(r['id_basis']=='按正文唯一同词推定' for r in I),with_word=sum(bool(r[1]) for r in ROWS),with_pinyin=sum(bool(r[2]) for r in ROWS),pronunciation_differences=sum(r[7]=='注音不一致' for r in ROWS),difference_rows=len(DIFF),review_rows=len(REVIEW),examples=examples)
for name,header,rows in [('PP完整词库',HEAD,ROWS),('PP正文索引差异',HEAD+['复核词语','复核拼音','复核备注'],DIFF),('PP待核对记录',HEAD+['复核词语','复核拼音','复核备注'],REVIEW),('PP索引未定编号',UNHEAD,UNROWS)]:
 with (P/f'{name}.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(header);w.writerows(rows)
(P/'body_recovered.json').write_text(json.dumps(B,ensure_ascii=False),'utf-8');(P/'index_recovered.json').write_text(json.dumps(I,ensure_ascii=False),'utf-8')
(P/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),'utf-8')
(P/'workbook_data.json').write_text(json.dumps(dict(header=HEAD,rows=ROWS,differences=DIFF,review=REVIEW,unresolved_header=UNHEAD,unresolved=UNROWS,summary=summary),ensure_ascii=False),'utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
