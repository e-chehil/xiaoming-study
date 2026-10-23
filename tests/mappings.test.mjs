import {loadCourse} from './support/course.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodingSteps,fullEncodingSteps,displayCode} from '../public/encoding.mjs';
import {applyRating,validateBackup,pickContinuous,evaluateAttempt} from '../public/engine.mjs';

const data=await loadCourse('simplified');
const index=new Map(data.items.map(item=>[item.id,item])),roots=data.items.filter(item=>item.type==='root');
const initialKeys={0:'d',h:'d',y:'d',b:'e',s:'e',w:'e',d:'f',g:'f',t:'f',f:'i',m:'i',z:'i',l:'j',p:'j',q:'j',r:'j',x:'j',c:'k',j:'k',k:'k',n:'k'};

test('21 initial and six stroke lessons are distinct, without a rule lesson',()=>{
  const initials=data.items.filter(item=>item.type==='initial'),strokes=data.items.filter(item=>item.type==='stroke');
  assert.equal(initials.length,21);assert.equal(strokes.length,6);assert.equal(data.items.filter(item=>item.type==='rule').length,0);
  for(const lesson of initials)assert.equal(lesson.code,initialKeys[lesson.initial]);
  assert.deepEqual(initials.find(item=>item.initial==='z').aliases,['z','zh']);
  assert.deepEqual(initials.find(item=>item.initial==='c').aliases,['c','ch']);
  assert.deepEqual(initials.find(item=>item.initial==='s').aliases,['s','sh']);
  const shown={0:'零声母',b:'ㄅ',p:'ㄆ',m:'ㄇ',f:'ㄈ',d:'ㄉ',t:'ㄊ',n:'ㄋ',l:'ㄌ',g:'ㄍ',k:'ㄎ',h:'ㄏ',j:'ㄐ',q:'ㄑ',x:'ㄒ',z:'ㄗ/ㄓ',c:'ㄘ/ㄔ',s:'ㄙ/ㄕ',r:'ㄖ',y:'ㄧ/ㄩ',w:'ㄨ'};
  for(const lesson of initials)assert.equal(lesson.text,shown[lesson.initial]);
  assert.deepEqual(Object.fromEntries(strokes.map(item=>[item.strokeKey,item.text])),{k:'横',i:'竖',j:'撇',f:'点',e:'逆时针折',d:'顺时针折'});
  assert.deepEqual(Object.fromEntries(strokes.map(item=>[item.strokeKey,item.strokeGlyph])),{k:'㇐',i:'㇑',j:'㇒',f:'㇔',e:'㇜',d:'㇕'});
});

test('all 397 roots require the correct sound-or-silent rule and their own first stroke before full ASB',()=>{
  let sounded=0,silent=0,sameButSounded=0;
  for(const root of roots){
    assert.equal(root.code,root.fullCode);assert.equal(root.answerRole,undefined);assert.equal(root.parts[0].rootCodes[0],root.fullCode);
    const prerequisites=root.dependencies.map(id=>index.get(id));
    assert.equal(prerequisites.find(item=>item.type==='stroke').code,root.fullCode[2]);
    if(root.pinyin){
      sounded++;if(root.fullCode[1]===root.fullCode[2])sameButSounded++;
      const plain=root.pinyin.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase(),initial=/^[aeoiuv]/.test(plain)?'0':plain[0];
      assert.equal(root.mapping.initial,initial);assert.equal(prerequisites.find(item=>item.type==='initial').code,initialKeys[initial]);
      assert.equal(root.fullCode[1],initialKeys[initial]);assert.ok(!prerequisites.some(item=>item.type==='rule'));
    }else{
      silent++;assert.equal(root.fullCode[1],root.fullCode[2]);assert.equal(prerequisites.length,1);
    }
  }
  assert.equal(sounded,222);assert.equal(silent,175);assert.equal(sameButSounded,43);
  assert.equal(roots.find(item=>item.text==='目').mapping.initial,'m');
  assert.equal(roots.find(item=>item.text==='勹').mapping.smallSource,'stroke');
});

test('continuous learning cannot unlock full root ASB until both mapping prerequisites are independently recalled',()=>{
  const cards={},history=[],now=new Date();let firstRoot=false;
  for(let i=0;i<80;i++){
    const selected=pickContinuous(data.items,cards,{now,history,newLimit:200,newToday:Object.keys(cards).length});
    for(const dependency of selected.item.dependencies)assert.equal(cards[dependency]?.verified,true);
    if(selected.item.type==='root'){
      firstRoot=true;assert.equal(selected.item.code.length,3);assert.ok(i>3);
      assert.ok(selected.item.dependencies.every(id=>history.some(log=>log.itemId===id&&!log.firstExposure)));
      break;
    }
    const firstExposure=!cards[selected.item.id];
    const result=evaluateAttempt(cards[selected.item.id],{correct:true,firstExposure,elapsedMs:700,codeLength:1},history,{now,supplemental:selected.supplemental});
    cards[selected.item.id]={...result.card,id:selected.item.id};history.push({itemId:selected.item.id,wasNew:firstExposure,firstExposure});
  }
  assert.ok(firstRoot);
});
