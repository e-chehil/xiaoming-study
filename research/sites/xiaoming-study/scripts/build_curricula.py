"""Build teaching supplements, common ordering, compact runtime and source manifests."""
from collections import Counter, defaultdict
from pathlib import Path
import csv, hashlib, json, math, sys, time
from curriculum_order import optimize

PROJECT=Path(__file__).resolve().parents[1]
WORKSPACE=PROJECT.parents[1]
ROOT=WORKSPACE/'潇明码表'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,value):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8',newline='\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def char_code(c):
    if len(c)==1:return c[0]
    if len(c)==2:return c[0][:2]+c[1][:2]
    if len(c)==3:return c[0][:2]+c[1][0]+c[2][:2]
    return c[0][:2]+c[1][0]+c[2][0]+c[-1][0]
def weight(i):
    if not i.get('code'):return 0
    ranks=[int(r.strip()) for r in i.get('sourceFrequency','').split('/') if r.strip()] or ([i['frequency']] if i.get('frequency') else [])
    return math.fsum(1/r for r in ranks)

def latest_frequencies(data,directory):
    source=WORKSPACE/'现代汉语常用词表.tsv'
    with source.open(encoding='utf-8-sig',newline='') as h:rows=list(csv.DictReader(h,delimiter='\t'))
    by_reading={(r['词语'],r['拼音']):int(r['频序号']) for r in rows}
    with (directory/data['source']['name']).open(encoding='utf-8-sig',newline='') as h:original={int(r['学习序号']):r['原词频序号'] for r in csv.DictReader(h,delimiter='\t')}
    changes=[]
    for i in data['items']:
        if i['type'] not in {'char','word'}:continue
        readings=i['pinyin'].split(' / ') if i['type']=='char' else [i['pinyin']]
        ranks=[by_reading[(i['text'],py)] for py in readings if (i['text'],py) in by_reading]
        if not ranks:continue
        previous=original[i['id']]
        current=' / '.join(map(str,ranks))
        if [int(rank.strip()) for rank in previous.split('/') if rank.strip()]!=ranks:
            changes.append({'id':i['id'],'text':i['text'],'before':previous,'after':current})
        i['frequency']=min(ranks)
        if len(ranks)>1:i['sourceFrequency']=current
    target=directory/'sources/现代汉语常用词表_GitHub复核版.tsv';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(source.read_bytes())
    data['frequencySource']={'name':target.relative_to(directory).as_posix(),'sha256':sha(target),'policy':'Exact word and original reading match; original learning IDs retained.','changes':changes}

