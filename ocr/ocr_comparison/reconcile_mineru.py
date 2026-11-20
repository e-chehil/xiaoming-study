import pathlib,json,re,collections,csv,unicodedata,functools,sys,copy
from process_mineru import ROOT,HAN,N,lex,pins,compact,record,ref,validid

# Used only to find boundaries between already recognised pinyin chunks.
# No pronunciation is generated or corrected from this list.
SYLLABLES=set('''a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao he hei hen heng hm hng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu n na nai nan nang nao ne nei nen neng ng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo m'''.split())
TONES=set('\u0300\u0301\u0304\u030c')

@functools.lru_cache(maxsize=250000)
def syllable_counts(s):
 s=re.sub(r"[\s'’\-·,]",'',s.lower()).replace('ɡ','g').replace('ɑ','a')
 chars=[];marks=[]
 for ch in unicodedata.normalize('NFC',s):
  d=unicodedata.normalize('NFD',ch);base=d[0]
  if base=='u' and '\u0308' in d:base='v'
  if not 'a'<=base<='z':return frozenset()
  chars.append(base);marks.append(int(bool(set(d)&TONES)))
 plain=''.join(chars);dp=[set() for _ in range(len(plain)+1)];dp[0].add(0)
 for i in range(len(plain)):
  if not dp[i]:continue
  for j in range(i+1,min(i+7,len(plain)+1)):
   if plain[i:j] in SYLLABLES and sum(marks[i:j])<=1:
    dp[j].update(n+1 for n in dp[i])
 return frozenset(dp[-1])

def expected_counts(w):
 n=len(HAN.findall(w));return {n,n-1} if w.endswith('儿') and n>1 else {n}

def align_pinyin(words,atoms):
 # Preserve each source atom and whitespace boundary. Splits/joins are accepted
 # only when a unique best complete alignment exists for the whole table.
 chunks=[]
 for ai,a in enumerate(atoms):
  for t in re.findall(r'\S+',a['text']):chunks.append((t,ai,a['row']))
 if len(chunks)>300 or not chunks:return None
 @functools.lru_cache(None)
 def solve(i,j):
  if i==len(words):return (0,1,()) if j==len(chunks) else None
  remain=len(words)-i
  if len(chunks)-j<remain:return None
  best=None
  for k in range(j+1,min(j+12,len(chunks)-remain+2)):
   text=' '.join(a[0] for a in chunks[j:k])
   fits=bool(syllable_counts(text)&expected_counts(words[i]['word_key']))
   whole_atom=(j==0 or chunks[j-1][1]!=chunks[j][1]) and (k==len(chunks) or chunks[k-1][1]!=chunks[k][1]) and chunks[j][1]==chunks[k-1][1]
   if not fits and not whole_atom:continue
   rest=solve(i+1,k)
   if not rest:continue
   # Prefer respecting existing cell boundaries and nearby source rows.
   broken=int(j>0 and chunks[j-1][1]==chunks[j][1])+int(k<len(chunks) and chunks[k-1][1]==chunks[k][1])
   joined=len({x[1] for x in chunks[j:k]})-1
   distance=min(3,abs(words[i]['row']-chunks[j][2]))
   score=rest[0]+broken*8+joined*5+distance+(0 if fits else 25)
   if best is None or score<best[0]:best=(score,rest[1],((j,k),)+rest[2])
   elif score==best[0]:best=(score,min(2,best[1]+rest[1]),best[2])
  return best
 ans=solve(0,0)
 if not ans or ans[1]!=1:return None
 out=[]
 for j,k in ans[2]:
  aa=sorted({c[1] for c in chunks[j:k]})
  out.append((' '.join(c[0] for c in chunks[j:k]),[atoms[a] for a in aa]))
 return out

def regroup(rs):
 d=collections.defaultdict(list)
 for r in rs:
  if r['id']:d[r['id']].append(r)
 return d

