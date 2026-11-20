"""Reproducible, ID-preserving comparison with the user's GitHub reference."""
import csv, hashlib, io, json, os, pathlib, re, unicodedata, urllib.request, urllib.parse, sys
from collections import Counter
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'outputs/github_reproof_20261023'
COMMIT = '712fb0f0c420f6ceca0778ca46eb3cc3cbc5a9d8'
BLOB = 'b4bacfe6ad28cb7b708aff9fd75753c0116e8653'
URL = f'https://raw.githubusercontent.com/zispace/hanzi-words-cycb/{COMMIT}/' + urllib.parse.quote('现代汉语常用词表（第2版）.tsv')
def save(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2), 'utf-8')
def tsv(name, header, rows):
    with (OUT/name).open('w', encoding='utf-8', newline='') as f:
        w=csv.writer(f,delimiter='\t',lineterminator='\n');w.writerow(header);w.writerows(rows)
def load(path):
    with path.open(encoding='utf-8-sig',newline='') as f: return list(csv.reader(f,delimiter='\t'))
def norm_word(s): return unicodedata.normalize('NFC',s).replace('，',',')
def norm_pin(s):
    s=unicodedata.normalize('NFC',s).lower().replace('ɑ','a').replace('ɡ','g')
    s=s.replace('、',',').replace('，',',').replace('；',',').replace(';',',')
    return re.sub(r"[\s·•‧˙\-‐‑–—'’‘ʼ]",'',s)
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    raw=urllib.request.urlopen(URL,timeout=60).read()
    assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==BLOB
    (OUT/'GitHub参考原文件.tsv').write_bytes(raw)
    own=load(ROOT/'现代汉语常用词表.tsv'); ref=list(csv.reader(io.StringIO(raw.decode('utf-8-sig')),delimiter='\t'))
    assert len(own)==len(ref)==56791
    a={int(r[0]):r for r in own[1:]};b={int(r[0]):r for r in ref[1:]}
    assert set(a)==set(b)==set(range(1,56791)) and len(a)==len(b)==56790
    candidates=[];allrows=[];worddiff=[];pindiff=[];counts=Counter()
    for n in range(1,56791):
        x,y=a[n],b[n]; w=x[1]!=y[1];p=x[2]!=y[7]
        wn=norm_word(x[1])!=norm_word(y[1]);pn=norm_pin(x[2])!=norm_pin(y[7])
        category='词形或编号差异' if wn else '拼音内容差异' if pn else '标点或记音格式差异' if w or p else '完全一致'
        counts[category]+=1
        row=[n,x[1],x[2],y[1],y[7],category]
        allrows.append(row)
        if w: worddiff.append(row)
        if p: pindiff.append(row)
        if wn or pn: candidates.append(row)
    tsv('全量对照.tsv',['频序号','本地词语','本地拼音','GitHub词语','GitHub拼音','差异类型'],allrows)
    tsv('词形原始差异.tsv',['频序号','本地词语','本地拼音','GitHub词语','GitHub拼音','差异类型'],worddiff)
    tsv('拼音原始差异.tsv',['频序号','本地词语','本地拼音','GitHub词语','GitHub拼音','差异类型'],pindiff)
    save('candidates.json',candidates)
    files={}
    for p in [ROOT/'现代汉语常用词表.tsv', ROOT/'outputs/source_faithful_vocab_20261021/现代汉语常用词表_原书校对版.tsv', ROOT/'ocr_comparison/external_cycb_reference.tsv']:
        if p.is_file():
            files[str(p.relative_to(ROOT))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
    summary={'commit':COMMIT,'git_blob_sha1':BLOB,'url':URL,'reference_sha256':hashlib.sha256(raw).hexdigest(),'rows':len(a),'category_counts':dict(counts),'raw_word_differences':len(worddiff),'raw_pinyin_differences':len(pindiff),'candidate_count':len(candidates),'files':files}
    save('comparison_summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    print('CONTENT CANDIDATES')
    for row in candidates: print(json.dumps(row,ensure_ascii=False))
def images():
    import subprocess, concurrent.futures
    from PIL import Image,ImageDraw,ImageFont
    candidates=json.loads((OUT/'candidates.json').read_text('utf-8'))
    idx={r['id']:r for r in json.loads((ROOT/'pp_vocab/index_recovered.json').read_text('utf-8')) if r.get('id')}
    pages=OUT/'native_pages';pages.mkdir(exist_ok=True)
    crops=OUT/'index_crops';crops.mkdir(exist_ok=True)
    existing={}
    for p in (ROOT/'outputs').rglob('*.jpg'):
        m=re.match(r'p(\d{3})-\d+\.jpg$',p.name)
        if m and (int(m[1]) not in existing or p.stat().st_size>existing[int(m[1])].stat().st_size):existing[int(m[1])]=p
    wanted=sorted({idx[r[0]]['page'] for r in candidates})
    def get_page(p):
        if p not in existing:
            subprocess.run(['pdfimages','-f',str(p),'-l',str(p),'-j',str(ROOT/'现代汉语常用词表.pdf'),str(pages/f'p{p:03d}')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            existing[p]=max(pages.glob(f'p{p:03d}-*.jpg'),key=lambda f:f.stat().st_size)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(get_page,wanted))
    locations={}
    for n,*_ in candidates:
        r=idx[n];im=Image.open(existing[r['page']]);sx=im.width/1008;sy=im.height/1528
        x=min(t['bbox'][0] for t in r['tokens'])-6;y=r['y']-22
        im.crop((round(x*sx),round(y*sy),round((x+320)*sx),round((y+46)*sy))).save(crops/f'{n}.png')
        locations[n]={'pdf_page':r['page'],'book_page':r['book_page'],'x':x,'y':y,'width':320,'height':46,'crop':f'index_crops/{n}.png'}
    save('source_locations.json',locations)
    font=ImageFont.truetype(os.environ.get('OCR_FONT', 'msyh.ttc'),19)
    for st in range(0,len(candidates),16):
        panel=Image.new('RGB',(2000,8*185),'white');dr=ImageDraw.Draw(panel)
        for j,r in enumerate(candidates[st:st+16]):
            n,w,p,gw,gp,_=r;x=j//8*1000;y=j%8*185
            dr.text((x+8,y+3),f'{n} {w}  本地 {p}  PDF {idx[n]["page"]}',font=font,fill='#173c5e')
            dr.text((x+8,y+30),f'GitHub {gw}  {gp}',font=font,fill='#713900')
            im=Image.open(crops/f'{n}.png');im.thumbnail((975,120))
            panel.paste(im,(x+8,y+58));dr.line((x,y+184,x+998,y+184),fill='#cccccc')
        panel.save(OUT/f'review_{st:03d}.png')
    print('Prepared',len(candidates),'crops;',len(wanted),'pages; panels',list(range(0,len(candidates),16)))
def supplement():
    from PIL import Image,ImageDraw,ImageFont
    import subprocess
    candidates=load(OUT/'词形原始差异.tsv')[1:]
    font=ImageFont.truetype(os.environ.get('OCR_FONT', 'msyh.ttc'),18)
    images_by_page={}
    for p in (ROOT/'outputs').rglob('*.jpg'):
        m=re.match(r'p(\d{3})-\d+\.jpg$',p.name)
        if m and (int(m[1]) not in images_by_page or p.stat().st_size>images_by_page[int(m[1])].stat().st_size):images_by_page[int(m[1])]=p
    source={}
    for kind in ['index','body']:
        source[kind]={r['id']:r for r in json.loads((ROOT/f'pp_vocab/{kind}_recovered.json').read_text('utf-8')) if r.get('id')}
    folder=OUT/'supplement';folder.mkdir(exist_ok=True)
    jobs=[('index',int(r[0]),r) for r in candidates]+[('body',n,None) for n in [16880,16881,24981,24982,24983,40235]]
    for kind,n,_ in jobs:
        r=source[kind][n];p=r['page']
        if p not in images_by_page:
            prefix=OUT/'native_pages'/f'p{p:03d}'
            subprocess.run(['pdfimages','-f',str(p),'-l',str(p),'-j',str(ROOT/'现代汉语常用词表.pdf'),str(prefix)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            images_by_page[p]=max(prefix.parent.glob(prefix.name+'-*.jpg'),key=lambda f:f.stat().st_size)
        im=Image.open(images_by_page[p]);sx=im.width/1008;sy=im.height/1528
        x=min(t['bbox'][0] for t in r['tokens'])-7
        top=min(t['bbox'][1] for t in r['tokens'])-8;bottom=max(t['bbox'][3] for t in r['tokens'])+8
        width=320 if kind=='index' else 200
        im.crop((round(x*sx),round(top*sy),round((x+width)*sx),round(bottom*sy))).save(folder/f'{kind}_{n}.png')
    for st in range(0,len(jobs),12):
        panel=Image.new('RGB',(2200,6*245),'white');dr=ImageDraw.Draw(panel)
        for j,(kind,n,r) in enumerate(jobs[st:st+12]):
            x=j//6*1100;y=j%6*245;rec=source[kind][n]
            dr.text((x+6,y+3),f'{kind} {n} PDF {rec["page"]}',font=font,fill='#173c5e')
            if r:
                dr.text((x+6,y+30),f'本地 {r[1]}  {r[2]}',font=font,fill='#173c5e')
                dr.text((x+6,y+57),f'GitHub {r[3]}  {r[4]}',font=font,fill='#713900')
            crop=Image.open(folder/f'{kind}_{n}.png');crop.thumbnail((1080,150));panel.paste(crop,(x+6,y+86))
            dr.line((x,y+244,x+1098,y+244),fill='#cccccc')
        panel.save(OUT/f'supplement_{st:03d}.png')
    print('Supplement jobs',len(jobs))
def finalize():
    import shutil
    baseline=OUT/'本地校对前备份.tsv'
    if not baseline.exists(): shutil.copyfile(ROOT/'现代汉语常用词表.tsv',baseline)
    old=load(baseline);a={int(r[0]):r for r in old[1:]};new={n:r.copy() for n,r in a.items()}
    gh=load(OUT/'GitHub参考原文件.tsv');b={int(r[0]):r for r in gh[1:]}
    body={r['id']:r for r in json.loads((ROOT/'pp_vocab/body_recovered.json').read_text('utf-8')) if r.get('id')}
    loc=json.loads((OUT/'source_locations.json').read_text('utf-8'))
    changes={16880:16881,16881:16880,24981:24983,24982:24981,24983:24982}
    for n,source_id in changes.items():
        new[n]=[str(n),a[source_id][1],a[source_id][2]]
        assert norm_word(new[n][1])==norm_word(b[n][1])
        assert norm_pin(new[n][2])==norm_pin(b[n][7])
        assert norm_word(body[n]['word'].split('(')[0])==norm_word(new[n][1])
    header=['频序号','原词语','原拼音','GitHub词语','GitHub拼音','复核后词语','复核后拼音','结论','依据','正文PDF物理页','音序索PDF物理页','原图']
    decisions=[]
    for n in range(1,56791):
        x,y=a[n],b[n]
        wn=norm_word(x[1])!=norm_word(y[1]);pn=norm_pin(x[2])!=norm_pin(y[7])
        if not (wn or pn or x[1]!=y[1]):continue
        if n in changes:
            verdict='按词频正文修正编号对应'
            reason=f'正文编号{n}为{new[n][1]}，音序索同编号为{x[1]}。GitHub与正文一致。主表首列为频序号，采用正文的编号—词语对应；拼音随词语从本地既有条目移入，未改写读音。'
        elif n==40235:
            verdict='保留现值；正文与索引异文待核'
            reason='正文PDF185页为早早儿，音序索PDF639页为早早 zǎozǎo。GitHub取正文词形并添r，不能据此证明其拼音为原书索引注音。沿用现值，继续列入待核。'
        elif n==36999:
            verdict='保留候选；原图附加符号仍待辨清'
            reason='可见原书末音节有附加符号，但ü两点与声调不能可靠逐笔分辨。GitHub轻读标法不构成原图证据；保留既有huánghuā guīnǚ，继承原图待核状态。'
        elif n==47868:
            verdict='保留原书拼音逗号'
            reason='音序索原图跨两行排印，qǔzhīyúmín后有逗号；GitHub拼音字段漏掉句中逗号。保留本地逗号。'
        elif not wn and not pn:
            verdict='保留既有标点格式'
            reason='词形仅中文逗号与ASCII逗号不同；声调和字母内容一致。保留主库既有标点、空格、连字符及大小写，不据第三方排写格式重排原文。'
        else:
            verdict='原图支持保留本地'
            reason='已按编号回看音序索原始扫描，目标词形及差异处拼音与本地一致。GitHub的声调、轻声或字母写法与原书不同，不直接覆盖。'
        if n==49531:reason+=' 原书此条确注nánchù，另一编号10962注nánchu；辞书或词义处理不等于OCR错字。'
        if n==53940:reason+=' GitHub该字段还混入了重复的分音节拼音dāo bà zi。'
        page=loc.get(str(n),{}).get('pdf_page')
        if page is None:
            ii=json.loads((ROOT/'pp_vocab/index_recovered.json').read_text('utf-8'));page=next(r['page'] for r in ii if r.get('id')==n)
        crop=f'supplement/index_{n}.png' if (OUT/f'supplement/index_{n}.png').exists() else f'index_crops/{n}.png'
        decisions.append([n,x[1],x[2],y[1],y[7],new[n][1],new[n][2],verdict,reason,body[n]['page'],page,crop])
    assert len(decisions)==193
    tsv('差异逐项核对记录.tsv',header,decisions)
    tsv('本轮修订记录.tsv',header,[r for r in decisions if r[0] in changes])
    tsv('现代汉语常用词表_GitHub复核版.tsv',old[0],[new[n] for n in range(1,56791)])
    pending=load(ROOT/'outputs/errata_corrected_vocab_20261021/尚待核实记录.tsv')
    for row in pending[1:]:
        row[8]=str(ROOT/'outputs/errata_corrected_vocab_20261021'/row[8])
    tsv('尚待核实记录.tsv',pending[0],pending[1:])
    tsv('原书编号异文对照.tsv',['频序号','正文词语','正文PDF物理页','音序索词语','音序索PDF物理页','本轮采用','处理依据'],[[n,new[n][1],body[n]['page'],a[n][1],loc[str(n)]['pdf_page'],new[n][1],'按主表频序号含义，采用词频正文；保留音序索异文证据'] for n in changes]+[[40235,'早早儿',185,'早早',639,'早早','沿用既有索引词形与注音，保留异文待核']])
    before_sha=hashlib.sha256(baseline.read_bytes()).hexdigest()
    assert before_sha=='97f608be7167945916804f31af050d3611186a973a3634f469df59a4f93af02d'
    dest=OUT/'现代汉语常用词表_GitHub复核版.tsv';final=load(dest)
    differences=[int(x[0]) for x,y in zip(old[1:],final[1:]) if x!=y]
    assert differences==sorted(changes)
    assert len(final)==56791 and [int(r[0]) for r in final[1:]]==list(range(1,56791))
    assert all(len(r)==3 and all(r) for r in final[1:])
    assert dest.read_text('utf-8')==unicodedata.normalize('NFC',dest.read_text('utf-8'))
    assert len(pending)==21
    # Only publish after checking exactly the five reviewed rows changed.
    current=(ROOT/'现代汉语常用词表.tsv').read_bytes()
    assert current in [baseline.read_bytes(),dest.read_bytes()]
    shutil.copyfile(dest,ROOT/'现代汉语常用词表.tsv')
    validation={'rows':56790,'changed_row_ids':differences,'changed_word_fields':5,'changed_pinyin_fields':5,'reviewed_index_records':len(decisions),'content_candidates':176,'additional_punctuation_records_reviewed':17,'body_records_reviewed':6,'inherited_pending_records':20,'reference_commit':COMMIT,'reference_git_blob':BLOB,'baseline_sha256':before_sha,'final_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'root_matches_delivered':(ROOT/'现代汉语常用词表.tsv').read_bytes()==dest.read_bytes(),'only_expected_rows_changed':True,'ids_continuous':True,'nonempty_three_columns':True,'unicode_nfc':True,'note':'编号异文的5行随词语转移既有拼音；未新增或删减词条，未套用GitHub读音。'}
    save('交付校验.json',validation)
    report=f'''# GitHub参照复校结果（2026-10-23）

已对当前主词表全部56,790条与用户指定GitHub第2版TSV重新比对，并回查差异原图。本轮修正5行编号与词语的对应关系，连同其原有拼音成套移入。词条总量、三列结构和频序号均保留。工作区主词表已更新，修改前原文件另存《本地校对前备份.tsv》。

## 本轮实质修改

|频序号|校对前|校对后|正文PDF页|音序索PDF页|
|---|---|---|---|---|
|16880|肚 dǔ|舞姿 wǔzī|83|332（肚）|
|16881|舞姿 wǔzī|肚 dǔ|83|577（舞姿）|
|24981|磨 mò|男人 nánren|118|469（磨）|
|24982|铺 pù|磨 mò|118|488（铺）|
|24983|男人 nánren|铺 pù|118|471（男人）|

这5行的两种对应关系均真实存在于原书：GitHub按词频正文，本地旧值按音序索。不能将此简单称为GitHub错误或OCR字形错误。主表首列为“频序号”，因此本轮采用正文中的编号—词语对应。音序索的异文仍保留在《原书编号异文对照.tsv》及逐项记录中。5个词语及其拼音原先都已在本地，属于重新对应到正文频序号，没有凭空添词或删词，也没有将第三方记音覆盖到本地。

## 比对范围

- 下载固定提交{COMMIT}的文件，并核对Git blob SHA-1 {BLOB}，保证没有使用截断网页或别的版本。
- 校对前：49,499条三个基础字段完全一致，7,115条只有格式差异，176条进入重点复核。其中6条涉及词形或编号，169条涉及声调、轻声或字母等内容，另1条为GitHub拼音中漏逗号。
- 原始词形差异共24条，其中18条词形仅逗号宽度不同。176条重点项和这18条均回看音序索扫描；47868在两组中重合，去重后共193个不同编号。另回看正文6个编号。并非逐条人工通读全部56,790条。
- 原始拼音字符串差异7,291条。先按NFC、大小写、空格、分词连字符、隔音符号、轻声圆点和并列读音分隔符归并筛查，保留声调字母及u/ü区别。原始字符串及原始差异表完整保留，归并不用于改写主库。
- 参考文件与本地此前缓存的GitHub文件SHA-256完全相同。本轮新增工作是重新比对当前主表，完整回看本轮差异，并补查正文中的编号对应。

## 保留及未决事项

其余差异未发现可据本次证据新增修正的读音。169条重点项按原图保留，其中包括47868“取之于民,用之于民”的拼音逗号；另17条仅词形逗号宽度差异沿用本地格式。以下2条继续保留候选或异文状态：

- 40235：正文PDF185页为“早早儿”，索引PDF639页为“早早 zǎozǎo”。本轮保留既有索引词形和注音。此项涉及儿化形式的拼音，不能由第三方词形直接添r定案，也不能仅因采用正文编号来推断具体读音。
- 36999“黄花闺女”：末音节附加符号仍受扫描清晰度限制，保留huánghuā guīnǚ候选。第三方轻读记法不能消除原图疑点。

原有20项待核（18项原图不清、1项“拉开”待词义、1项“早早”异文）全部继承。GitHub与本地一致的待核项也不据此升级为“原图已辨清”。此前已实施的12项编辑勘误保留，旧的原书照录版不覆盖。

## 文件与来源

《现代汉语常用词表_GitHub复核版.tsv》与工作区主词表逐字节一致。UTF-8无BOM、LF换行、NFC，56,790行数据，首行表头不计入。逐项依据、修订前后值、正文和索引PDF物理页码见《差异逐项核对记录.tsv》。PDF物理页码减8为书内页码。裁图直接从PDF内嵌扫描截取，无补笔、重绘或生成式增强。

GitHub来源：[第2版固定版本](https://github.com/zispace/hanzi-words-cycb/blob/{COMMIT}/%E7%8E%B0%E4%BB%A3%E6%B1%89%E8%AF%AD%E5%B8%B8%E7%94%A8%E8%AF%8D%E8%A1%A8%EF%BC%88%E7%AC%AC2%E7%89%88%EF%BC%89.tsv)。[仓库说明](https://github.com/zispace/hanzi-words-cycb/blob/{COMMIT}/README.md)明确表示拼音参考词典，可能与原书不同，故只作发现差异的参照。

原书：现代汉语常用词表.pdf，SHA-256 ed5ab894a78179063476e2179996dadee809c8035256e053fba460852649c899。

校验结果详见《交付校验.json》：仅上述5行发生修改，每行词语及拼音各1字段，共10字段；编号无缺失、无新增或删减，20项待核未擅自销项。本次复核不构成对整部词表的逐项人工认证。
'''
    (OUT/'GitHub复校报告.md').write_text(report,'utf-8')
    print(json.dumps(validation,ensure_ascii=False,indent=2))
if __name__=='__main__':
    if '--images' in sys.argv: images()
    elif '--supplement' in sys.argv: supplement()
    elif '--finalize' in sys.argv: finalize()
    else: main()
