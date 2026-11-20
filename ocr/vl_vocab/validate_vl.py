import json,pathlib,re,html,unicodedata,collections,csv,hashlib
P=pathlib.Path(__file__).resolve().parent;src=next((P.parent/'Paddle').glob('*Paddle*.json'));D=json.loads(src.read_text('utf-8'));data=json.loads((P/'workbook_data.json').read_text('utf-8'));B=json.loads((P/'body_recovered.json').read_text('utf-8'));I=json.loads((P/'index_recovered.json').read_text('utf-8'));S=data['summary']
def clean(s):return unicodedata.normalize('NFC',html.unescape(re.sub('<[^>]*>','',s))).replace('（','(').replace('）',')').replace('，',',').replace('’',"'").replace('－','-').strip()
assert len(data['rows'])==56790 and [r[0] for r in data['rows']]==list(range(1,56791))
assert sum(S['status_counts'].values())==56790
assert all(len(r)==len(data['header']) for r in data['rows'])
assert len(data['differences'])==1707 and S['status_counts']['词形不一致']==1091
assert sum(bool(r[1]) for r in data['rows'])==S['with_word']==56790
assert sum(bool(r[2]) for r in data['rows'])==S['with_pinyin']==56688
cache={};checked=0
for r in B+I:
 for ref in r['refs']:
  key=(ref['source_page'],ref['source_block']);block=D[key[0]-1]['prunedResult']['parsing_res_list'][key[1]]
  if ref['source_kind']=='content':assert ref['raw_line']==block['block_content'].splitlines()[ref['source_line']]
  else:
   if key not in cache:
    cache[key]=[[clean(c) for c in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',tr,re.S)] for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>',block['block_content'],re.S)]
   assert ref['cells']==cache[key][ref['row']]
  checked+=1
for f in P.glob('VL*.csv'):
 with f.open(encoding='utf-8-sig',newline='') as fin:
  rows=list(csv.reader(fin));assert all(len(r)==len(rows[0]) for r in rows)
meta=dict(source=str(src.resolve()),sha256=hashlib.sha256(src.read_bytes()).hexdigest(),source_pages=len(D),all_56790_ids_unique_in_master=True,all_source_references_verified=checked,csv_rectangular=True)
(P/'validation.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),'utf-8')
missing=[r for r in data['rows'] if not r[2]]
with (P/'VL拼音待恢复.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['频序号','词语候选','正文括号注音','核对结果','正文原页（VL页眉）','索引原页候选','处理说明','复核拼音']);w.writerows([r[0],r[1],r[6],r[5],r[8],r[9],r[13],''] for r in missing)
print(json.dumps(meta,ensure_ascii=False));print('MISSING_PINYIN',len(missing),'EXAMPLES',[(r[0],r[1]) for r in missing[:12]])
print('UNRESOLVED',[(r['word'],r['id_raw'],len(r['pinyin'])) for r in I if not r['id']])
print('LONG_PIN',[(r['id'],r['word'],len(r['pinyin'])) for r in I if len(r['pinyin'])>250])
print('LEADING_EQUAL_CELLS',sum(isinstance(v,str) and v.startswith('=') for r in data['rows']+data['differences'] for v in r))