def supplements(data,divisions,root_codes):
    items=data['items'];chars={i['text']:i for i in items if i['type']=='char'}
    root_ids={i['text']:i['id'] for i in items if i['type']=='root'}
    forms=[];errors=[]
    for line in (ROOT/'upstream/output-simple-codes.txt').read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):continue
        text,code,*_=line.split()
        if text not in chars:continue
        base=chars[text]
        rule='one' if code.endswith('_') else 'fixed' if len(code)==1 else 'two' if len(code)==2 else 'three'
        roots=base['parts'][0]['rootCodes']
        expected=code if rule=='fixed' else roots[0][0]+'_' if rule=='one' else roots[0][0]+roots[1][0] if rule=='two' and len(roots)>1 else roots[0][:2]+roots[-1][1] if rule=='three' else ''
        if expected!=code:
            errors.append({'text':text,'code':code,'derived':expected});rule='assigned'
        forms.append({'id':1000000+ord(text)*8+{'fixed':0,'one':1,'two':2,'three':3,'assigned':4}[rule],
            'type':'short','text':text,'code':code,'baseId':base['id'],'baseCode':base['code'],'shortRule':rule,
            'commit':'space' if code.endswith('_') else 'auto','pinyin':base['pinyin'],'zhuyin':base.get('zhuyin',''),
            'readingSource':base.get('readingSource',''),'sourceType':'简码','sourceId':None,
            'frequency':base.get('frequency'),'dependencies':[base['id']],'parts':base['parts']})
    variants={}
    for text,base in chars.items():
        raw=divisions.get(text,{})
        if not raw.get('dt') or raw['dt']==raw.get('d'):continue
        glyphs=list(raw['dt'])
        if any(g not in root_codes for g in glyphs):continue
        codes=[root_codes[g] for g in glyphs]
        variants[text]={'char':text,'division':glyphs,'rootCodes':codes,'code':char_code(codes)}
    variants_items=[]
    if data['course']=='traditional':
        for text,part in variants.items():
            base=chars[text]
            variants_items.append({'id':30000000+ord(text),'type':'variant','text':text,'code':part['code'],
                'baseId':base['id'],'baseCode':base['code'],'glyphStandard':'taiwan','pinyin':base['pinyin'],
                'zhuyin':base.get('zhuyin',''),'readingSource':base.get('readingSource',''),'sourceType':'台湾兼容字形',
                'sourceId':None,'frequency':base.get('frequency'),
                'dependencies':list(dict.fromkeys([base['id']]+[root_ids[g] for g in part['division']])),'parts':[part]})
    extra=sorted(forms,key=lambda i:(i.get('frequency') or 10**9,i['id']))+sorted(variants_items,key=lambda i:(i.get('frequency') or 10**9,i['id']))
    for n,i in enumerate(extra,len(items)+1):i['order']=n
    data['transferItems']=extra
    data['glyphVariants']=variants
    data['transferStats']={'short':len(forms),'variant':len(variants_items)}
    data['teaching']={'version':'derivation-transfer-v1','divisionStandard':'d: official GTHJKV default; dt: optional Taiwan-compatible training.',
        'shortSource':{'revision':'55e783c3973b125d3f56baac534b796c76df87a5','sha256':sha(ROOT/'upstream/output-simple-codes.txt'),
                       'url':'https://shurufa.app/ime/xiaoming','ruleExceptions':errors},
        'glyphSource':{'sha256':sha(ROOT/'chaifen.json'),'url':'https://shurufa.app/learn/variation','fontFallbacks':[c for c in read(PROJECT/'dist/fonts/taiwan-font.json').get('fallbackCharacters',[]) if c in variants]},
        'practicePolicy':'Full-code foundation and two opt-in transfer tracks. Independent card IDs and FSRS; no automatic script conversion of shortcut assignments.'}

def coverage(data):
    items=data['items'];idx={i['id']:i for i in items};roots={i['text']:i for i in items if i['type']=='root'}
    uses={text:set() for text in roots}
    for i in items:
        if i['type'] in {'char','word'}:
            for p in i['parts']:
                for r in p['division']:uses[r].add(i['id'])
    for text,r in roots.items():
        ids=uses[text];cs=[idx[k] for k in ids if idx[k]['type']=='char']
        r.update({'coverageCount':len(ids),'characterCoverage':len(cs),'coverageScore':math.fsum(weight(idx[k]) for k in ids),
            'firstNeededSourceId':min(cs,key=lambda i:i['order'])['sourceId'] if cs else None})
        if not r.get('examples'):r['exampleNote']='官方拆分中暂无合适的构字例字，先按字根本形与 ASB 记忆。'
    for f in items:
        if f['type'] not in {'initial','stroke'}:continue
        affected=[r for r in roots.values() if (r['mapping']['initial']==f['initial'] if f['type']=='initial' else r['mapping']['strokeKey']==f['strokeKey'])]
        ids=set().union(*(uses[r['text']] for r in affected));cs=[idx[k] for k in ids if idx[k]['type']=='char']
        f.update({'coverageCount':len(ids),'coverageScore':math.fsum(weight(idx[k]) for k in ids),'rootCount':len(affected),
            'firstNeededSourceId':min(cs,key=lambda i:i['order'])['sourceId'] if cs else None})

def tables(directory,data):
    index={i['id']:i for i in data['items']}
    for name in [data['downloads']['curriculum'],'coverage.tsv']:
        p=directory/name
        with p.open(encoding='utf-8-sig',newline='') as h:r=csv.DictReader(h,delimiter='\t');fields=r.fieldnames;rows=list(r)
        by_id={int(row['ID'] if 'ID' in row else row['学习ID']):row for row in rows}
        rows=[by_id[i['id']] for i in data['items']]
        for i,row in zip(data['items'],rows):
            row['order' if 'order' in row else '课程顺序']=i['order']
        with p.open('w',encoding='utf-8-sig',newline='') as h:w=csv.DictWriter(h,fields,delimiter='\t',lineterminator='\n');w.writeheader();w.writerows(rows)

