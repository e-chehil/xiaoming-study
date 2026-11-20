import {requestJson} from './request.mjs';
// The dictionary is shared by both courses; it never modifies lessons or FSRS data.
const TONES={a:[...'āáǎà'],e:[...'ēéěè'],i:[...'īíǐì'],o:[...'ōóǒò'],u:[...'ūúǔù'],ü:[...'ǖǘǚǜ'],ê:['ê̄','ế','ê̌','ề'],m:['m̄','ḿ','m̌','m̀'],n:['n̄','ń','ň','ǹ']};
export function markedPinyin(value){
  return String(value).replace(/[A-Za-züÜêÊ:]+[0-5]/g,raw=>{
    const tone=Number(raw.at(-1)),word=raw.slice(0,-1).replace(/u:/gi,m=>m[0]==='U'?'Ü':'ü').replace(/v/gi,m=>m==='V'?'Ü':'ü');
    if(!tone||tone===5)return word;
    const lower=word.toLowerCase();
    let at=lower.indexOf('a');if(at<0)at=lower.indexOf('e');if(at<0)at=lower.indexOf('ou');
    if(at<0)at=[...lower].findLastIndex(c=>'iouüê'.includes(c));
    if(at<0)at=[...lower].findLastIndex(c=>'mn'.includes(c));
    if(at<0)return word;
    const replacement=TONES[lower[at]]?.[tone-1];
    return replacement?word.slice(0,at)+(word[at]===word[at].toUpperCase()?replacement.toUpperCase():replacement)+word.slice(at+1):word;
  });
}
export function readingKey(value,{tones=true}={}){
  let result=markedPinyin(value).toLowerCase().normalize('NFD');
  if(!tones)result=result.replace(/[\u0300\u0301\u0304\u030c]/g,'');
  return result.normalize('NFC').replace(/[^\p{L}\p{M}]/gu,'');
}
export const REFERENCE=/([\p{Script=Han}〇〻々][\p{Script=Han}〇〻々A-Za-z0-9·・]*)(?:\|([\p{Script=Han}〇〻々A-Za-z0-9·・]+))?(?:\[{1,2}([^\]]+)\]{1,2})?/gu;
const relationship=/^(?:(?:old |archaic |erhua )?variant of|see |same as |erhua form of)/i;
const ancillary=/^(?:CL:|Taiwan pr\.|also (?:written|pr\.)|abbr\. for|used in )/i;

