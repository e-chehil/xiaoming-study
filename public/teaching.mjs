import {encodingSteps,encodingCandidates,displayLetter,displayCode,ROLE_NAMES} from './encoding.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sourceTextMarkup=value=>esc(value).replace(/「([^」]*)」/g,(_match,text)=>'「<span class="root-font" data-source-text>'+text+'</span>」');
const initialLabel=root=>root?.mapping?.initial==='0'?'零声母':root?.mapping?.initial||'';

const SPLIT_NOTES={
  '戋':{division:'一戈',text:'独体字也要继续拆到字根：「戋」拆为「一」「戈」。'},
  '丸':{division:'九丶',text:'「丸」拆为「九」与「丶」，再按双根字规则分别取 AS。'},
  '朱':{division:'牛八',text:'「朱」虽然是独体字，取码时仍拆为「牛」「八」两个字根。'}
};
export function splitNote(item){
  return (item.parts||[]).map(part=>{const note=SPLIT_NOTES[part.char];return note&&part.division.join('')===note.division?note.text:'';}).filter(Boolean).join(' ');
}

export function ruleSummary(item){
  if(item.type==='initial')return '声母 '+item.aliases.join('/')+' → 小码 '+item.code;
  if(item.type==='stroke')return item.text+' → 补码 '+item.code;
  if(item.type==='root')return '大码 '+item.code[0].toUpperCase()+' · '+(item.mapping.smallSource==='stroke'?'无音，S 同 B':initialLabel(item)+'→'+item.code[1])+' · '+item.mapping.stroke.replace('时针','')+'→'+item.code[2];
  if(item.type==='short')return ({fixed:'固定一键简码',assigned:'固定简码：按键位记忆',one:'取首根大码，再按空格上屏',two:'取首根与次根大码，两键即上屏',three:'取首根 AS 与末根 S，三键即上屏'})[item.shortRule];
  const n=item.parts[0]?.division.length;
  if(['char','variant'].includes(item.type))return ({1:'单根字：取完整 ASB',2:'双根字：首根 AS ＋ 次根 AS',3:'三根字：首根 AS ＋ 次根 A ＋ 末根 AS'})[n]||'四根以上：首根 AS ＋ 次、三、末根 A';
  return item.parts.length===2?'两字词：取两字首末根，最多五位':item.parts.length===3?'三字词：末、末、首末；末字单根取 AS':'四字以上：取首、次、三、末字的末根';
}
export function stepBasis(item,position,roots){
  const step=encodingSteps(item)[position];if(!step)return '';
  const letter=displayLetter(step.letter,step.role),root=roots.get(step.root);
  if(step.role==='commit')return '按空格确认上屏；空格是本简码的必要按键。';
  if(step.role==='key')return item.shortRule==='fixed'?'按 '+letter+' 直接上屏。':'第 '+(position+1)+' 键 '+letter+'：按分配键位记忆。';
  if(item.type==='initial')return '声母 '+item.aliases.join('/')+' 映射到小码 '+letter+'。';
  if(item.type==='stroke')return item.text+' 映射到补码 '+letter+'。';
  const source=(item.type==='word'?'第 '+(step.charIndex+1)+' 字「'+item.parts[step.charIndex].char+'」的':'')+'第 '+(step.rootIndex+1)+' 根「'+step.root+'」';
  if(step.role==='a')return source+'取大码 '+letter+'；这是需要记忆的字根键位。';
  if(step.role==='s'){
    if(root?.mapping?.smallSource==='stroke')return source+'不取读音，小码同补码 '+letter+'。';
    return source+'取小码：字根读音 '+(root?.pinyin||'')+'，'+initialLabel(root)+' → '+letter+'。';
  }
  return source+'取补码：首笔为'+(root?.mapping?.stroke||'')+' → '+letter+'。';
}
export function briefStepBasis(item,position,roots){
  const s=encodingSteps(item)[position];if(!s)return '';
  const r=roots.get(s.root),letter=displayLetter(s.letter,s.role);
  if(s.role==='commit')return '按空格上屏';
  if(s.role==='key')return '固定简码 '+letter;
  if(item.type==='initial')return item.aliases.join('/')+' → '+letter;
  if(item.type==='stroke')return item.text+' → '+letter;
  return '「'+s.root+'」 · '+(s.role==='a'?'大码 '+letter:s.role==='b'?'首笔'+(r?.mapping?.stroke||'')+' → '+letter:r?.mapping?.smallSource==='stroke'?'无音，小码同补码 '+letter:'小码 '+initialLabel(r)+' → '+letter);
}

