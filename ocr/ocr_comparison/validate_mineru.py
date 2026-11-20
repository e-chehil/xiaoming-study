import json,pathlib,hashlib,collections,csv,re,unicodedata,zipfile,xml.etree.ElementTree as ET
from process_mineru import ROOT,Table,lex,HAN,N,notation

def get(obj,path):
 for k in path:obj=obj[k]
 return obj

def validate(model,folder):
 p=ROOT/folder;manifest=json.loads((p/'source_manifest.json').read_text('utf-8'))
 tabs=json.loads((p/'table_manifest.json').read_text('utf-8'))
 sources={}
 for m in manifest:
  raw=(ROOT/m['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==m['sha256']
  sources[m['file']]=json.loads(raw)
  assert len(sources[m['file']]['pdf_info'])==m['pages']
 for t in tabs:
  pg=sources[t['source_file']]['pdf_info'][t['source_page']-1]
  sp=get(pg['preproc_blocks'],t['source_path'])
  assert Table(sp['html']).rows==t['rows'],(model,t['table'])
 B=json.loads((p/'body_recovered.json').read_text('utf-8'));I=json.loads((p/'index_recovered.json').read_text('utf-8'))
 d=json.loads((p/'workbook_data.json').read_text('utf-8'));s=d['summary'];rows=d['rows'];refs=0
 for r in B+I:
  assert r['word_key']==lex(r['word'])
  assert r['id'] is None or 1<=r['id']<=N
  for rr in r['refs']:
   t=tabs[rr['table']]
   assert rr['cells']==[c['text'] for c in t['rows'][rr['row']]],(model,r['id'],rr)
   assert t['source_file']==r['source_file'] and t['page']==r['page']
   refs+=1
  if r.get('pinyin_atoms'):
   available=''.join(re.sub(r'\s+','',a['text']) for a in r['pinyin_atoms'])
   used=re.sub(r'\s+','',r['pinyin'])
   assert used in available,(model,r['id'],used,available)
   for a in r['pinyin_atoms']:
    cell=tabs[r['table']]['rows'][a.get('row',r['row'])][a['cell']]['text']
    assert re.sub(r'\s+','',a['text']) in re.sub(r'\s+','',notation(unicodedata.normalize('NFC',cell)))
 assert [r[0] for r in rows]==list(range(1,N+1))
 assert sum(s['status_counts'].values())==N
 assert len(d['differences'])==s['difference_rows'] and len(d['review'])==s['review_rows']
 assert sum(bool(r[1]) for r in rows)==s['with_word']
 assert sum(bool(r[2]) for r in rows)==s['with_pinyin']
 csv_counts={}
 for title,expected in [('完整词库',N),('正文索引差异',len(d['differences'])),('待核对记录',len(d['review'])),('未定编号',len(d['unresolved'])),('拼音待恢复',N-s['with_pinyin'])]:
  f=p/(model+title+'.csv')
  with f.open(encoding='utf-8-sig',newline='') as h:count=sum(1 for _ in csv.reader(h))-1
  assert count==expected,(f,count,expected);csv_counts[title]=count
 orphans=json.loads((p/'orphan_rows.json').read_text('utf-8'))
 with (p/(model+'原始零散片段.csv')).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['部分','PDF页','书内页','源文件','分段页','表','行','原始片段','记录原因','完整原始行','复核备注'])
  for r in orphans:
   t=tabs[r['table']];w.writerow([t['side'],t['page'],t['book_page'],t['source_file'],t['source_page'],t['table'],r['row']+1,r['text'],r['reason'],' | '.join(c['text'] for c in t['rows'][r['row']]),''])
 csv_counts['原始零散片段']=len(orphans)
 result=dict(model=model,source_files=len(manifest),source_hashes_verified=True,source_pages=sum(x['pages'] for x in manifest),source_tables_verified=len(tabs),source_row_references_verified=refs,master_ids_continuous=True,master_rows=N,csv_rows=csv_counts,note='验证来源引用、编号范围和清单统计；没有逐条判定OCR是否符合原PDF。')
 (p/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
 print(json.dumps(result,ensure_ascii=False,indent=2))
 return s

def notes(model,folder,s):
 p=ROOT/folder;manifest=json.loads((p/'source_manifest.json').read_text('utf-8'))
 text=f'''# {model} 独立词库整理说明

仅使用本目录对应模型的2份正文JSON、3份音序索引JSON。正文共249页、音序索引共414页，按原书频序号1—56790建立一行一编号的词库。没有使用其他三个模型或外部词典补词、改字、补拼音。

有词形候选{s['with_word']:,}条，有非空拼音{s['with_pinyin']:,}条；正文有记录的编号{s['body_ids']:,}个，索引有记录的编号{s['index_ids']:,}个。字段非空表示保留了候选，不表示识别正确。

## 文件

- `{model}完整词库.csv`：全部56790个编号，含最终候选、正文原文、索引原文、拼音、原始编号、恢复方式、PDF页及源文件内位置。
- `{model}正文索引差异.csv`：词形、注音、缺失、重复及推定等差异，共{s['difference_rows']:,}条。
- `{model}待核对记录.csv`：包含差异及字段恢复、异常、重复等需复核记录，共{s['review_rows']:,}条。它与差异清单有重合，不能相加。
- `{model}未定编号.csv`：正文{s['body_unresolved']}条、索引{s['index_unresolved']}条没有确定编号的原始记录，不丢弃。
- `{model}拼音待恢复.csv`：{56790-s['with_pinyin']}条最终拼音缺失的编号。
- 工作簿位于 `../outputs/mineru_independent_20261020/`，包含词库、差异清单、未定编号和统计说明。完整逐条定位见上述CSV和来源记录。

## 整理口径

1. 原始HTML的rowspan、colspan用于重建正文五栏。无编号续行只接回同栏前一词条，避免将邻栏注音接错；合并词条保留所有源行引用。
2. 音序索引分别保留词语、拼音、编号的源行。整表词语数与编号数一致时，可按列序重新配对；跨行位置变化均标注。该类恢复属于整理操作。
3. 只有在来源字符完整且能唯一确定边界时，才拼接长词或拆分合并词形。借助本模型正文佐证的词形拼接单列为依赖记录，不计独立一致。
4. 拼音空格边界的恢复只重新分配已经识别的字符，不生成拼音。数学重音标记解码为相应字符；例如acute解码为尖音符，tilde仍保留波浪符，不将其擅改为正确声调。完整原始HTML保留。
5. 正文相邻连续编号恢复{s['number_repaired_body']}条；正文借助索引唯一同词推定编号{s['body_inferred_records']}条；索引借助正文推定编号{s['index_inferred_records']}条。跨部分推定不构成独立验证，不用推定记录再反向证明另一侧。
6. 词形比较去空白与正文括号注音，统一少量标点；不做繁简转换、同音替换或OCR错字纠正。正文和索引两边原文均保留。
7. 词库词形优先取唯一正文候选，正文缺失或多候选时取唯一索引候选。拼音优先索引，只有单字词可借正文括号注音补充；来源明确标注。
8. 正文仅部分词有注音，而且有时只标一个字。因此注音差异只是复核线索，不能换算全库拼音错误率。词形一致也可能是双方识别成同一错字。

## 对比与后续交叉验证

每个编号均保留各自原文、候选、来源与依赖标签，后续可与PP-StructureV3、VL-1.6以及另一套MinerU按编号对齐。正式比较应使用统一归一化规则和四模型共同可比编号，分别考察未经恢复的结果与恢复后结果，并排除跨部分推定及拼接依赖。不能把不同整理流程的“词形一致”统计直接当作同一口径的准确率。

跨模型多数一致可作为核查优先级依据；有分歧、推定、缺失、异常重复、特殊声调或同形多音的词条需回到原PDF裁定，再写入单独的校订词库。本次保留独立结果，未执行跨模型补写，也未宣称已得到逐条无误的校订版。

## 输入清单

模型名按用户文件夹标签保留。文件元数据中的实际后端为 `{manifest[0]['backend']}`，版本 `{manifest[0]['version']}`；这些元数据需一并保留，方便解释后续比较。

| 文件 | 页数 | SHA256 |
|---|---:|---|
'''
 for m in manifest:text+=f"| {m['file']} | {m['pages']} | {m['sha256']} |\n"
 text+='\n来源校验见 validation.json。原始表格、逐条源行及恢复依据保留在本目录的JSON中。\n'
 text+='\n## 原始零散片段\n\n另保留 `'+model+'原始零散片段.csv`，包含页首无编号注音及空词形的拼音／编号行。部分字段已用于表内恢复；保留初始片段记录供完整复核，不将其另计作新增词条，也不把纯注音片段强行配到一个编号。\n'
 (p/'整理说明.md').write_text(text,'utf-8')

if __name__=='__main__':
 for model,folder in [('MinerU VLM','mineru_vlm_vocab'),('MinerU','mineru_vocab')]:
  s=validate(model,folder);notes(model,folder,s)
