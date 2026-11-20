import json,pathlib,re,statistics,collections,unicodedata,hashlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
OUT=ROOT/'pp_vocab'
SOURCE=next((ROOT/'Paddle').glob('*Struct*.json'))
HAN=re.compile(r'[\u3400-\u9fff]')
def clean(s):return unicodedata.normalize('NFC',s).replace('（','(').replace('）',')').replace('，',',').replace('’',"'").replace('－','-').strip()
def compact(s):return re.sub(r'\s+','',clean(s))
def lex(s):return re.sub(r'\([^)]*\)','',compact(s)).strip('.,。·;；:：')
def med(xs):return statistics.median(xs)
def cluster(vals,k,step):
 lo=min(vals);c=[lo+i*step for i in range(k)]
 for _ in range(12):
  a=[[] for i in c]
  for x in vals:a[min(range(k),key=lambda j:abs(x-c[j]))].append(x)
  cc=[med(x) if x else c[j] for j,x in enumerate(a)]
  if cc==c:break
  c=cc
 return sorted(c)
def toks(a,p,start):
 o=a['prunedResult']['overall_ocr_res'];out=[]
 for i,(s,poly,score) in enumerate(zip(o['rec_texts'],o['rec_polys'],o['rec_scores'])):
  x0=min(q[0] for q in poly);x1=max(q[0] for q in poly);y0=min(q[1] for q in poly);y1=max(q[1] for q in poly)
  if (y0+y1)/2<start:continue
  out.append(dict(text=clean(s),raw=s,x=x0,right=x1,y=(y0+y1)/2,top=y0,bottom=y1,score=score,token=i,bbox=[x0,y0,x1,y1]))
 return out

def extract_frequency(a,p):
 ts=toks(a,p,390 if p==9 else 145)
 ns=[t for t in ts if re.fullmatch(r'\d{1,5}',t['text'])]
 centers=cluster([t['x'] for t in ns],5,180)
 def col(t):return max(0,min(4,sum(t['x']>=v-12 for v in centers)-1))
 groups=[[] for _ in range(5)]
 for t in ts:groups[col(t)].append(t)
 result=[];unused=[]
 for c,gg in enumerate(groups):
  anchors=[]
  for t in gg:
   m=re.match(r'^[.,。·]?(\d{1,6})(.*)$',t['text'])
   if m and t['x']<centers[c]+(20 if m[2] else 40):
    anchors.append(dict(id_raw=m[1],id=int(m[1]) if 1<=int(m[1])<=56790 else None,word=m[2],pinyin='',page=p,book_page=p-8,col=c+1,y=t['y'],tokens=[t],method='坐标配对',flags=[]))
  anchors.sort(key=lambda r:r['y'])
  for t in gg:
   if any(t is r['tokens'][0] for r in anchors):continue
   if not anchors:unused.append(t);continue
   rr=min(anchors,key=lambda r:(abs(t['y']-r['y']),r['y']))
   prev=[r for r in anchors if r['y']<t['y']];nxt=[r for r in anchors if r['y']>t['y']]
   pr=prev[-1] if prev else None;nr=nxt[0] if nxt else None
   if abs(t['y']-rr['y'])<=22:
    rr['tokens'].append(t)
   elif pr and 18<t['y']-pr['y']<=42 and (not nr or nr['y']-t['y']>12):
    pr['tokens'].append(t);pr['flags'].append('跨行续接')
   else:unused.append(t)
  for r in anchors:
   ss=[t for t in r['tokens'][1:] if not re.fullmatch(r'\d+',t['text'])]
   for t in sorted(ss,key=lambda t:(round(t['y']/15),t['x'])):
    txt=t['text'];m=re.match(r'^(\d+)([\u3400-\u9fff].*)',txt)
    if m and r['id_raw'].endswith(m[1]) and t['x']>r['tokens'][0]['right']-15:
     txt=m[2];r['flags'].append('重叠数字片段去除')
    r['word']+=txt
   r['word']=compact(r['word']);r['word_key']=lex(r['word'])
   if not HAN.search(r['word']):r['flags'].append('正文词语缺失或无汉字')
   if not r['id']:r['flags'].append('正文编号越界')
   result.append(r)
 return result,unused,centers

