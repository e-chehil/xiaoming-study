// Keep the persistent namespace stable for existing learning progress.
import {encodingSteps} from './encoding.mjs';
import {mnemonicFor, storyShape} from './mnemonics.mjs';

const identity=item=>item.practiceAlias||item.id;
export function exposesAnswer(target,shown){
  if(!target?.code||!shown?.code)return false;
  if(identity(target)===identity(shown))return true;
  if(['short','variant'].includes(shown.type)&&shown.baseId===identity(target))return true;
  if(target.type==='short'&&!['fixed','assigned'].includes(target.shortRule)&&target.baseId===shown.id)return true;
  // Looking up a root used by this answer also supplies part of the answer.
  return shown.type==='root'&&encodingSteps(target).some(step=>['a','s','b'].includes(step.role)&&step.root===shown.text);
}
export function exposesMnemonic(target, clue) {
  const entry = mnemonicFor(clue);
  if (!target?.code || !entry) return false;
  // These six rhymes explicitly teach both the initial group and the stroke.
  if (clue.role !== 'a') return ['initial', 'stroke'].includes(target.type) && target.code === clue.letter;
  return encodingSteps(target).some(step => {
    if (step.role !== 'a' || step.letter !== clue.letter) return false;
    if (entry.verse.includes(step.root)) return true;
    return clue.full && (entry.story.includes(storyShape(step.root)) || entry.forms.some(([form]) => form === step.root));
  });
}

export class AnswerExposure {
  constructor(storage){
    this.memory=new Set();
    try{this.storage=storage??globalThis.sessionStorage;}catch{}
  }
  key(course,item){return `xiaoming-study-dev-v5:answer:${course}:${identity(item)}`;}
  has(course,item){
    const key=this.key(course,item);
    try{return this.memory.has(key)||this.storage?.getItem(key)==='seen';}catch{return this.memory.has(key);}
  }
  remember(course,item){
    const key=this.key(course,item);this.memory.add(key);
    try{this.storage?.setItem(key,'seen');}catch{}
  }
  consume(course,item){
    const key=this.key(course,item);this.memory.delete(key);
    try{this.storage?.removeItem(key);}catch{}
  }
}