def compact(data):
    runtime={k:v for k,v in data.items() if k not in {'items','transferItems','provenance','legacyProvenance','curation'}}
    shared={}
    for i in data['items']:
        if i['type'] in {'char','word'}:
            for p in i['parts']:shared[p['char']]=p
    runtime.update({'runtimeFormat':'shared-parts-v1','partsByCharacter':shared})
    for key in ['items','transferItems']:
        runtime[key]=[{k:v for k,v in i.items() if k not in {'parts','sourceType','sourceFrequency','frequency','coverageScore','firstNeededSourceId','characterCoverage','rootCount'}} | ({'parts':i['parts']} if i['type']=='variant' else {}) for i in data.get(key,[])]
    return runtime

def run(course=None):
    started=time.monotonic();divisions=read(ROOT/'chaifen.json')
    with (ROOT/'zigen-xiaoming.csv').open(encoding='utf-8-sig',newline='') as h:root_codes={r['font']:r['ma'] for r in csv.DictReader(h)}
    for name in ([course] if course else ['simplified','traditional']):
        directory=PROJECT/'dist/data'/('traditional' if name=='traditional' else '')
        data=read(directory/'learning.json');meta=read(directory/'metadata.json')
        data['course']=name
        data.setdefault('language','zh-Hant' if name=='traditional' else 'zh-Hans')
        data.setdefault('downloads',{key:meta['downloads'][key]['name'] for key in ['curriculum','original']})
        if not data.get('lessonVersion'):
            from prepare_lessons import enrich_lessons
            enrich_lessons(data,divisions)
        if any(not item.get('zhuyin') for item in data['items'] if item['type'] in {'char','word'} and item.get('code')):
            from pronunciations import enrich
            meta['readingCounts']=enrich(data)
        seed=directory/'sources/order-v5.json'
        if seed.exists():
            ids=read(seed);index={i['id']:i for i in data['items']};data['items']=[index[k] for k in ids]
        else:write(seed,[i['id'] for i in data['items']])
        for pos,item in enumerate(data['items'],1):item['order']=pos
        if name=='simplified':latest_frequencies(data,directory)
        print('Optimizing',name,flush=True)
        data['items'],report=optimize(data['items'])
        coverage(data);supplements(data,divisions,root_codes)
        data['curriculum'].update({'algorithm':'shared-full-prerequisite-dag-v1',
            'ranking':'Common full-DAG density candidates and exact 8-lesson/4-pass DP; includes mapping/root costs and canonical aliases.',
            'rootWeighting':'Sum reciprocal lexical ranks of active downstream vocabulary; same definition for both courses.',
            'sourceOrderPolicy':'Original identities retained; all lesson positions optimized with a shared full prerequisite DAG.',
            'optimization':report,'tableColumns':{**data['curriculum']['tableColumns'],'order':f"课程实际位置（连续 1..{len(data['items'])}）"}})
        data['curriculumVersion']='full-dag-transfer-v6'
        write(directory/'learning.json',data);write(directory/'learning-runtime.json',compact(data))
        tables(directory,data)
        meta.update({'curriculum':data['curriculum'],'curriculumVersion':data['curriculumVersion'],
            'frequencySource':data.get('frequencySource'),'frequencyPolicy':'Exact lexical source rank; original identities retained, positions optimized by the common full DAG.',
            'transferStats':data['transferStats'],'teaching':data['teaching'],
            'learningBytes':(directory/'learning.json').stat().st_size,'learningSha256':sha(directory/'learning.json'),
            'runtime':{'name':'learning-runtime.json','bytes':(directory/'learning-runtime.json').stat().st_size,'sha256':sha(directory/'learning-runtime.json')}})
        meta['downloads']['curriculum'].update({'sha256':sha(directory/data['downloads']['curriculum']),'rows':len(data['items'])})
        write(directory/'metadata.json',meta)
        out=PROJECT/'artifacts/learning-v6-20261024';write(out/(name+'-optimization.json'),report)
        print(name,report['chosen'],report['selected'],data['transferStats'],'runtime bytes',meta['runtime']['bytes'],flush=True)
    print('elapsed',round(time.monotonic()-started,2),flush=True)

def build_and_validate(course=None):
    import subprocess
    run(course)
    subprocess.run(['node',str(PROJECT/'scripts/export_study.mjs')],check=True,cwd=PROJECT)
    subprocess.run(['node',str(PROJECT/'scripts/validate_curricula.mjs')],check=True,cwd=PROJECT)

if __name__=='__main__':
    build_and_validate(sys.argv[1] if len(sys.argv)>1 else None)