export function derivation(item,roots){
  const steps=encodingSteps(item),candidates=encodingCandidates(item);
  return {summary:ruleSummary(item),steps:steps.map((step,i)=>({...step,basis:stepBasis(item,i,roots)})),omitted:candidates.slice(steps.length)};
}
export function explanationMarkup(item,roots,{position=0}={}){
  const value=derivation(item,roots),selected=value.steps[position]||value.steps[0];
  const fixed=item.type==='short'&&['fixed','assigned'].includes(item.shortRule);
  const fullReference=item.type==='short'?'<p class="derivation-reference"><span>完整码</span><code data-source-text>'+esc(displayCode({...item,type:'char',code:item.baseCode}))+'</code></p>':'';
  const used=new Set(value.steps.map(s=>s.charIndex+':'+s.rootIndex+':'+s.role));
  const groups=(fixed?[]:item.parts).map((part,ci)=>'<div class="derivation-character">'+(item.type==='root'?'':'<span class="root-font" data-source-text>'+esc(part.char)+'</span>')+'<div class="derivation-roots">'+part.division.map((root,ri)=>{
    const key=ci+':'+ri;
    return '<span class="derivation-root" data-root-key="'+key+'" data-active="'+(['a','s','b'].includes(selected?.role)&&selected?.charIndex===ci&&selected?.rootIndex===ri)+'"><span class="root-font" data-source-text>'+esc(root)+'</span><span class="derivation-full-code" data-source-text>'+[...part.rootCodes[ri]].map((letter,k)=>'<span data-root-role="'+('asb'[k])+'" class="role-'+('asb'[k])+(used.has(key+':'+('asb'[k]))?' selected':' unused')+(selected?.charIndex===ci&&selected?.rootIndex===ri&&selected?.role==='asb'[k]?' active-code-role':'')+'">'+displayLetter(letter,'asb'[k])+'</span>').join('')+'</span></span>';
  }).join('')+'</div></div>').join('');
  return '<section class="derivation-panel" data-lesson-id="'+item.id+'" aria-label="取码过程"><p class="derivation-rule">'+esc(value.summary)+'</p>'+
    (groups?'<div class="derivation-groups" data-character-count="'+item.parts.length+'">'+groups+'</div>':'<div class="derivation-subject root-font" data-source-text>'+esc(item.text)+'</div>')+'<div class="derivation-result" style="--result-count:'+value.steps.length+'">'+value.steps.map((step,i)=>'<button class="derivation-step role-'+step.role+'" data-action="explain-step" data-step-index="'+i+'" data-root-key="'+(['key','commit'].includes(step.role)?'':step.charIndex+':'+step.rootIndex)+'" data-root-role="'+step.role+'" aria-pressed="'+(i===position)+'"><small>第'+(i+1)+'位</small><b>'+displayLetter(step.letter,step.role)+'</b><span class="derivation-role">'+esc(ROLE_NAMES[step.role])+'</span></button>').join('')+'</div>'+
    '<p class="derivation-basis" data-step-basis aria-live="polite" aria-atomic="true">'+sourceTextMarkup(selected?.basis||'')+'</p>'+
    (value.omitted.length?'<p class="derivation-note">按规则先得到 '+esc(candidatesToText(encodingCandidates(item)))+'；词码最多五位，后 '+value.omitted.length+' 位不输入。</p>':'')+
    (value.steps.length>1?'<p class="derivation-note">选择码位，查看'+(fixed?'按键说明':'对应字根和取码依据')+'。</p>':'')+(splitNote(item)?'<p class="derivation-note">'+sourceTextMarkup(splitNote(item))+'</p>':'')+fullReference+'</section>';
}
function candidatesToText(steps){return steps.map(s=>displayLetter(s.letter,s.role)).join('');}
export function glyphMarkup(item,data){
  const base=item.type==='variant'?data.items.find(i=>i.id===item.baseId):item;
  if(!base||base.parts?.length!==1)return '';
  const alternate=data.glyphVariants?.[base.text];if(!alternate)return '';
  const compatible={...base,type:'variant',code:alternate.code,parts:[alternate]};
  const fallback=data.teaching?.glyphSource.fontFallbacks?.includes(base.text);
  return '<section class="glyph-comparison" aria-label="字形与拆分对照"><div><strong>默认字形</strong><span class="glyph-default" lang="zh-CN" data-source-text>'+esc(base.text)+'</span><span class="root-font" data-source-text>'+esc(base.parts[0].division.join(' · '))+'</span><code data-source-text>'+esc(displayCode(base))+'</code></div><div><strong>'+ (fallback?'兼容拆分':'台湾字形')+'</strong><span class="'+(fallback?'glyph-default':'glyph-taiwan')+'" lang="'+(fallback?'zh-CN':'zh-TW')+'" data-source-text>'+esc(base.text)+'</span><span class="root-font" data-source-text>'+esc(alternate.division.join(' · '))+'</span><code data-source-text>'+esc(displayCode(compatible))+'</code></div><p>'+(base.code===alternate.code?'拆分不同，编码相同。':'拆分与编码均不同，按所学字形取码。')+(fallback?'此字暂以原字形展示，兼容拆分见右栏。':'')+'</p></section>';
}