def reconcile(model,folder):
 p=ROOT/folder
 B=json.loads((p/'body_raw.json').read_text('utf-8'));I=json.loads((p/'index_raw.json').read_text('utf-8'))
 tabs=json.loads((p/'table_manifest.json').read_text('utf-8'))
 orphans=json.loads((p/'orphan_rows.json').read_text('utf-8'))
 # Recover a mistyped body number only when same-page, adjacent rows supply
 # an unambiguous consecutive bracket and the target is unoccupied.
 occupied={r['id'] for r in B if r['id']}
 for t in [t for t in tabs if t['side']=='正文']:
  rr=[r for r in B if r['table']==t['table']]
  byrow=collections.defaultdict(list)
  for r in rr:byrow[r['row']].append(r)
  for ri,row in byrow.items():
   prev=byrow.get(ri-1,[]);nxt=byrow.get(ri+1,[])
   if len(row)==len(prev)==len(nxt)==5:
    for j,r in enumerate(row):
     a,b=prev[j]['id'],nxt[j]['id']
     if a and b and b==a+2 and r['id']!=a+1 and a+1 not in occupied:
      r['id']=a+1;r['id_basis']='表格相邻行连续编号恢复';r['flags'].append('正文编号由同列相邻连续序号恢复');occupied.add(a+1)
 BM=regroup(B)
 BW={n:next(iter(ws)) for n,rs in BM.items() if len(ws:={r['word_key'] for r in rs if HAN.search(r['word_key'])})==1}
 body_word_counts=collections.Counter(BW.values())
 # Rejoin recognised word fragments; never insert characters from the body.
 grouped=collections.defaultdict(list)
 for r in I:grouped[r['table']].append(r)
 newI=[]
 for ti,rs in grouped.items():
  t=tabs[ti];J=[];i=0
  while i<len(rs):
   r=rs[i]
   if i+1<len(rs):
    nx=rs[i+1];joined=r['word']+nx['word']
    possibilities={BW.get(n) for n in [r['id'],nx['id']] if n}
    samecell=r['row']==nx['row'] and r.get('word_atom',{}).get('cell')==nx.get('word_atom',{}).get('cell')
    explicit_target=lex(joined) in possibilities or samecell and body_word_counts.get(lex(joined))==1
    joinok=explicit_target and r['row']+1>=nx['row'] and r['word_key'] not in possibilities and nx['word_key'] not in possibilities
    if joinok:
     r['word']=joined;r['word_key']=lex(joined);r['refs']+=nx['refs'];r['flags']+=['跨行词形合并（正文佐证）'];r['dependent_word']=True
     if not r['id'] and nx['id']:r['id']=nx['id'];r['id_raw']=nx['id_raw'];r['number_atom']=nx.get('number_atom')
     i+=2;J.append(r);continue
   J.append(r);i+=1
  # Split concatenated recognised words only when the table's own number
  # stream and this model's body provide one exact partition.
  nums=t['fields']['number'];allowed={validid(a['text']) for a in nums}
  options=collections.defaultdict(list)
  for n in allowed:
   if n in BW:options[BW[n]].append(n)
  K=[]
  for r in J:
   w=r['word_key']
   if w and len(w)>1 and w not in options and len(J)<len(nums):
    @functools.lru_cache(None)
    def part(s):
     if not s:return [()]
     paths=[]
     for a,ids in options.items():
      if a and s.startswith(a) and len(ids)==1:
       for tail in part(s[len(a):]):
        paths.append(((a,ids[0]),)+tail)
        if len(paths)>1:return paths
     return paths
    paths=part(w)
    if len(paths)==1 and len(paths[0])>1:
     for a,n in paths[0]:
      rr=copy.deepcopy(r);rr['word']=a;rr['word_key']=a;rr['id']=n;rr['id_basis']='按正文唯一同词推定';rr['flags']+=['同格多词拆分（正文佐证）'];rr['dependent_word']=True;K.append(rr)
     continue
   K.append(r)
  J=K
  if len(J)==len(nums):
   for r,a in zip(J,nums):
    n=validid(a['text']);old=r['id']
    if r.get('number_atom')!=a:
     r['id_raw']=a['text'];r['id']=n;r['number_atom']=a;r['refs'].append(ref(t,a['row']))
     if r['id_basis']!='按正文唯一同词推定':r['id_basis']='表内列序恢复' if a['row']!=r['row'] or old!=n else r['id_basis']
     if a['row']!=r['row'] or old!=n:r['flags'].append('索引编号按完整同表列序恢复')
  pys=t['fields']['pinyin']
  if len(pys)==len(J):
   aligned=[(a['text'],[a]) for a in pys]
  else:aligned=align_pinyin(J,pys)
  if aligned:
   for r,(py,aa) in zip(J,aligned):
    if r['pinyin']!=py or len(aa)!=1 or aa[0]['row']!=r['row']:r['flags'].append('拼音表内列序或空格边界恢复')
    r['pinyin']=py;r['pinyin_atoms']=aa
    for a in aa:
     if a['row']!=r['row']:r['refs'].append(ref(t,a['row']))
  else:
   # Direct row association remains available without guessing missing pinyin.
   for r in J:
    if r['pinyin']:continue
    aa=[a for a in pys if a['row']==r['row']]
    same=[x for x in J if x['row']==r['row']]
    if len(aa)==1 and len(same)==1:r['pinyin']=aa[0]['text'];r['pinyin_atoms']=aa
  newI+=J
 I=newI
 # Infer missing/duplicated body IDs from the model's own independently
 # recognised index, then prohibit those body records from proving index IDs.
 IW=collections.defaultdict(set)
 for r in I:
  if r['id'] and HAN.search(r['word_key']) and '推定' not in r['id_basis'] and not r.get('dependent_word'):IW[r['word_key']].add(r['id'])
 occupied={r['id'] for r in B if r['id']};counts=collections.Counter(r['id'] for r in B if r['id'])
 for r in B:
  ns=IW.get(r['word_key'],set())
  if len(ns)==1:
   n=next(iter(ns))
   if n!=r['id'] and n not in occupied and (not r['id'] or counts[r['id']]>1):
    r['id']=n;r['id_basis']='按索引唯一同词推定';r['flags'].append('正文编号按索引同词推定，不能独立验证');occupied.add(n)
 BWids=collections.defaultdict(set)
 for r in B:
  if r['id'] and HAN.search(r['word_key']) and '推定' not in r['id_basis']:BWids[r['word_key']].add(r['id'])
 occupied={r['id'] for r in I if r['id']};counts=collections.Counter(r['id'] for r in I if r['id'])
 for r in I:
  ns=BWids.get(r['word_key'],set());r['body_word_id_candidates']=sorted(ns)
  if len(ns)==1:
   n=next(iter(ns))
   if n!=r['id'] and (not r['id'] or counts[r['id']]>1 and n not in occupied):
    r['id']=n;r['id_basis']='按正文唯一同词推定';r['flags'].append('索引编号按正文同词推定，不能独立验证');occupied.add(n)
 BM=regroup(B);IM=regroup(I)
 HEAD=['频序号','词语（正文唯一优先）','拼音（索引优先）','正文词形','索引词形','核对结果','正文括号注音','注音核对','正文PDF页','索引PDF页','正文原编号','索引原编号','编号处理','处理说明','词语来源','拼音来源','正文定位','索引定位']
 ROWS=[];DIFF=[];REVIEW=[];ST=collections.Counter()
 def location(rs):return ' / '.join(f"{r['source_file']} 分段页{r['source_page']} 表{r['table']} 行{r['row']+1}" for r in rs)
 for n in range(1,N+1):
  br=BM.get(n,[]);ir=IM.get(n,[]);bw=sorted({r['word_key'] for r in br if HAN.search(r['word_key'])});iw=sorted({r['word_key'] for r in ir if HAN.search(r['word_key'])});py=sorted({r['pinyin'].strip() for r in ir if r['pinyin'].strip()})
  bi=any('推定' in r['id_basis'] for r in br);ii=any('推定' in r['id_basis'] for r in ir);dep=any(r.get('dependent_word') for r in ir)
  if not bw and not iw:status='双侧词语待恢复'
  elif not bw:status='正文词语待恢复'
  elif not iw:status='索引词语待恢复'
  elif len(bw)>1:status='正文同编号多词形'
  elif len(iw)>1:status='索引同编号多词形'
  elif bi:status='正文编号推定待核对'
  elif ii:status='索引编号推定待核对'
  elif dep:status='跨行词形恢复待核对'
  elif bw!=iw:status='词形不一致'
  elif len(py)>1:status='索引拼音多候选'
  else:status='词形一致'
  w=bw[0] if len(bw)==1 else iw[0] if len(iw)==1 else ''
  ws='正文' if len(bw)==1 else '索引（正文缺失或多候选）' if len(iw)==1 else '缺失或多候选'
  notes=sorted({x for r in br for x in re.findall(r'\(([^)]*)\)',compact(r['word']))})
  ip=' / '.join(py);ps='索引' if py else ''
  if not ip and len(w)==1 and len(notes)==1 and re.fullmatch(r"[A-Za-zÀ-žǍ-ǜḿǹ'\-]+",notes[0]):ip=notes[0];ps='正文单字括号注音'
  pn='正文无括号注音'
  if notes:
   pn='索引拼音缺失' if not py else '多注音候选待核对' if len(notes)>1 or len(py)>1 else '注音一致' if pins(notes[0])==pins(py[0]) else '注音不一致'
  flags=list(dict.fromkeys(f for r in br+ir for f in r['flags']))
  if not br:flags.append('正文编号记录缺失')
  if not ir:flags.append('索引编号记录缺失')
  if not ip:flags.append('拼音未恢复')
  if ip and re.search(r"[^A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙÜǕǗǙǛêÊḿńňǹ\s'’\-·,]",ip):flags.append('拼音字符异常')
  if any(re.search(r'\d',x) for x in bw+iw):flags.append('词形含数字待核对')
  if len(br)>1:flags.append('正文同编号多条记录')
  if len(ir)>1:flags.append('索引同编号多条记录')
  basis='正文：'+(' / '.join(sorted({r['id_basis'] for r in br})) or '无记录')+'；索引：'+(' / '.join(sorted({r['id_basis'] for r in ir})) or '无记录')
  row=[n,w,ip,' / '.join(sorted({r['word'] for r in br})),' / '.join(sorted({r['word'] for r in ir})),status,' / '.join(notes),pn,' / '.join(str(x) for x in sorted({r['page'] for r in br})),' / '.join(str(x) for x in sorted({r['page'] for r in ir})),' / '.join(sorted({r['id_raw'] for r in br})),' / '.join(sorted({r['id_raw'] for r in ir})),basis,'；'.join(flags),ws,ps,location(br),location(ir)]
  ROWS.append(row);ST[status]+=1
  if status!='词形一致' or pn in ['注音不一致','多注音候选待核对','索引拼音缺失']:DIFF.append(row+['','',''])
  if status!='词形一致' or pn not in ['正文无括号注音','注音一致'] or any(r['id_basis']!='原识别编号' for r in br+ir) or not ip or len(br)>1 or len(ir)>1 or any('异常' in x or '待核对' in x for x in flags):REVIEW.append(row+['','',''])
 UH=['部分','PDF页','书内页','源文件','分段页','表','行','词语','拼音','原编号','处理说明','复核编号','复核词语','复核拼音','复核备注']
 UR=[[side,r['page'],r['book_page'],r['source_file'],r['source_page'],r['table'],r['row']+1,r['word'],r['pinyin'],r['id_raw'],'；'.join(r['flags']),'','','',''] for side,rs in [('正文',B),('索引',I)] for r in rs if not r['id']]
 missingpy=[r+['','',''] for r in ROWS if not r[2]]
 S=dict(model=model,source=model+'：2份正文JSON及3份音序索引JSON',expected_entries=N,body_records=len(B),index_records=len(I),body_ids=len(BM),index_ids=len(IM),body_unresolved=sum(not r['id'] for r in B),index_unresolved=sum(not r['id'] for r in I),with_word=sum(bool(r[1]) for r in ROWS),with_pinyin=sum(bool(r[2]) for r in ROWS),status_counts=dict(ST),number_repaired_body=sum(r['id_basis'] not in ['原识别编号','按索引唯一同词推定'] for r in B),body_inferred_records=sum(r['id_basis']=='按索引唯一同词推定' for r in B),index_inferred_records=sum(r['id_basis']=='按正文唯一同词推定' for r in I),pronunciation_differences=sum(r[7]=='注音不一致' for r in ROWS),difference_rows=len(DIFF),review_rows=len(REVIEW),body_pages=249,index_pages=414,pinyin_character_alerts=sum('拼音字符异常' in r[13] for r in ROWS))
 for title,head,rows in [('完整词库',HEAD,ROWS),('正文索引差异',HEAD+['复核词语','复核拼音','复核备注'],DIFF),('待核对记录',HEAD+['复核词语','复核拼音','复核备注'],REVIEW),('未定编号',UH,UR),('拼音待恢复',HEAD+['复核词语','复核拼音','复核备注'],missingpy)]:
  with (p/(model+title+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
   w=csv.writer(f);w.writerow(head);w.writerows(rows)
 for name,obj in [('body_recovered',B),('index_recovered',I),('summary',S),('workbook_data',dict(header=HEAD,rows=ROWS,differences=DIFF,review=REVIEW,unresolved_header=UH,unresolved=UR,summary=S))]:
  (p/(name+'.json')).write_text(json.dumps(obj,ensure_ascii=False,indent=2 if name=='summary' else None),'utf-8')
 print(json.dumps(S,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':
 for model,folder in [('MinerU VLM','mineru_vlm_vocab'),('MinerU','mineru_vocab')]:reconcile(model,folder)
