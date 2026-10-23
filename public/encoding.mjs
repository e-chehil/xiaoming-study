// Every keystroke retains its source root and role, including commit keys.
export const ROLE_NAMES={a:'大码 A',s:'小码 S',b:'补码 B',key:'固定简码',commit:'空格上屏'};
export const displayLetter=(letter,role)=>role==='commit'?'␣':role==='a'?letter.toUpperCase():letter.toLowerCase();
export function encodingCandidates(item){
  if(!item?.code)return [];
  if(item.answerRole)return [...item.code].map(letter=>({letter,role:item.answerRole,charIndex:0,rootIndex:0,root:item.text}));
  if(!item.parts?.length)return [];
  const take=(charIndex,rootIndex,roles)=>[...roles].map(role=>({letter:item.parts[charIndex].rootCodes[rootIndex][{a:0,s:1,b:2}[role]],role,charIndex,rootIndex,root:item.parts[charIndex].division[rootIndex]}));
  const last=charIndex=>item.parts[charIndex].division.length-1;
  if(item.type==='short'){
    if(['fixed','assigned'].includes(item.shortRule))return [...item.code].map(letter=>({letter,role:letter==='_'?'commit':'key',charIndex:0,rootIndex:0,root:item.text}));
    if(item.shortRule==='one')return [...take(0,0,'a'),{letter:'_',role:'commit',charIndex:0,rootIndex:0,root:item.text}];
    if(item.shortRule==='two')return [...take(0,0,'a'),...take(0,1,'a')];
    return [...take(0,0,'as'),...take(0,last(0),'s')];
  }
  if(item.type==='root')return take(0,0,'asb');
  if(['char','variant'].includes(item.type)){
    const n=last(0)+1;
    if(n===1)return take(0,0,'asb');
    if(n===2)return [...take(0,0,'as'),...take(0,1,'as')];
    if(n===3)return [...take(0,0,'as'),...take(0,1,'a'),...take(0,2,'as')];
    return [...take(0,0,'as'),...take(0,1,'a'),...take(0,2,'a'),...take(0,n-1,'a')];
  }
  const n=item.parts.length;
  if(n===2)return [...take(0,0,'as'),...(last(0)>0?take(0,last(0),'a'):[]),...(last(1)>0?[...take(1,0,'a'),...take(1,last(1),'as')]:take(1,0,'as'))];
  if(n===3)return [...take(0,last(0),'as'),...take(1,last(1),'a'),...(last(2)>0?[...take(2,0,'a'),...take(2,last(2),'a')]:take(2,0,'as'))];
  return [...take(0,last(0),'as'),...take(1,last(1),'a'),...take(2,last(2),'a'),...take(n-1,last(n-1),'a')];
}
export const encodingSteps=item=>encodingCandidates(item).slice(0,item?.type==='word'?5:Infinity);
export function fullEncodingSteps(item){
  if(item?.type==='short')return encodingSteps({...item,type:'char',code:item.baseCode});
  return item?.fullCode?[...item.fullCode].map((letter,i)=>({letter,role:'asb'[i],charIndex:0,rootIndex:0,root:item.text})):encodingSteps(item);
}
export function displayCode(item,value=item?.code||'',full=false){
  const steps=full?fullEncodingSteps(item):encodingSteps(item);
  return [...value].map((letter,i)=>displayLetter(letter,steps[i]?.role||'s')).join('');
}
