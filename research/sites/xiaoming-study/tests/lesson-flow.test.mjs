import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pickNext,pickContinuous,applyRating} from '../dist/engine.mjs';
const divisions=JSON.parse((await readFile(new URL('../../../潇明码表/chaifen.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
for(const course of ['','traditional/']){
  const data=JSON.parse(await readFile(new URL('../dist/data/'+course+'learning.json',import.meta.url),'utf8'));
  const index=new Map(data.items.map(item=>[item.id,item])),roots=new Map(data.items.filter(item=>item.type==='root').map(item=>[item.text,item]));
  test(course+' example levels match the lesson hierarchy and contain no isolated stroke',()=>{
    const strokes=new Set('一丨丿丶乙乛亅㇐㇑㇒㇔㇜㇕');
    for(const item of data.items){
      if(!['root','stroke','initial'].includes(item.type))continue;
      assert.ok(item.examples.length<=3);if(item.type!=='root')assert.ok(item.examples.length>0);
      for(const example of item.examples){
        if(item.type==='root')assert.match(example.text,/^\p{Script=Han}$/u);else assert.equal(index.get(example.rootId).type,'root');
        if(item.type==='root'){assert.notEqual(example.text,item.text);assert.ok(divisions[example.text].d.includes(item.text),item.text+' '+example.text);}
        if(item.type==='stroke'){assert.ok(!strokes.has(example.text));assert.equal(roots.get(example.text).mapping.strokeKey,item.strokeKey);}
        if(item.type==='initial'){const letter=example.pinyin.normalize('NFD').replace(/\p{M}/gu,'')[0].toLowerCase();assert.equal(/[aeoiuv]/.test(letter)?'0':letter,item.initial);}
      }
    }
  });
  test(course+' identical character lessons share the complete ASB root without changing their identities',()=>{
    const aliases=data.items.filter(item=>item.practiceAlias);assert.equal(aliases.length,course?173:170);
    for(const item of aliases){const root=index.get(item.practiceAlias);assert.equal(root.text,item.text);assert.equal(root.code,item.code);assert.equal(root.code.length,3);assert.ok(root.order<item.order);}
  });
}
test('a verified shared root unlocks its word without a second character card or duplicate due review',()=>{
  const root={id:1,order:1,type:'root',text:'一',code:'hdk',dependencies:[]};
  const char={id:2,order:2,type:'char',text:'一',code:'hdk',practiceAlias:1,dependencies:[1]};
  const word={id:3,order:3,type:'word',text:'一一',code:'hdhd',dependencies:[2]};
  const now=new Date(),card={...applyRating(null,3,now).card,id:1,verified:true,due:new Date(now.getTime()+86400000).toISOString()};
  const cards={1:card,2:{...card,id:2,due:new Date(now.getTime()-1000).toISOString()}};
  assert.equal(pickNext([root,char,word],cards,{now}).item.id,3);
  assert.equal(pickContinuous([root,char,word],cards,{now}).item.id,3);
});
