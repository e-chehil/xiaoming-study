import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCourse} from './support/course.mjs';
import {encodingSteps} from '../public/encoding.mjs';
import {validateBackup} from '../public/engine.mjs';
const sc=await loadCourse('simplified'),tc=await loadCourse('traditional');
test('official worked examples retain their complete answers',()=>{
  for(const [text,code]of Object.entries({'好':'ckgi','做':'wjnqj','靈':'qdaav','中國':'aktsh','一人':'hdvj','新中國':'qktsh','哭哭啼啼':'ajavv'})){
    const parts=[...text].map(char=>tc.partsByCharacter[char]);assert.ok(parts.every(Boolean),text);
    const item={type:[...text].length===1?'char':'word',code,parts};assert.equal(encodingSteps(item).map(s=>s.letter).join(''),code,text);
  }
});
test('both scripts retain paired readings and distinguish inferred readings',()=>{
  for(const data of [sc,tc])for(const item of data.items)if(item.code&&['char','word'].includes(item.type)){assert.ok(item.zhuyin,item.text);assert.ok(item.pinyin||item.displayPinyin,item.text);assert.ok(item.readingSource,item.text);}
  const bank=tc.items.find(i=>i.type==='word'&&i.text==='銀行');assert.equal(bank.pinyin,'yínháng');assert.match(bank.zhuyin,/ㄏㄤˊ/);assert.equal(bank.readingSource,'naer');
  assert.ok(tc.items.some(i=>i.readingSource==='inferred'));assert.ok(tc.items.some(i=>i.readingSource==='moe'));
});
test('a valid simplified backup cannot replace traditional progress',()=>{
  const payload={app:'xiaoming-study',version:3,lessonVersion:sc.lessonVersion,course:'simplified',datasetSha:sc.source.sha256,cards:[],logs:[],daily:[],settings:{}};
  assert.doesNotThrow(()=>validateBackup(payload,sc.items,sc.source.sha256,'simplified'));
  assert.throws(()=>validateBackup(payload,tc.items,tc.source.sha256,'traditional'));
});
