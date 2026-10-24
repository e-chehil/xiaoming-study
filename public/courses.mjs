import {requestJson} from './request.mjs';
import {traditionalLabel} from './learning-schema.mjs';
export const COURSES=Object.freeze({
  simplified:{name:'简中',language:'zh-Hans',path:'./data/learning-runtime.json',directory:'./data/'},
  traditional:{name:'繁中',language:'zh-Hant',path:'./data/traditional/learning-runtime.json',directory:'./data/traditional/'},
});
export function selectedCourse(){
  try{const selected=localStorage.getItem('xiaoming-course');return COURSES[selected]?selected:'simplified';}catch{return 'simplified';}
}
let locale='simplified',characterMap={};
export async function setLocale(course){
  if(course==='traditional'&&!Object.keys(characterMap).length){
    characterMap=await requestJson('./vendor/ui-traditional-map.json');
  }
  locale=course;document.documentElement.lang=COURSES[course].language;document.title=t('潇明习字');
}
export function t(value){
  if(locale!=='traditional')return String(value);
  return traditionalLabel(value,characterMap);
}
export function localize(root){
  if(!root)return;
  root.querySelectorAll('.root-font,.code-letter,.prompt-code,[data-source-text],.pronunciation').forEach(node=>node.setAttribute('translate','no'));
  if(locale!=='traditional')return;
  const protectedText='.root-font,.code-letter,.prompt-code,.code-input,[data-source-text],script,style';
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(!node.parentElement?.closest(protectedText))node.nodeValue=t(node.nodeValue);
  }
  for(const node of [root,...root.querySelectorAll('[title],[aria-label],[placeholder]')]){
    if(node.closest?.(protectedText)||node.hasAttribute?.('data-id'))continue;
    for(const attr of ['title','aria-label','placeholder'])if(node.hasAttribute?.(attr))node.setAttribute(attr,t(node.getAttribute(attr)));
  }
}
export function reading(item){
  return {pinyin:item.displayPinyin||item.pinyin||'',zhuyin:item.zhuyin||'',source:item.readingSource||''};
}
export function readingMarkup(item,escape,{all=false}={}){
  const value=reading(item);
  const py=all?value.pinyin:value.pinyin.split(' / ')[0],bop=all?value.zhuyin:value.zhuyin.split(' / ')[0];
  if(!py&&!bop)return '';
  const inferred=value.source==='inferred';
  return `<span class="pronunciation" ${inferred?'title="'+escape(t('自动推读，仅供参考。'))+'" data-reading-inferred="true"':''}><span class="reading-zhuyin">${escape(bop)}</span><span class="reading-pinyin">${escape(py)}</span>${inferred?`<small class="reading-source">${t('参考')}</small>`:''}</span>`;
}
