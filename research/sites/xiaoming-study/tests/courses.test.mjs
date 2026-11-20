import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {encodingSteps} from '../dist/encoding.mjs';
import {validateBackup} from '../dist/engine.mjs';
const sc=JSON.parse(await readFile(new URL('../dist/data/learning.json',import.meta.url),'utf8'));
const retired=JSON.parse(await readFile(new URL('../dist/data/traditional/archive/retired-items.json',import.meta.url),'utf8'));
const tc=JSON.parse(await readFile(new URL('../dist/data/traditional/learning.json',import.meta.url),'utf8'));

test('traditional active course is curated while every original identity remains archived or active',async()=>{
  assert.deepEqual(tc.stats,{total:56409,roots:397,characters:5512,words:50473,unsupported:0,initials:21,strokes:6});
  const index=new Map(tc.items.map(item=>[item.id,item]));
  assert.equal(index.size,tc.stats.total);
  const frequencies=new Set();
  for(const [position,item]of tc.items.entries()){
    assert.equal(item.order,position+1);
    if(item.frequency)frequencies.add(item.frequency);
    for(const id of item.dependencies){
      assert.ok(index.get(id).order<item.order);
      if(['word','char'].includes(item.type))assert.equal(index.get(id).type,item.type==='word'?'char':'root');
    }
    if(item.code)assert.equal(encodingSteps(item).map(step=>step.letter).join(''),item.code,item.text);
  }
  for(const item of retired)if(item.frequency)frequencies.add(item.frequency);
  for(let rank=1;rank<=163701;rank++)assert.ok(frequencies.has(rank),String(rank));
  assert.equal(frequencies.size,163746);
  const allIds=[...tc.items,...retired].map(item=>item.id);
  assert.equal(allIds.length,164820);assert.equal(new Set(allIds).size,allIds.length);
  assert.equal(retired.length,108411);
  assert.ok(tc.curation.algorithm.includes('mixed-step'));
  assert.equal(tc.curation.minimumMeanPpm,.2);
  const source=await readFile(new URL('../dist/data/traditional/完整繁中字詞學習表.tsv',import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'),tc.source.sha256);
  assert.ok(tc.provenance.optimizedObjective<tc.provenance.baselineObjective);
});

test('both courses have paired readings, with source and inferred readings distinguishable',()=>{
  for(const data of [sc,tc])for(const item of data.items){
    if(!item.code||!['char','word'].includes(item.type))continue;
    assert.ok(item.zhuyin,item.text);assert.ok(item.displayPinyin||item.pinyin,item.text);
    assert.ok(item.readingSource,item.text);
  }
  const bank=tc.items.find(item=>item.text==='銀行'&&item.type==='word');
  assert.equal(bank.pinyin,'yínháng');assert.match(bank.zhuyin,/ㄏㄤˊ/);assert.equal(bank.readingSource,'naer');
  const heart=sc.items.find(item=>item.text==='心肝');assert.equal(heart.pinyin,'xīngān');assert.equal(heart.zhuyin,'ㄒㄧㄣ ㄍㄢ');
  assert.ok(tc.items.some(item=>item.readingSource==='inferred'));
  assert.ok(tc.items.some(item=>item.readingSource==='moe'));
  assert.equal(tc.items.find(item=>item.text==='好'&&item.type==='char').level,'第1級');
  assert.equal(tc.items.filter(item=>item.type==='root'&&!item.pinyin).length,175);
});

test('current backups are isolated by course and revision',()=>{
  const backup={app:'xiaoming-study',version:3,lessonVersion:'root-foundations-v5',course:'simplified',datasetSha:sc.source.sha256,cards:[],logs:[],daily:[],settings:{}};
  assert.doesNotThrow(()=>validateBackup(backup,sc.items,sc.source.sha256));
  assert.throws(()=>validateBackup(backup,tc.items,tc.source.sha256,'traditional'));
  const traditional={...backup,version:3,course:'traditional',datasetSha:tc.source.sha256};
  assert.doesNotThrow(()=>validateBackup(traditional,tc.items,tc.source.sha256,'traditional'));
  assert.throws(()=>validateBackup({...traditional,datasetSha:sc.source.sha256},sc.items,sc.source.sha256));
});
