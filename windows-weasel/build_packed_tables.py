from pathlib import Path
from collections import defaultdict
import argparse, hashlib, json
parser = argparse.ArgumentParser(description='Build sparse lookup indexes from your Rime data.')
parser.add_argument('profile', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
PROFILE = args.profile
OUT=args.output;OUT.mkdir(parents=True, exist_ok=True)
def write(name,rows):
    data=bytearray();index=[]
    for i,(key,value) in enumerate(sorted(rows.items(),key=lambda v:v[0].encode('utf8'))):
        if i%64==0:index.append(key+'\t'+str(len(data))+'\n')
        data.extend((key+'\t'+value+'\n').encode('utf8'))
    (OUT/(name+'.tsv')).write_bytes(data)
    (OUT/(name+'.idx')).write_text(''.join(index),encoding='utf8')
    return {'keys':len(rows),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
dictionary=(PROFILE/'xiaoming.dict.yaml').read_text(encoding='utf8').split('\n...\n',1)[1]
assert hashlib.sha256(dictionary.encode()).hexdigest()=='087b52c46cda87e86498d6cf4b5a1940e8f8db3e52c75dfdf9bec0d6900f01b3'
codes=defaultdict(list)
for line in dictionary.splitlines():
    word,code,*_=line.split('\t');codes[code].append(word)
result={'dictionary':write('dictionary',{k:' '.join(v) for k,v in codes.items()})}
for name in ('meta','readings','weights'):
    filename=name+('.idx' if name=='weights' else '.tsv')
    rows=dict(line.split('\t',1) for line in (PROFILE/'xm_yume'/filename).read_text(encoding='utf8').splitlines() if '\t' in line)
    result[name]=write(name,rows)
(OUT/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False,indent=2))
