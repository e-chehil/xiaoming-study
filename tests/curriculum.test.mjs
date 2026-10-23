import {loadCourse} from './support/course.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {applyRating,pickNext,typingGrade,validateBackup,itemIndex,dayKey,cleanSettings,cardFor} from '../public/engine.mjs';
import {encodingSteps} from '../public/encoding.mjs';
const data=await loadCourse('simplified');
const index=itemIndex(data.items),now=new Date('2026-10-22T08:00:00Z');
test('mapping-root-character-word graph preserves source IDs and complete prerequisites',async()=>{
  assert.deepEqual(data.stats,{total:59192,roots:397,characters:5069,words:53699,unsupported:22,initials:21,strokes:6});
  assert.equal(index.size,59192);
  assert.deepEqual(data.items.filter(i=>i.sourceId!==null).map(i=>i.id).sort((a,b)=>a-b),Array.from({length:58768},(_,i)=>i+1));
  for(const [pos,item]of data.items.entries()){
    assert.equal(item.order,pos+1);
    for(const dep of item.dependencies){assert.ok(index.get(dep).order<item.order);if(item.type==='char'||item.type==='word')assert.equal(index.get(dep).type,item.type==='char'?'root':'char');}
    if(item.type==='root'){assert.ok(item.id>58768);assert.equal(item.code.length,3);assert.equal(item.fullCode.length,3);assert.equal(item.dependencies.length,item.pinyin?2:1);}
  }
  assert.equal(data.items.filter(i=>i.extension).length,57);
  assert.match(data.source.sha256,/^[a-f0-9]{64}$/);
  assert.ok((await stat(new URL('../public/data/learning-runtime.json',import.meta.url))).size<16*1024*1024);
});
test('recognition never counts as recall, all help maps to Again',()=>{
  for(const metrics of [{firstExposure:true},{revealed:true},{hints:1},{mistakes:1},{pasted:true}]){
    const result=typingGrade({...metrics,elapsedMs:100,codeLength:3},null,[]);
    assert.equal(result.grade,1);assert.equal(result.verified,false);
  }
});
test('every selected keystroke keeps its exact ASB role across the entire curriculum',()=>{
  let covered=0;
  for(const item of data.items){if(!item.code)continue;const steps=encodingSteps(item);assert.equal(steps.map(s=>s.letter).join(''),item.code,item.text);for(const step of steps){assert.ok(['a','s','b'].includes(step.role));if(item.parts.length)assert.equal(step.letter,item.parts[step.charIndex].rootCodes[step.rootIndex][{a:0,s:1,b:2}[step.role]]);}covered++;}
  assert.equal(covered,59170);
  assert.deepEqual(encodingSteps(data.items.find(i=>i.type==='root')).map(s=>s.role),['a','s','b']);
  assert.deepEqual(encodingSteps(data.items.find(i=>i.type==='char'&&i.text==='的')).map(s=>s.role),['a','s','a','a','s']);
});
test('wrong and empty submissions are failed even on first exposure',()=>{
  assert.deepEqual(typingGrade({firstExposure:true,correct:false,mistakes:1},null).basis,'failed');
  assert.equal(typingGrade({firstExposure:true,blank:true,correct:false},null).grade,1);
  assert.equal(typingGrade({correct:false,elapsedMs:100}, {verified:true,cleanRecalls:5}).verified,false);
});
test('failed foundations wait until due while continuous selection can introduce other mapping lessons',()=>{
  const first=data.items[0],card={...applyRating(null,1,now).card,id:first.id,verified:false,holdUntilDue:true};
  assert.equal(pickNext([first],{[first.id]:card},{now,newLimit:200}),null);
  const later=pickNext([first],{[first.id]:card},{now:new Date(now.getTime()+61000)});
  assert.equal(later.item.id,first.id);assert.equal(later.early,false);
});
test('effort and speed drive grades with a conservative fluent gate',()=>{
  assert.equal(typingGrade({elapsedMs:1500,codeLength:5},null).grade,3);
  assert.equal(typingGrade({elapsedMs:100,codeLength:5,backspaces:1},null).grade,2);
  assert.equal(typingGrade({elapsedMs:30000,codeLength:5},null).grade,2);
  assert.equal(typingGrade({elapsedMs:100,codeLength:5},{verified:true,cleanRecalls:1}).grade,3);
  assert.equal(typingGrade({elapsedMs:1000,codeLength:5},{verified:true,cleanRecalls:2}).grade,4);
  const samples=Array.from({length:7},()=>({automatic:true,elapsedMs:2500,codeLength:5}));
  assert.equal(typingGrade({elapsedMs:1500,codeLength:5},null,samples).pace,500);
});
test('copying a mapping does not unlock its dependent root',()=>{
  const first=data.items[0],cards={[first.id]:{...applyRating(null,1,now).card,id:first.id,verified:false}};
  const selected=pickNext(data.items,cards,{now,newLimit:200});
  assert.ok(['initial','stroke'].includes(selected.item.type));assert.notEqual(selected.item.type,'root');
});
test('first word can only appear after all its characters and roots are verified',()=>{
  const cards={};let seenWord=false,iterations=0;
  while(iterations++<350){
    const selected=pickNext(data.items,cards,{now,newLimit:1000});assert.ok(selected);
    for(const dependency of selected.item.dependencies)assert.equal(cardFor(cards,index.get(dependency))?.verified,true,`${selected.item.text} prerequisite ${dependency}`);
    if(selected.item.type==='word'){seenWord=true;break;}
    const old=cards[selected.item.id];cards[selected.item.id]={...applyRating(old,old?3:1,now).card,id:selected.item.id,verified:!!old};
  }
  assert.ok(seenWord);
});
test('daily cap still permits independent foundation practice',()=>{
  const first=data.items[0],card={...applyRating(null,1,now).card,id:first.id,verified:false};
  assert.equal(pickNext(data.items,{[first.id]:card},{now,newLimit:1,newToday:1}).item.id,first.id);
  card.verified=true;assert.equal(pickNext(data.items,{[first.id]:card},{now,newLimit:1,newToday:1}),null);
});
test('current backups round-trip; obsolete versions are rejected',()=>{
  const card={...applyRating(null,3,new Date(now-86400000)).card,id:1,verified:true};
  const backup={app:'xiaoming-study',version:3,lessonVersion:'root-foundations-v5',course:'simplified',datasetSha:data.source.sha256,cards:[card],logs:[],daily:[],settings:{}};
  assert.equal(validateBackup(backup,data.items,data.source.sha256).cards[0].id,1);
  assert.throws(()=>validateBackup({...backup,version:2},data.items,data.source.sha256));
  assert.throws(()=>validateBackup({...backup,cards:[card,card]},data.items,data.source.sha256));
  assert.throws(()=>validateBackup({...backup,cards:[{...card,due:'invalid'}]},data.items,data.source.sha256));
});
test('real FSRS dates persist and local days remain calendar based',()=>{
  for(const grade of [1,2,3,4]){const first=applyRating(null,grade,now);assert.ok(new Date(first.card.due)>now);const second=applyRating(JSON.parse(JSON.stringify(first.card)),3,new Date(first.card.due));assert.equal(second.card.reps,2);}
  assert.equal(dayKey(new Date(2026,9,22,0,1)),'2026-10-22');assert.equal(cleanSettings({newPerDay:1000}).newPerDay,200);
});
