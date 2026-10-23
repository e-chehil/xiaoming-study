import {loadCourse} from './support/course.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRating, pickContinuous, evaluateAttempt, typingGrade,cardFor as progressFor,createSelectionContext} from '../public/engine.mjs';

const data=await loadCourse('simplified');
const roots=data.items.filter(item=>item.type==='root').slice(0,3).map(item=>({...item,dependencies:[]}));
const course=[...roots,{...data.items.find(item=>item.text==='的'&&item.type==='char'),dependencies:roots.map(item=>item.id)},{...data.items.filter(item=>item.type==='root')[3],dependencies:[]}];
const now=new Date('2026-10-23T02:00:00Z');
const cardFor=(item,verified=false)=>({...applyRating(null,1,now).card,id:item.id,verified,cleanRecalls:0,holdUntilDue:!verified});
const metrics={correct:true,blank:false,firstExposure:false,elapsedMs:1200,codeLength:3,backspaces:0,hints:0};

test('blocked early characters never prevent introduction of other available roots',()=>{
  const cards=Object.fromEntries(roots.map(item=>[item.id,cardFor(item)]));
  const selected=pickContinuous(course,cards,{now,newToday:3,history:roots.map(item=>item.id)});
  assert.ok(selected);assert.equal(selected.item.type,'root');assert.equal(selected.isNew,true);
  assert.ok(!cards[selected.item.id]);assert.equal(selected.supplemental,false);
});

test('the daily goal keeps a continuous, rotating practice pool and still permits new content',()=>{
  const cards=Object.fromEntries(roots.map(item=>[item.id,cardFor(item,true)]));
  const snapshot=structuredClone(cards);
  const selected=pickContinuous(course,cards,{now,newToday:20,newLimit:20,history:[roots[0].id]});
  assert.ok(selected);assert.equal(selected.supplemental,true);assert.notEqual(selected.item.id,roots[0].id);
  assert.deepEqual(cards,snapshot);
  const later=pickContinuous(course,cards,{now,newToday:20,newLimit:20,
    history:Array.from({length:5},(_,i)=>({itemId:roots[i%3].id,wasNew:false}))});
  assert.equal(later.isNew,true);assert.equal(later.item.text,'的');
});

test('a goal reached with only waiting failures continues with other new roots',()=>{
  const cards=Object.fromEntries(roots.map(item=>[item.id,cardFor(item)]));
  const selected=pickContinuous(course,cards,{now,newToday:20,newLimit:20,history:roots.map(item=>item.id)});
  assert.ok(selected?.isNew);assert.equal(selected.item.type,'root');
});

test('newly due reviews take priority over every filler and new item',()=>{
  const cards=Object.fromEntries(roots.map(item=>[item.id,cardFor(item,true)]));
  cards[roots[1].id].due=new Date(now.getTime()-1000).toISOString();
  const selected=pickContinuous(course,cards,{now,history:[roots[1].id]});
  assert.equal(selected.item.id,roots[1].id);assert.equal(selected.supplemental,false);assert.equal(selected.early,false);
});

test('a complete curriculum keeps rotating without adjacent repeats',()=>{
  const cards=Object.fromEntries(roots.map(item=>[item.id,cardFor(item,true)])),history=[];
  for(let i=0;i<30;i++){
    const selected=pickContinuous(roots,cards,{now,history});
    assert.ok(selected?.supplemental);assert.notEqual(selected.item.id,history.at(-1)?.itemId);
    history.push({itemId:selected.item.id,wasNew:false});
  }
  assert.equal(new Set(history.map(log=>log.itemId)).size,3);
});

test('successful extra recall unlocks prerequisites without extending or inflating FSRS state',()=>{
  const before={...cardFor(roots[0]),holdUntilDue:false};
  const snapshot=structuredClone(before);
  const result=evaluateAttempt(before,metrics,[],{now:new Date(now.getTime()+10000),supplemental:true});
  assert.equal(result.scheduleUpdated,false);assert.equal(result.card.verified,true);
  for(const field of ['due','stability','difficulty','reps','lapses','last_review','cleanRecalls'])assert.equal(result.card[field],before[field],field);
  assert.deepEqual(before,snapshot);
});

test('a failed or assisted extra recall immediately schedules real relearning',()=>{
  const before={...cardFor(roots[0],true),due:new Date(now.getTime()+86400000).toISOString()};
  for(const attempt of [{...metrics,correct:false,mistakes:1},{...metrics,hints:1},{...metrics,pasted:true}]){
    const result=evaluateAttempt(before,attempt,[],{now:new Date(now.getTime()+10000),supplemental:true});
    assert.equal(result.scheduleUpdated,true);assert.equal(result.assessment.grade,1);assert.equal(result.card.holdUntilDue,true);
    assert.equal(result.card.reps,before.reps+1);assert.ok(new Date(result.card.due)<new Date(before.due));
  }
});

