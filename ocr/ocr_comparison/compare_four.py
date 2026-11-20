import pathlib,json,re,unicodedata,collections,csv,functools
ROOT=pathlib.Path(__file__).resolve().parent.parent
OUT=ROOT/'ocr_comparison'/'four_model_audit';OUT.mkdir(exist_ok=True)
N=56790
MODELS=[('PP','PP-StructureV3','pp_vocab'),('VL','VL-1.6','vl_vocab'),('MUVLM','MinerU VLM（hybrid）','mineru_vlm_vocab'),('MU','MinerU（pipeline）','mineru_vocab')]
HAN=re.compile(r'[\u3400-\u9fff]')
def word(s):
 s=re.sub(r'\s+','',unicodedata.normalize('NFC',s)).translate(str.maketrans({'（':'(', '）':')','，':',','’':"'",'－':'-'}))
 return re.sub(r'\([^)]*\)','',s).strip('.,。·;；:：')
def pin(s):return re.sub(r"[\s\-·,'，’]",'',unicodedata.normalize('NFC',s)).lower().replace('ɡ','g').replace('ɑ','a')
def independent(rs,strict=False):
 return all('推定' not in r.get('id_basis','') and '佐证' not in r.get('id_basis','') and not r.get('dependent_word') and not any('佐证' in f for f in r.get('flags',[])) and (not strict or r.get('id_basis')=='原识别编号') for r in rs)
def validraw(r,n):
 return re.fullmatch(r'\s*0*'+str(n)+r'\s*',r.get('id_raw','')) is not None
def load():
 data={}
 for key,label,folder in MODELS:
  p=ROOT/folder;d={'label':label,'folder':folder,'summary':json.loads((p/'summary.json').read_text('utf-8')),'master':json.loads((p/'workbook_data.json').read_text('utf-8'))['rows'],'sides':{},'words':{}}
  for side in ['body','index']:
   a=json.loads((p/(side+'_recovered.json')).read_text('utf-8'));idx=collections.defaultdict(list)
   for r in a:
    if r.get('id') and 1<=r['id']<=N:idx[r['id']].append(r)
   d['sides'][side]=idx
   d['words'][side]={n:sorted({word(r['word']) for r in rs if HAN.search(word(r['word']))}) for n,rs in idx.items()}
  d['eligible']={n for n in range(1,N+1) if all(len(d['words'][side].get(n,[]))==1 and independent(d['sides'][side][n]) for side in ['body','index'])}
  d['strict']={n for n in d['eligible'] if all(independent(d['sides'][side][n],True) for side in ['body','index'])}
  d['equal']={n for n in d['eligible'] if d['words']['body'][n]==d['words']['index'][n]}
  data[key]=d
 return data

def compare(data):
 common=set.intersection(*(d['eligible'] for d in data.values()));strict=set.intersection(*(d['strict'] for d in data.values()))
 stats={'expected_entries':N,'common_independent_n':len(common),'common_original_number_n':len(strict),'models':{},'normalization':'去空白、正文括号注音，统一少量标点；保留繁简、错字和声调差别；拼音比较忽略大小写、空格、连字符、隔音符，统一ɡ/g、ɑ/a。'}
 allowed=re.compile(r"[^A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙÜǕǗǙǛêÊḿńňǹɡɑ\s'’\-·,，]")
 for key,d in data.items():
  sm=d['summary'];m={k:sm.get(k,0) for k in ['with_word','with_pinyin','body_ids','index_ids','number_repaired_body','body_inferred_records','index_inferred_records','difference_rows','review_rows']}
  m['label']=d['label'];m['body_ids']=len(d['sides']['body']);m['index_ids']=len(d['sides']['index'])
  m['common_equal']=len(common&d['equal']);m['common_mismatched']=len(common-d['equal']);m['common_rate']=m['common_equal']/len(common)
  m['strict_equal']=len(strict&d['equal']);m['strict_rate']=m['strict_equal']/len(strict)
  m['independent_comparable']=len(d['eligible']);m['independent_equal']=len(d['equal'])
  m['body_valid_word_ids']=sum(bool(v) for v in d['words']['body'].values());m['index_valid_word_ids']=sum(bool(v) for v in d['words']['index'].values())
  m['body_multiple_word_ids']=sum(len(v)>1 for v in d['words']['body'].values());m['index_multiple_word_ids']=sum(len(v)>1 for v in d['words']['index'].values())
  m['pinyin_char_alerts']=sum(bool(allowed.search(r[2])) for r in d['master'] if r[2]);m['missing_words']=[r[0] for r in d['master'] if not r[1]];m['missing_pinyin']=[r[0] for r in d['master'] if not r[2]]
  stats['models'][key]=m
 rows=[];distribution=collections.Counter()
 for n in sorted(common):
  flags=[n in d['equal'] for d in data.values()];distribution[''.join('1' if f else '0' for f in flags)]+=1
  if not all(flags):
   r=[n]
   for d in data.values():r+=[d['words']['body'][n][0],d['words']['index'][n][0],'一致' if n in d['equal'] else '不一致']
   rows.append(r)
 stats['internal_pattern_counts_in_PP_VL_MUVLM_MU_order']=dict(distribution)
 stats['cross_model_master_agreement']={}
 for j,field,norm in [(1,'word',word),(2,'pinyin',pin)]:
  allnonempty=allsame=0;votes=collections.Counter()
  for n in range(1,N+1):
   vv=[norm(d['master'][n-1][j]) for d in data.values()]
   if all(vv):
    allnonempty+=1;cc=collections.Counter(vv);mx=max(cc.values());votes[str(mx)]+=1
    if len(cc)==1:allsame+=1
  stats['cross_model_master_agreement'][field]={'all_nonempty':allnonempty,'all_four_same':allsame,'largest_vote_counts':dict(votes)}
 head=['编号']
 for key,_,_ in MODELS:head +=[key+'正文',key+'索引',key+'内部一致性']
 with (OUT/'四模型共同可比差异.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(head);w.writerows(rows)
 # Aligned candidates are evidence for future adjudication, not a voted truth.
 with (OUT/'四模型全部编号对照.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);head=['编号']
  for key,_,_ in MODELS:head +=[key+'词形候选',key+'拼音候选',key+'内部状态',key+'编号处理']
  w.writerow(head)
  for n in range(1,N+1):
   rr=[n]
   for d in data.values():r=d['master'][n-1];rr +=[r[1],r[2],r[5],r[12]]
   w.writerow(rr)
 (OUT/'统一比较统计.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),'utf-8')
 return stats

if __name__=='__main__':
 stats=compare(load());print(json.dumps(stats,ensure_ascii=False,indent=2))
