import test from 'node:test';
import assert from 'node:assert/strict';
import {AnswerExposure,exposesAnswer} from '../public/answer-exposure.mjs';
import {typingGrade} from '../public/engine.mjs';
const root={id:1,type:'root',text:'女',code:'cke',parts:[{division:['女'],rootCodes:['cke']}]};
const alias={...root,id:2,type:'char',practiceAlias:1};
const char={id:3,type:'char',text:'好',code:'ckgi',parts:[{division:['女','子'],rootCodes:['cke','gid']}]};
test('answer lookups include shared character identities and roots supplying selected keystrokes',()=>{
  assert.equal(exposesAnswer(root,alias),true);
  assert.equal(exposesAnswer(char,root),true);
  assert.equal(exposesAnswer(root,{id:4,type:'root',text:'木',code:'vik'}),false);
  assert.equal(exposesAnswer(root,{id:5,type:'word',text:'女子',code:'ckgi'}),false);
});
test('lookup exposure survives reload, is isolated by course, and is consumed by a recorded attempt',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const first=new AnswerExposure(storage);first.remember('simplified',alias);
  const reloaded=new AnswerExposure(storage);
  assert.equal(reloaded.has('simplified',root),true);
  assert.equal(reloaded.has('traditional',root),false);
  const assessment=typingGrade({correct:true,revealed:reloaded.has('simplified',root),elapsedMs:1000});
  assert.equal(assessment.grade,1);assert.equal(assessment.verified,false);
  reloaded.consume('simplified',root);assert.equal(new AnswerExposure(storage).has('simplified',alias),false);
});
test('blocked browser storage does not erase exposure during the current session',()=>{
  const blocked=()=>{throw new Error('blocked');},exposure=new AnswerExposure({getItem:blocked,setItem:blocked,removeItem:blocked});
  exposure.remember('simplified',root);assert.equal(exposure.has('simplified',root),true);
  exposure.consume('simplified',root);assert.equal(exposure.has('simplified',root),false);
});
