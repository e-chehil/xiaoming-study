import {encodingSteps} from './encoding.mjs';
const BASE_TYPES=new Set(['initial','stroke','root','char','word']);
export const TRACKS=Object.freeze({core:'完整取码',short:'简码训练',variant:'台湾字形'});
export function allLessons(data){return data.allItems||(data.allItems=[...data.items,...(data.transferItems||[])]);}
export function hydrateCourse(data){
  if(data.runtimeFormat==='shared-parts-v1'){
    const shared=data.partsByCharacter;
    if(!shared||typeof shared!=='object')throw new Error('学习表缺少共享拆分');
    const parts=item=>item.parts||(['initial','stroke'].includes(item.type)?[]:item.type==='root'?[{char:item.text,division:[item.text],rootCodes:[item.fullCode],code:item.fullCode}]:[...item.text].map(char=>shared[char]));
    for(const item of [...data.items,...(data.transferItems||[])])item.parts=parts(item);
  }
  validateCourse(data);
  return data;
}
export function validateCourse(data,{deep=false}={}){
  if(data?.version!==3||!Array.isArray(data.items)||data.items.length!==data.stats?.total||!['simplified','traditional'].includes(data.course))throw new Error('学习表版本或项目数无效');
  const items=allLessons(data),index=new Map(),positions=new Map();
  for(const [position,item]of items.entries()){
    if(!Number.isSafeInteger(item.id)||item.id<=0||index.has(item.id)||!item.text||!Array.isArray(item.parts)||!Array.isArray(item.dependencies))throw new Error('学习项目字段不完整');
    if(position<data.items.length&&!BASE_TYPES.has(item.type)||position>=data.items.length&&!['short','variant'].includes(item.type))throw new Error('学习类型无效');
    if(item.order!==position+1)throw new Error('课程位置不连续');
    if(item.code!==null&&(typeof item.code!=='string'||!(/^[a-z]{1,5}_?$/.test(item.code))))throw new Error('编码字段无效');
    if(!item.code&&!item.unsupportedReason)throw new Error('缺少不可练原因');
    index.set(item.id,item);positions.set(item.id,position);
  }
  for(const item of items){
    if(new Set(item.dependencies).size!==item.dependencies.length||item.dependencies.some(id=>!positions.has(id)||positions.get(id)>=positions.get(item.id)))throw new Error('学习表前置缺失或存在循环');
    if(item.practiceAlias){const root=index.get(item.practiceAlias);if(item.type!=='char'||root?.type!=='root'||root.text!==item.text||root.code!==item.code)throw new Error('共用练习身份无效');}
    if(['short','variant'].includes(item.type)&&(!index.has(item.baseId)||!item.dependencies.includes(item.baseId)))throw new Error('迁移课缺少完整取码前置');
    for(const part of item.parts){if(!part||part.division.length!==part.rootCodes.length)throw new Error('字根拆分不完整');
      if(deep&&part.rootCodes.length&&encodingSteps({type:'char',code:'x',parts:[part]}).map(step=>step.letter).join('')!==part.code)throw new Error('汉字部分编码无效：'+part.char);
    }
    if(deep&&item.code&&encodingSteps(item).map(step=>step.letter).join('')!==item.code)throw new Error('解释与实际编码不符：'+item.text);
  }

  const roots=new Map(items.filter(item=>item.type==='root').map(item=>[item.text,item]));
  const chars=new Map(data.items.filter(item=>item.type==='char').map(item=>[item.text,item]));
  const initials=new Map(data.items.filter(item=>item.type==='initial').map(item=>[item.initial,item]));
  const strokes=new Map(data.items.filter(item=>item.type==='stroke').map(item=>[item.strokeKey,item]));
  for(const item of items){
    let expected;
    if(item.type==='root')expected=[...(item.mapping.smallSource==='initial'?[initials.get(item.mapping.initial)?.id]:[]),strokes.get(item.mapping.strokeKey)?.id];
    else if(item.type==='char')expected=[...new Set(item.parts.flatMap(part=>part.division.map(root=>roots.get(root)?.id)))];
    else if(item.type==='word')expected=[...new Set(item.parts.filter(part=>/^(?:\p{Script=Han}|〇)$/u.test(part.char)).map(part=>chars.get(part.char)?.id))];
    else if(item.type==='short'){
      if(item.commit!==(item.code.endsWith('_')?'space':'auto'))throw new Error('简码上屏键不一致');
      const rule=item.code.endsWith('_')?'one':item.code.length===1?'fixed':item.code.length===2?'two':'three';
      if(item.shortRule!==rule&&item.shortRule!=='assigned')throw new Error('简码等级不一致');
      expected=[item.baseId];
    }
    else if(item.type==='variant')expected=[...new Set([item.baseId,...item.parts[0].division.map(root=>roots.get(root)?.id)])];
    else expected=[];
    if(expected.some(id=>id===undefined)||JSON.stringify(item.dependencies)!==JSON.stringify(expected))throw new Error('前置与实际拆分不一致：'+item.text);
    for(const part of item.parts)for(let i=0;i<part.division.length;i++)if(roots.get(part.division[i])?.fullCode!==part.rootCodes[i])throw new Error('拆分引用的字根编码无效：'+item.text);
  }
  return true;
}
const pools=new WeakMap();
export function practicePool(data,track='core'){
  if(track==='core')return data.items;
  if(!pools.has(data))pools.set(data,new Map());
  const cache=pools.get(data);if(cache.has(track))return cache.get(track);
  const index=new Map(allLessons(data).map(item=>[item.id,item])),known=new Set(),result=[];
  function visit(item){
    if(!item||known.has(item.id))return;
    for(const id of [...item.dependencies].sort((a,b)=>index.get(a).order-index.get(b).order))visit(index.get(id));
    known.add(item.id);result.push(item);
  }
  for(const item of data.transferItems||[])if(item.type===track)visit(item);
  cache.set(track,result);return result;
}