export class Cedict{
  constructor(data,{deferIndex=false}={}){
    if(data.version!==1||data.entries.length!==data.source.entries)throw new Error('词典数据不完整');
    this.source=data.source;this.entries=data.entries;this.indexes={simplified:new Map(),traditional:new Map()};
    this.readings=new Map();this.matches={simplified:new WeakMap(),traditional:new WeakMap()};
    if(!deferIndex)this.indexRange(0,this.entries.length);
  }
  indexRange(start,end){
    for(let id=start;id<end;id++){
      const entry=this.entries[id];
      for(const [course,column]of [['traditional',0],['simplified',1]]){
        const index=this.indexes[course],key=entry[column];
        if(!index.has(key))index.set(key,[]);index.get(key).push(id);
      }
    }
  }
  headword(id,course='simplified'){return this.entries[id]?.[course==='traditional'?0:1]||'';}
  pronunciation(id){if(!this.readings.has(id))this.readings.set(id,markedPinyin(this.entries[id][2]));return this.readings.get(id);}
  lookup(text,course='simplified'){return this.indexes[course].get(text)||[];}
  match(item,course='simplified'){
    const cache=this.matches[course];if(cache.has(item))return cache.get(item);
    if(!['char','word'].includes(item.type))return {ids:[],primary:null,match:'none'};
    const readings=(item.displayPinyin||item.pinyin||'').split(/\s*\/\s*/).filter(Boolean);
    const exact=readings.map(value=>readingKey(value)),base=readings.map(value=>readingKey(value,{tones:false}));
    const ranked=this.lookup(item.text,course).map(id=>{
      const py=this.pronunciation(id),key=readingKey(py),plain=readingKey(py,{tones:false});
      const e=exact.indexOf(key),b=base.indexOf(plain),entry=this.entries[id];
      const match=e>=0?'exact':b>=0?'toneless':!readings.length?'unread':'other';
      const priority=e>=0?e*10:b>=0?100+b*10:1000;
      const penalty=Number(entry[3].every(s=>relationship.test(s)))*3+Number(entry[3].every(s=>/^(?:old |archaic )?variant of /i.test(s)))*4+Number(entry[3].some(s=>/^surname /i.test(s)))*5+Number(/^[A-Z]/.test(entry[2]));
      return {id,match,score:priority+penalty};
    }).sort((a,b)=>a.score-b.score||a.id-b.id);
    const result={ids:ranked.map(row=>row.id),primary:ranked[0]?.id??null,match:ranked[0]?.match||'none'};
    cache.set(item,result);return result;
  }
  reference(match){
    // Definition references always use traditional|simplified, independently of UI locale.
    const ids=this.lookup(match[1],'traditional');
    const wanted=match[3]?readingKey(match[3]):'';
    const matches=ids.filter(id=>(!match[2]||this.entries[id][1]===match[2])&&(!wanted||readingKey(this.entries[id][2])===wanted));
    const caseKey=value=>markedPinyin(value).normalize('NFC').replace(/[^\p{L}\p{M}]/gu,'');
    return matches.find(id=>!match[3]||caseKey(this.entries[id][2])===caseKey(match[3]))??matches[0]??null;
  }
  references(id){
    const found=new Set();
    for(const sense of this.entries[id][3])for(const match of sense.matchAll(new RegExp(REFERENCE))){const target=this.reference(match);if(target!==null&&target!==id)found.add(target);}
    return [...found];
  }
  related(id){
    const visited=new Set([id]),result=[],queue=this.references(id).map(target=>[target,0]);
    for(let position=0;position<queue.length;position++){
      const [target,depth]=queue[position];if(visited.has(target))continue;
      visited.add(target);result.push(target);
      // Follow reference-only chains until an actual definition, with a cycle/depth guard.
      if(depth<3&&this.entries[target][3].every(sense=>relationship.test(sense)||ancillary.test(sense)))for(const next of this.references(target))queue.push([next,depth+1]);
    }
    return result;
  }
  plain(value,course='simplified'){
    return value.replace(new RegExp(REFERENCE),(whole,traditional,simplified,pinyin)=>`${course==='traditional'?traditional:simplified||traditional}${pinyin?' ('+markedPinyin(pinyin)+')':''}`);
  }
  summary(id,course='simplified',visited=new Set()){
    if(id===null||visited.has(id)||visited.size>=4)return '';
    visited.add(id);const entry=this.entries[id];
    const useful=entry[3].filter(sense=>!relationship.test(sense)&&!ancillary.test(sense));
    if(useful.length)return useful.slice(0,2).map(sense=>this.plain(sense,course)).join(' · ');
    // Resolve a see/variant-only headword, while retaining the original relationship in details.
    for(const sense of entry[3].filter(sense=>relationship.test(sense)||/^used in /i.test(sense))){
      for(const match of sense.matchAll(new RegExp(REFERENCE))){
        const target=this.reference(match);
        if(target===null)continue;
        const text=this.summary(target,course,new Set(visited));
        if(text)return this.headword(target,course)===this.headword(id,course)?text:`${this.headword(target,course)} — ${text}`;
      }
    }
    return this.plain(entry[3][0]||'',course);
  }
  search(query,course='simplified',{offset=0,limit=30}={}){
    const q=query.trim().toLowerCase();if(!q)return {ids:[],total:0};
    const exact=new Set([...this.lookup(query.trim(),course),...this.lookup(query.trim(),course==='simplified'?'traditional':'simplified')]);
    const exactPriority=id=>Number(this.entries[id][0]!==query.trim())+Number(this.entries[id][3].every(s=>/^(?:old |archaic )?variant of /i.test(s)))*4+Number(this.entries[id][3].some(s=>/^surname /i.test(s)))*5;
    const result=[...exact].sort((a,b)=>exactPriority(a)-exactPriority(b)||a-b);const key=readingKey(q,{tones:false}),pinyin=/^[a-züv:'\s\dāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ-]+$/i.test(q);
    if(!this.searchRows)this.searchRows=this.entries.map(entry=>({text:(entry[0]+' '+entry[1]+' '+entry[3].join(' ')).toLowerCase(),pinyin:entry[2].toLowerCase().replace(/u:/g,'ü').replace(/[^\p{L}]/gu,'').normalize('NFC')}));
    this.entries.forEach((entry,id)=>{
      if(exact.has(id))return;
      const row=this.searchRows[id];
      if(row.text.includes(q)||(pinyin&&row.pinyin.includes(key)))result.push(id);
    });
    return {ids:result.slice(offset,offset+limit),total:result.length};
  }
}

let loading;
export function loadCedict({retry=false}={}){
  if(!loading||retry)loading=requestJson('./data/cedict/dictionary.json').then(async data=>{
    const dictionary=new Cedict(data,{deferIndex:true});
    for(let start=0;start<data.entries.length;start+=4096){
      dictionary.indexRange(start,Math.min(start+4096,data.entries.length));
      // Yield between batches so starting the dictionary does not stall keystrokes.
      if(start+4096<data.entries.length)await new Promise(resolve=>setTimeout(resolve,0));
    }
    return dictionary;
  }).catch(error=>{loading=null;throw error;});
  return loading;
}
