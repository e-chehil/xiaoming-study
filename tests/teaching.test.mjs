import {loadCourse} from './support/course.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {validateCourse,allLessons,practicePool} from '../public/lesson-data.mjs';
import {encodingSteps,displayCode} from '../public/encoding.mjs';
import {derivation,stepBasis,explanationMarkup} from '../public/teaching.mjs';
import {pickNext,applyRating,validateBackup} from '../public/engine.mjs';
import {exposesAnswer} from '../public/answer-exposure.mjs';
const sc=await loadCourse('simplified'),tc=await loadCourse('traditional');
test('all full, short and Taiwan explanations produce exactly the graded answer',()=>{
  for(const data of [sc,tc]){
    validateCourse(data,{deep:true});
    const roots=new Map(data.items.filter(i=>i.type==='root').map(i=>[i.text,i]));
    for(const item of allLessons(data))if(item.code){
      const process=derivation(item,roots);assert.equal(process.steps.map(s=>s.letter).join(''),item.code,item.text);
      assert.ok(process.steps.every(step=>step.basis));
    }
    assert.ok(data.transferItems.every(i=>i.id!==i.baseId));
  }
  const one=sc.transferItems.find(i=>i.text==='一'&&i.type==='short');
  assert.equal(one.code,'h_');assert.equal(displayCode(one),'H␣');assert.equal(encodingSteps(one)[1].role,'commit');
  const fixed=sc.transferItems.find(i=>i.text==='的'&&i.type==='short');
  assert.equal(fixed.code,'d');assert.equal(encodingSteps(fixed)[0].role,'key');
  const roots=new Map(sc.items.filter(i=>i.type==='root').map(i=>[i.text,i]));
  const good=sc.items.find(i=>i.type==='char'&&i.text==='好');
  assert.match(stepBasis(good,1,roots),/n.*k/);assert.match(explanationMarkup(good,roots),/unused/);
});
test('transfer tracks have complete prerequisites, separate identities and current backup support',()=>{
  for(const data of [sc,tc]){
    for(const mode of ['short','variant']){
      const pool=practicePool(data,mode),ids=new Set(pool.map(i=>i.id));
      for(const item of pool)for(const dep of item.dependencies)assert.ok(ids.has(dep));
    }
    const short=data.transferItems.find(i=>i.type==='short'),base=data.items.find(i=>i.id===short.baseId);
    assert.ok(exposesAnswer(base,short));
    const card={...applyRating(null,3).card,id:short.id,answerCode:short.code,verified:true};
    const backup={app:'xiaoming-study',version:3,lessonVersion:data.lessonVersion,course:data.course,datasetSha:data.source.sha256,cards:[card],logs:[],daily:[],settings:{}};
    assert.doesNotThrow(()=>validateBackup(backup,allLessons(data),data.source.sha256,data.course));
    assert.throws(()=>validateBackup({...backup,cards:[{...card,answerCode:'wrong'}]},allLessons(data),data.source.sha256,data.course));
  }
  assert.equal(tc.transferStats.variant,455);
  const rise=tc.transferItems.find(i=>i.type==='variant'&&i.text==='起');
  assert.notEqual(rise.code,rise.baseCode);assert.deepEqual(rise.parts[0].division,['走','巳']);
});
test('a waiting nested foundation cannot be bypassed by scheduling its unverified root',()=>{
  const now=new Date('2026-10-24T00:00:00Z'),due=new Date(+now+60000).toISOString();
  const lessons=[{id:1,type:'initial',code:'e',dependencies:[]},{id:2,type:'root',code:'nef',dependencies:[1]},{id:3,type:'char',code:'abcd',dependencies:[2]}].map((item,i)=>({...item,order:i+1}));
  const cards={1:{...applyRating(null,1,now).card,id:1,verified:false,holdUntilDue:true,due},2:{...applyRating(null,1,now).card,id:2,verified:false,holdUntilDue:false,due}};
  const selected=pickNext(lessons,cards,{now});
  assert.equal(selected,null);
});
test('shared DAG local optimization is exact on a small graph and aliases cost once',()=>{
  execFileSync('python',['-c',String.raw`import sys,itertools,math
sys.path.insert(0,'scripts')
from curriculum_order import Graph
items=[{'id':1,'type':'stroke','code':'k','dependencies':[]},{'id':2,'type':'root','code':'hdk','dependencies':[1]},{'id':3,'type':'char','code':'hdk','practiceAlias':2,'frequency':1,'dependencies':[2]},{'id':4,'type':'char','code':'abcd','frequency':4,'dependencies':[2]},{'id':5,'type':'word','code':'abcde','frequency':2,'dependencies':[3,4]}]
g=Graph(items);order=g.normalize([5]);answer=g.exact_block(order)
valid=[]
for seq in itertools.permutations(g.items):
 try:g.audit(seq)
 except AssertionError:continue
 valid.append(g.evaluate(seq)['weightedLessons'])
assert math.isclose(g.evaluate(answer)['weightedLessons'],min(valid))
assert len(g.items)==4 and g.weights[2]==1
g.audit(g.density())
`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
});


test('runtime validation rejects omitted structural prerequisites and duplicate lesson IDs',()=>{
  const target=sc.items.find(i=>i.type==='char'&&!i.practiceAlias&&i.dependencies.length>1);
  const missing={...sc,allItems:undefined,items:sc.items.map(i=>i===target?{...i,dependencies:[]}:i)};
  assert.throws(()=>validateCourse(missing),/前置与实际拆分/);
  const duplicate={...sc,allItems:undefined,items:sc.items.map((item,i)=>i===1?{...item,id:sc.items[0].id}:item)};
  assert.throws(()=>validateCourse(duplicate),/字段不完整/);
  const one=sc.transferItems.find(item=>item.commit==='space'),badCommit={...sc,allItems:undefined,transferItems:sc.transferItems.map(item=>item===one?{...item,commit:'auto'}:item)};
  assert.throws(()=>validateCourse(badCommit),/上屏键不一致/);
});