test('an exhausted failed-only pool offers guided typing without mutating its FSRS due date',()=>{
  const before=cardFor(roots[0]);
  const selected=pickContinuous([roots[0]],{[before.id]:before},{now,reviewOnly:true,history:[before.id]});
  assert.equal(selected.guided,true);assert.equal(selected.supplemental,true);
  for(const attempt of [metrics,{...metrics,correct:false,mistakes:1}]){
    const result=evaluateAttempt(before,attempt,[],{now,supplemental:true,guided:true});
    assert.equal(result.scheduleUpdated,false);assert.equal(result.card.due,before.due);
    assert.equal(result.card.reps,before.reps);assert.equal(result.card.verified,false);
  }
});

test('continuous sessions keep prerequisites and prevent instant failed-item retries',()=>{
  const cards={},history=[];let newToday=0;
  for(let i=0;i<300;i++){
    const time=new Date(now.getTime()+i*900);
    const selected=pickContinuous(data.items,cards,{now:time,newLimit:5,newToday,history});
    assert.ok(selected?.item.code);
    for(const id of selected.item.dependencies)assert.equal(progressFor(cards,data.items.find(item=>item.id===id))?.verified,true);
    assert.notEqual(selected.item.id,history.at(-1)?.itemId);
    const firstExposure=!cards[selected.item.id],correct=i%9!==0;
    const result=evaluateAttempt(cards[selected.item.id],{...metrics,firstExposure,correct,mistakes:Number(!correct)},history,
      {now:time,supplemental:selected.supplemental,guided:selected.guided});
    cards[selected.item.id]={...result.card,id:selected.item.id};
    newToday+=Number(firstExposure);
    history.push({itemId:selected.item.id,wasNew:firstExposure,supplemental:selected.supplemental});
  }
  assert.ok(newToday>5);assert.ok(history.some(log=>log.supplemental));
  assert.ok(Object.keys(cards).some(id=>data.items.find(item=>item.id===Number(id)).type==='char'));
});

test('typing pace excludes short extra drills from its FSRS grading baseline',()=>{
  const result=typingGrade(metrics,null,Array.from({length:10},()=>({automatic:true,supplemental:true,elapsedMs:300,codeLength:3})));
  assert.equal(result.pace,800);
});
test('pasted and revealed answers cannot train the independent typing-speed baseline',()=>{
  for(const flags of [{pasted:true},{revealed:true}]){
    const history=Array.from({length:10},()=>({automatic:true,elapsedMs:300,codeLength:3,...flags}));
    assert.equal(typingGrade(metrics,null,history).pace,800);
  }
});

test('incremental scheduling preserves selection across new cards, verification changes and growing history',()=>{
  const cards={},history=[],context=createSelectionContext(data.items,cards,history);let newToday=0;
  for(let i=0;i<300;i++){
    const time=new Date(now.getTime()+i*900),options={now:time,newToday,newLimit:5,history};
    const expected=pickContinuous(data.items,cards,options),actual=pickContinuous(data.items,cards,{...options,context});
    assert.deepEqual(actual,expected,'step '+i);
    const firstExposure=!cards[actual.item.id],correct=i%9!==0;
    const result=evaluateAttempt(cards[actual.item.id],{...metrics,firstExposure,correct,mistakes:Number(!correct)},history,{now:time,supplemental:actual.supplemental,guided:actual.guided});
    const card={...result.card,id:actual.item.id},log={itemId:card.id,wasNew:firstExposure,supplemental:actual.supplemental};
    cards[card.id]=card;history.push(log);context.record(card,log);newToday+=Number(firstExposure);
  }
});
test('cached availability follows alias prerequisites and due dates without requiring another answer',()=>{
  const root={id:1,order:1,type:'root',text:'一',code:'hdk',dependencies:[]};
  const alias={id:2,order:2,type:'char',text:'一',code:'hdk',practiceAlias:1,dependencies:[1]};
  const word={id:3,order:3,type:'word',text:'一一',code:'hdhd',dependencies:[2]},items=[root,alias,word];
  const cards={1:{...cardFor(root,true),due:new Date(+now+1000).toISOString()}},history=[];
  const context=createSelectionContext(items,cards,history);
  assert.equal(pickContinuous(items,cards,{now,context,history}).item.id,3);
  assert.equal(pickContinuous(items,cards,{now:new Date(+now+1001),context,history}).item.id,1);
  cards[1]={...cards[1],verified:false,holdUntilDue:true,due:new Date(+now+60000).toISOString()};
  const log={itemId:1,wasNew:false};history.push(log);context.record(cards[1],log);
  const selected=pickContinuous(items,cards,{now,context,history});assert.equal(selected.item.id,1);assert.equal(selected.guided,true);
});

test('simple-code speed samples do not distort full-code grading',()=>{
  const logs=Array.from({length:8},()=>({skill:'short',automatic:true,elapsedMs:300,codeLength:1}));
  const core=typingGrade({skill:'core',elapsedMs:1500,codeLength:5},null,logs);
  const short=typingGrade({skill:'short',elapsedMs:300,codeLength:1},null,logs);
  assert.equal(core.pace,800);assert.equal(short.pace,300);
});
