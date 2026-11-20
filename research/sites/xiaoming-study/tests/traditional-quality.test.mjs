import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {applyRating,pickContinuous,validateBackup} from '../dist/engine.mjs';
import {displayCode} from '../dist/encoding.mjs';
import {createHash} from 'node:crypto';
const archive=JSON.parse(await readFile(new URL('../dist/data/traditional/archive/retired-items.json',import.meta.url),'utf8'));
const tc=JSON.parse(await readFile(new URL('../dist/data/traditional/learning.json',import.meta.url),'utf8'));
const active=(text,type='word')=>tc.items.find(item=>item.text===text&&item.type===type);

test('rare repeated corpus strings are archived, legitimate repeated headwords remain later',()=>{
  for(const [text,rank]of [['一一一',70841],['一一一一',140632]]){
    assert.equal(active(text),undefined);
    assert.ok(archive.some(item=>item.text===text&&item.frequency===rank));
  }
  assert.equal(active('一一').frequency,3170);assert.ok(active('一一').order>1000);
  assert.equal(active('在在').readingSource,'naer');assert.ok(active('在在').order>5000);
  assert.equal(tc.items.slice(0,300).filter(item=>item.type==='word'&&item.frequency>10000).length,0);
  assert.ok(active('學習').order<1200);assert.ok(active('臺灣').order<2000);
  for(const word of ['螢幕','滑鼠','台積電'])assert.ok(active(word),word);
});

test('course sizes are comparable and English coverage is measured over the selected course',async()=>{
  const sc=JSON.parse(await readFile(new URL('../dist/data/learning.json',import.meta.url),'utf8'));
  assert.ok(tc.stats.words/sc.stats.words>.85&&tc.stats.words/sc.stats.words<1.15);
  assert.ok(tc.stats.characters/sc.stats.characters<1.15);
  const coverage=JSON.parse(await readFile(new URL('../dist/data/cedict/coverage.json',import.meta.url),'utf8'));
  assert.equal(coverage.courses.traditional.total,tc.stats.characters+tc.stats.words);
  assert.equal(coverage.courses.traditional.matched,48750);
});

test('word selection preserves graded items without mistaking dictionary absence for meaningless text',()=>{
  execFileSync('python',['-c',String.raw`import sys
sys.path.insert(0,'scripts')
from curate_traditional import selection
assert selection('在在',{'L':'0'}, {'在在'}, {}, set())[0]
assert selection('一一',{'L':'33.12'}, set(), {'一一':{}}, set())[0]
assert not selection('一一一',{'L':'0.2835'}, set(), {}, set())[0]
assert not selection('一一一一',{'L':'0.0385'}, set(), {}, set())[0]
assert selection('螢幕',{'L':'.2'}, set(), {}, {'螢幕'})[0]
assert not selection('螢幕',{'L':'.1999'}, set(), {}, {'螢幕'})[0]
assert not selection('沒(有)用',{'L':'0'}, {'沒(有)用'}, {}, set())[0]`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
});

test('archived source records are absent from the active runtime and current backups',()=>{
  assert.equal(tc.retiredItems,undefined);
  const retired=archive.find(item=>item.text==='一一一');
  const card={...applyRating(null,3).card,id:retired.id,verified:true};
  const backup={app:'xiaoming-study',version:3,lessonVersion:'root-foundations-v5',course:'traditional',datasetSha:tc.source.sha256,cards:[card],logs:[],daily:[],settings:{}};
  assert.throws(()=>validateBackup(backup,tc.items,tc.source.sha256,'traditional'));
});
test('a ready low-frequency word can be deferred by the actual SC mixed-step algorithm',()=>{
  execFileSync('python',['-c',String.raw`import sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd().parents[1]/'learning_order'))
from build_learning_order import Corpus
from build_step_order import density_order,audit
c=Corpus([{'rank':r,'word':w,'pinyin':''} for r,w in [(1,'一'),(2,'人'),(3,'好'),(70841,'一一一')]])
jobs=density_order(c);audit(c,jobs)
words=[c.entries[i]['word'] for kind,i in jobs if kind]
assert words==['一','人','好','一一一'], words`],{encoding:'utf8'});
});

test('the rebuilt downloadable curriculum agrees with the active runtime and metadata',async()=>{
  const metadata=JSON.parse(await readFile(new URL('../dist/data/traditional/metadata.json',import.meta.url),'utf8'));
  const raw=await readFile(new URL('../dist/data/traditional/'+tc.downloads.curriculum,import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),metadata.downloads.curriculum.sha256);
  const [header,...lines]=raw.toString('utf8').replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/),fields=header.split('\t');
  assert.equal(lines.length,tc.items.length);
  lines.forEach((line,position)=>{
    const values=line.split('\t'),row=Object.fromEntries(fields.map((field,index)=>[field,values[index]||''])),item=tc.items[position];
    assert.equal(Number(row.ID),item.id);assert.equal(Number(row.order),position+1);
    assert.equal(row.displayCode,displayCode(item,item.code));
    assert.equal(row.zhuyin,item.zhuyin||'');assert.equal(row.readingSource,item.readingSource||'');
  });
  const dataset=await readFile(new URL('../dist/data/traditional/learning.json',import.meta.url));
  assert.equal(createHash('sha256').update(dataset).digest('hex'),metadata.learningSha256);
  assert.equal(metadata.downloads.curriculum.rows,tc.stats.total);
});