def extract_index(a,p):
 ts=toks(a,p,449 if p==259 else 145)
 hs=[t for t in ts if HAN.search(t['text'])]
 centers=cluster([t['x'] for t in hs],3,300)
 def col(t):return max(0,min(2,sum(t['x']>=v-35 for v in centers)-1))
 groups=[[] for _ in range(3)]
 for t in ts:groups[col(t)].append(t)
 result=[];unused=[]
 for c,gg in enumerate(groups):
  anchors=[]
  for t in sorted(gg,key=lambda t:t['y']):
   if t['x']<centers[c]+60 and t['x']>=centers[c]-35:
    prev=next((r for r in anchors if abs(r['y']-t['y'])<10),None)
    if prev:prev['word']+=t['text'];prev['tokens'].append(t)
    else:anchors.append(dict(id_raw='',id=None,word=t['text'],pinyin='',page=p,book_page=p-8,col=c+1,y=t['y'],tokens=[t],method='坐标配对',flags=[]))
  for t in gg:
   if any(t in r['tokens'] for r in anchors):continue
   if not anchors:unused.append(t);continue
   rr=min(anchors,key=lambda r:(abs(t['y']-r['y']),r['y']))
   prev=[r for r in anchors if r['y']<t['y']];nxt=[r for r in anchors if r['y']>t['y']]
   pr=prev[-1] if prev else None;nr=nxt[0] if nxt else None
   if abs(t['y']-rr['y'])<=23:rr['tokens'].append(t)
   elif pr and 18<t['y']-pr['y']<=42 and (not nr or nr['y']-t['y']>15):
    pr['tokens'].append(t);pr['flags'].append('跨行拼音或编号续接')
   else:unused.append(t)
  for r in anchors:
   pin=[];nums=[]
   w=r['word'];m=re.match(r'^([\u3400-\u9fff,，·]+)\s*([A-Za-zÀ-ž].*)$',w)
   if m and re.search(r'[a-zà-ž]',m[2]):pin.append(m[2]);r['word']=m[1].strip();r['flags'].append('词语拼音同框拆分')
   for t in sorted(r['tokens'][1:],key=lambda t:(round(t['y']/15),t['x'])):
    s=t['text']
    if re.fullmatch(r'\d{1,6}',s):nums.append(s)
    elif HAN.search(s):r['word']+=s
    else:
     m=re.search(r'(\d{1,6})\s*$',s)
     if m:nums.append(m[1]);s=s[:m.start()].strip();r['flags'].append('拼音编号同框拆分')
     if s:pin.append(s)
   r['word']=compact(r['word']);r['word_key']=lex(r['word']);r['pinyin']=' '.join(pin)
   r['id_raw']=' / '.join(nums)
   if len(nums)==1 and 1<=int(nums[0])<=56790:r['id']=int(nums[0])
   else:r['flags'].append('索引编号缺失或多候选')
   if not pin:r['flags'].append('拼音缺失')
   if pin and HAN.search(r['pinyin']):r['flags'].append('拼音混入汉字')
   result.append(r)
 # Merge indented continuation lines only when the previous line lacks an id.
 merged=[]
 for r in result:
  if merged:
   prev=merged[-1]
   if prev['col']==r['col'] and not prev['id'] and 15<r['y']-prev['y']<40 and r['tokens'][0]['x']>=centers[r['col']-1]+7:
    prev['word']+=r['word'];prev['word_key']=lex(prev['word']);prev['pinyin']+=' '+r['pinyin'];prev['id_raw']=r['id_raw'];prev['id']=r['id'];prev['tokens']+=r['tokens'];prev['flags']=[f for f in prev['flags'] if f!='索引编号缺失或多候选']+['词语跨行合并'];continue
  merged.append(r)
 return merged,unused,centers

def main():
 d=json.loads(SOURCE.read_text('utf-8'));body=[];index=[];un=[];pages=[]
 for section,lo,hi,func,target in [('正文',9,257,extract_frequency,body),('索引',259,672,extract_index,index)]:
  for p in range(lo,hi+1):
   rec,unused,centers=func(d[p-1],p);target+=rec
   for t in unused:un.append(dict(section=section,page=p,**t))
   pages.append(dict(section=section,page=p,records=len(rec),ids=sum(r['id'] is not None for r in rec),centers=centers,unused=len(unused)))
 for name,rs in [('body_raw',body),('index_raw',index),('unassigned_tokens',un),('page_extraction_stats',pages)]:
  (OUT/f'{name}.json').write_text(json.dumps(rs,ensure_ascii=False),'utf-8')
 for name,rs in [('BODY',body),('INDEX',index)]:
  ids=collections.Counter(r['id'] for r in rs if r['id']);print(name,'records',len(rs),'ids',len(ids),'duplicate',sum(v>1 for v in ids.values()),'missing',56790-len(ids),'flags',collections.Counter(x for r in rs for x in r['flags']))
 print('UNASSIGNED',len(un));print('BADPAGES',sorted(pages,key=lambda x:x['records'])[:8])

if __name__=='__main__':main()
