import {readLocation,viewURL} from './view-location.mjs';
import {resourceStore} from './resource-store.mjs';
import { cleanSettings, dayKey, pickContinuous, evaluateAttempt, emptyDaily, validateBackup, itemIndex,cardFor,createSelectionContext } from './engine.mjs';
import { encodingSteps, fullEncodingSteps, displayLetter, displayCode, ROLE_NAMES } from './encoding.mjs';
import { openDatabase, readProgress, saveReview, undoReview, clearCorrection, saveSettings, replaceProgress, ProgressConflictError } from './storage.mjs';
import {AnswerExposure,exposesAnswer} from './answer-exposure.mjs';
import { COURSES,selectedCourse,setLocale,localize,t,readingMarkup } from './courses.mjs';
import { loadCedict,REFERENCE,markedPinyin } from './cedict.mjs';
import { LESSON_TYPES } from './learning-schema.mjs';
import { captureViewState,restoreViewState,trapDialogTab } from './view-state.mjs';
import {hydrateCourse,allLessons,practicePool,TRACKS} from './lesson-data.mjs';
import {ruleSummary,stepBasis,briefStepBasis,explanationMarkup,glyphMarkup,sourceTextMarkup} from './teaching.mjs';

const app=document.querySelector('#app'),overlay=document.querySelector('#modal-root');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>new Intl.NumberFormat('zh-CN').format(value);
const labels=LESSON_TYPES,grades={1:'重来',2:'困难',3:'良好',4:'轻松'};
const strokeLabels={k:'横画',i:'竖画',j:'撇画',f:'点画',e:'逆时针折画',d:'顺时针折画'};
const initialLocation=readLocation(location.href);
let dataset,items,index,db,cards={},logs=[],days={},settings=cleanSettings(),route=initialLocation.view,courseCacheSaved=true,restoringLocation=false;
let current=null,free=false,freeSession=null,reviewOnly=false,completed=0,undoStack=[],pendingCorrection=null,busy=false;
let {search,filter,stateFilter,page}=initialLocation;
let toastTimer,hintTimer,pendingImport,storageError='';
let rootKey='all',rootSearch='',dialogOpener=null,renderedRoute='',typeAhead='',lastCompletion=false,windowActive=true,practiceReturn=null;
let shownAt=0,elapsedBeforePause=0;
let courseId=initialLocation.course||selectedCourse();
const courseSessions=new Map(),courseDatasets=new Map(),courseCacheStates=new Map(),trackSessions=new Map();
let practiceTrack='core',rootFacts=new Map();
function activePool(){return practicePool(dataset,practiceTrack);}
const trackPositions=new WeakMap();
function positionInTrack(item){const pool=activePool();if(!trackPositions.has(pool))trackPositions.set(pool,new Map(pool.map((entry,i)=>[entry.id,i+1])));return trackPositions.get(pool).get(item.id)||item.order;}
function rememberTrack(){try{localStorage.setItem('xiaoming-track:'+courseId,practiceTrack);}catch{}}
function switchTrack(track){
  if(!TRACKS[track]||busy)return;
  if(track===practiceTrack){if(free)restorePractice();enterPractice();return;}
  if(pendingCorrection){enterPractice();notify('请先完成当前订正，再切换训练。');return;}
  if(!practicePool(dataset,track).length)return;
  clockPause();if(free)restorePractice();
  trackSessions.set(courseId+'|'+practiceTrack,{current,completed,undoStack,reviewOnly,elapsedBeforePause,lastCompletion,revision:progressRevision});
  practiceTrack=track;rememberTrack();selectionCache=null;typeAhead='';
  const saved=trackSessions.get(courseId+'|'+track),session=saved?.revision===progressRevision?saved:null;
  current=session?.current||null;completed=session?.completed||0;undoStack=session?.undoStack||[];reviewOnly=session?.reviewOnly||false;
  elapsedBeforePause=session?.elapsedBeforePause||0;lastCompletion=session?.lastCompletion||false;shownAt=0;route='practice';
  if(!current)setCurrent(next());render();
}
function openDerivation(id=current?.item.id){
  const item=itemOf(id);if(!item?.code)return;
  publishExposure(item);
  const position=current?.item.id===item.id&&current.phase==='correction'?Math.max(0,[...item.code].findIndex((letter,i)=>(current.submittedAnswer??current.input)[i]!==letter)):0;
  dialog('取码说明',explanationMarkup(item,rootFacts,{position}),(['char','variant'].includes(item.type)&&dataset.glyphVariants?.[item.text]?'<button class="plain-button" data-action="glyph" data-id="'+id+'">字形对照</button>':'')+'<button class="solid-button" data-action="close-dialog">'+(route==='practice'?'继续练习':'关闭')+'</button>','teaching-dialog');
}
function openGlyph(id){
  const item=itemOf(id);if(!item)return;
  publishExposure(item);
  const variant=dataset.transferItems?.find(lesson=>lesson.type==='variant'&&lesson.baseId===(item.baseId||item.id));
  if(variant)publishExposure(variant);
  dialog('字形与拆分对照',glyphMarkup(item,dataset),'<button class="solid-button" data-action="close-dialog">'+(route==='practice'?'继续练习':'关闭')+'</button>','teaching-dialog');
}
function highlightDerivation(button){
  const panel=button.closest('.derivation-panel'),item=itemOf(panel?.dataset.lessonId);if(!item)return;
  for(const node of panel.querySelectorAll('.derivation-step'))node.setAttribute('aria-pressed',String(node===button));
  for(const node of panel.querySelectorAll('.derivation-root'))node.dataset.active=String(node.dataset.rootKey===button.dataset.rootKey);
  for(const node of panel.querySelectorAll('[data-root-role]'))node.classList.toggle('active-code-role',node.dataset.rootRole===button.dataset.rootRole&&node.closest('[data-root-key]')?.dataset.rootKey===button.dataset.rootKey);
  panel.querySelector('[data-step-basis]').innerHTML=sourceTextMarkup(stepBasis(item,Number(button.dataset.stepIndex),rootFacts));
  localize(panel);
}
function commitSpace(){
  if(!current?.item.code.endsWith('_')||!['typing','correction'].includes(current.phase)||current.input.length!==current.item.code.length-1)return;
  current.input+='_';
  const input=document.querySelector('#code-input');input.value=displayCode(current.item,current.input);
  if(current.phase==='typing')void submit();
  else if(current.input===current.item.code)void finishCorrection();
  else{current.replaceOnType=true;render();}
}
function learningCue(item,visible){
  if(!visible)return '';
  if(current.phase==='correction'){
    const i=Math.max(0,[...item.code].findIndex((letter,j)=>(current.submittedAnswer??current.input)[j]!==letter));
    return '第 '+(i+1)+' 位：'+briefStepBasis(item,i,rootFacts);
  }
  return ruleSummary(item);
}

let dictionary=null,dictionaryError='',dictionarySearch='',dictionaryPage=1,dictionaryTimer;
let disclosureSerial=0;
let progressRevision=0;
let selectionCache=null;
let savingTheme=false;
let themeSave=null;
const answerExposure=new AnswerExposure();
const answerChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('xiaoming-study-dev-v5-answers'):null;
if(answerChannel)answerChannel.onmessage=event=>{
  const {course,id}=event.data||{},data=courseDatasets.get(course);
  if(data)expose(itemIndex(allLessons(data)).get(id),course);
};
const exposureObserver=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting&&entry.target.isConnected&&!entry.target.closest('[inert]'))publishExposure(itemOf(entry.target.dataset.answerId));
});
new MutationObserver(()=>{
  exposureObserver.disconnect();
  document.querySelectorAll('.course-table [data-answer-id],.root-grid [data-answer-id],.dialog [data-answer-id]').forEach(node=>exposureObserver.observe(node));
}).observe(document.body,{childList:true,subtree:true});
function publishExposure(shown){
  if(!shown?.code)return;
  expose(shown);answerChannel?.postMessage({course:courseId,id:shown.id});
}
function expose(shown,course=courseId){
  const states=[course===courseId?{free,current,practiceReturn}:courseSessions.get(course),...[...trackSessions].filter(([key])=>key.startsWith(course+'|')).map(([,state])=>state)];
  for(const state of states){const attempt=state?.free?state.practiceReturn?.current:state?.current;
    if(attempt?.phase==='typing'&&exposesAnswer(attempt.item,shown)){attempt.revealed=true;answerExposure.remember(course,attempt.item);}
  }
}
const today=()=>days[dayKey()]||emptyDaily();
const dueCount=()=>{const active=itemIndex(activePool());return Object.values(cards).filter(card=>active.has(card.id)&&!active.get(card.id).practiceAlias&&new Date(card.due)<=new Date()).length;};
const next=()=>{
  const pool=activePool();
  if(selectionCache?.items!==pool||selectionCache.cards!==cards||selectionCache.history!==logs)selectionCache=createSelectionContext(pool,cards,logs);
  return pickContinuous(pool,cards,{newLimit:settings.newPerDay,newToday:today().newCount,reviewOnly,history:logs,context:selectionCache});
};
const itemOf=id=>index.get(Number(id));
function notify(message){const node=document.querySelector('#toast');node.textContent=t(message);node.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('visible'),4000);}
function clockPause(){
  if(shownAt)elapsedBeforePause+=performance.now()-shownAt;
  shownAt=0;
}
function clockResume(){
  if(route!=='practice'||document.hidden||overlay.firstChild||!windowActive)return;
  if(current?.phase==='typing'&&!shownAt)shownAt=performance.now();
}
function elapsed(){return Math.round(elapsedBeforePause+(shownAt?performance.now()-shownAt:0));}
function setCurrent(selection){
  clearTimeout(hintTimer);
  shownAt=0;elapsedBeforePause=0;
  current=selection?{...selection,track:practiceTrack,phase:'typing',firstExposure:free?!selection.selfTest:!cards[selection.item.id],input:'',mistakes:0,backspaces:0,hints:0,revealed:!free&&answerExposure.has(courseId,selection.item),pasted:false}:null;
  if(free&&current?.firstExposure)publishExposure(current.item);
  if(route==='practice')clockResume();
}
function advance(){
  lastCompletion=true;
  if(free){
    if(freeSession){
      freeSession.position++;
      setCurrent(freeSelection());render({transition:!!current});
      if(!current)document.querySelector('main h1')?.focus({preventScroll:true});
      return;
    }
    restorePractice();navigate('library');return;
  }
  setCurrent(next());render({transition:true});
  drainTypeAhead();
}
function restoreCorrection(){
  if(!pendingCorrection||!index.has(Number(pendingCorrection.undo.id)))return false;
  const saved=pendingCorrection.undo.current;
  practiceTrack=saved.track||'core';rememberTrack();selectionCache=null;
  setCurrent({...saved,item:itemOf(pendingCorrection.undo.id)});
  current.firstExposure=saved.firstExposure;
  current.reviewKey=pendingCorrection.undo.logKey;
  current.input=pendingCorrection.outcome==='incorrect'?saved.input:'';
  reviewOnly=pendingCorrection.undo.reviewOnly;
  completed=pendingCorrection.undo.completed+1;
  pendingCorrection.undo.answerExposed=true;
  if(!undoStack.some(entry=>entry.logKey===pendingCorrection.undo.logKey))undoStack.push(pendingCorrection.undo);
  showResult(current,pendingCorrection.outcome);
  clockPause();
  return true;
}
function enterPractice(){route='practice';if(!current&&!free&&!restoreCorrection())setCurrent(next());clockResume();render();}
function navigate(view){clockPause();typeAhead='';route=view;render();window.scrollTo({top:0});}
const icons={
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z"/>',
  settings:'<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6m-6 0v6"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-1 .6-2 1-2 2.5m0 3h.01"/>',
  expand:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
  chevron:'<path d="m8 10 4 4 4-4"/>',
};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
function header(){
  const courseLabel=`当前${COURSES[courseId].name}，切换到${COURSES[courseId==='simplified'?'traditional':'simplified'].name}`;
  return `<header class="app-header">
    <button class="brand" data-action="resume" aria-label="潇明习字，返回练习"><strong>潇明习字</strong></button>
    <nav class="header-nav" aria-label="学习导航">${[['practice','练习'],['library','课程'],['roots','字根'],['stats','记录']].map(([view,title])=>`<a href="${esc(viewURL(location.href,{view,course:courseId,search,filter,stateFilter,page}))}" data-action="${view==='practice'?'resume':'navigate'}" data-view="${view}" ${route===view?'aria-current="page"':''}>${title}</a>`).join('')}</nav>
    <div class="header-tools">
      <button id="course-toggle" class="icon-button course-toggle" data-action="course" data-course="${courseId}" aria-label="${courseLabel}" title="${courseLabel}" ${busy?'disabled aria-busy="true"':''}><span aria-hidden="true">${courseId==='simplified'?'简':'繁'}</span></button>
      <button class="icon-button" data-action="theme" aria-label="切换${settings.theme==='dark'?'浅色':'深色'}主题" aria-pressed="${settings.theme==='light'}" title="切换主题">${icon(settings.theme==='dark'?'sun':'moon')}</button>
      <button class="icon-button" data-action="navigate" data-view="settings" aria-label="设置" title="设置">${icon('settings')}</button>
      <button class="icon-button pause-button" data-action="navigate" data-view="menu" aria-label="${route==='practice'?'暂停':'菜单'}" title="${route==='practice'?'暂停':'菜单'}（Esc）">${icon(route==='practice'?'pause':'menu')}</button>
    </div></header>`;
}
function applyTheme(){document.documentElement.dataset.theme=settings.theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',settings.theme==='light'?'#f3f4f1':'#1e2327');try{localStorage.setItem('xiaoming-theme',settings.theme);}catch{}}
async function toggleTheme(){
  if(busy)return;
  const theme=settings.theme==='dark'?'light':'dark';settings={...settings,theme};applyTheme();render();
  if(!db)return;
  busy=true;savingTheme=true;
  themeSave=persistSettings({theme});
  try{await themeSave;}catch{notify('主题已切换，设置暂未保存。');}finally{busy=false;savingTheme=false;themeSave=null;drainTypeAhead();}
}
function syncLocation(push=false){if(restoringLocation)return;const href=viewURL(location.href,{view:route,course:courseId,search,filter,stateFilter,page});if(href!==location.href)history[push?'pushState':'replaceState'](null,'',href);}
let locationTurn=0;
window.addEventListener('popstate',async()=>{const turn=++locationTurn,target=readLocation(location.href);restoringLocation=true;try{while(busy&&turn===locationTurn)await new Promise(resolve=>setTimeout(resolve,100));if(turn!==locationTurn)return;if(target.course&&target.course!==courseId)await switchCourse(target.course);if(turn!==locationTurn)return;({search,filter,stateFilter,page}=target);route=target.view;render();}finally{if(turn===locationTurn)restoringLocation=false;}});
function render({transition=false}={}){
  const oldInput=document.querySelector('#code-input');
  const selection=oldInput?{start:oldInput.selectionStart,end:oldInput.selectionEnd}:null;
  const changedRoute=renderedRoute!==route;
  const viewState=!changedRoute&&route!=='practice'?captureViewState(app):null;
  applyTheme();
  const views={practice:practiceView,menu:menuView,library:libraryView,roots:rootsView,stats:statsView,settings:settingsView,help:helpView,dictionary:dictionaryView};
  app.innerHTML=`<div class="workspace ${route==='practice'?'immersive':'utility'}">${header()}${storageError?`<div class="storage-error">${esc(storageError)}</div>`:''}${(views[route]||practiceView)()}</div>`;
  localize(app);
  const main=app.querySelector('main');if(main){main.id='main-content';main.tabIndex=-1;}
  if(route==='practice'){
    if(transition)document.querySelector('.target-wrap')?.classList.add('question-arrive');
    const input=document.querySelector('#code-input');
    input?.focus({preventScroll:true});
    if(input&&['typing','correction'].includes(current.phase)){
      if(!selectRetainedInput(input))input.setSelectionRange(Math.min(selection?.start??current.input.length,current.input.length),Math.min(selection?.end??current.input.length,current.input.length));
    }
    clockResume();
  }else if(changedRoute){(route==='menu'?document.querySelector('.resume-button'):document.querySelector('main h1'))?.focus({preventScroll:true});}
  else restoreViewState(app,viewState);
  syncLocation(!!renderedRoute&&changedRoute);renderedRoute=route;
  if(!dictionary&&!dictionaryError&&!dictionaryPreparing&&(route==='library'||route==='dictionary'||route==='practice'&&['char','word'].includes(current?.item.type)))void prepareDictionary();
}
function coloredCode(code){return [...code].map((letter,i)=>`<span class="code-letter role-${'asb'[i]}" title="${ROLE_NAMES['asb'[i]]}">${displayLetter(letter,'asb'[i])}</span>`).join('');}
function inlineCode(item){return (item.type==='short'?encodingSteps(item):fullEncodingSteps(item)).map(step=>`<span class="code-letter role-${step.role}">${displayLetter(step.letter,step.role)}</span>`).join('');}
function parts(item){
  if(['root','initial','stroke'].includes(item.type)||item.type==='short'&&['fixed','assigned'].includes(item.shortRule)||item.parts?.length===1&&item.parts[0].division.length===1&&item.parts[0].division[0]===item.text)return '';
  const selected=encodingSteps(item),word=item.type==='word';
  return `<div class="decomposition">${item.parts.map((part,charIndex)=>{
    const roots=part.division.map((root,rootIndex)=>({root,rootIndex})).filter(({rootIndex})=>!word||selected.some(step=>step.charIndex===charIndex&&step.rootIndex===rootIndex));
    if(!roots.length)return '';
    return `<div class="part">${word?`<span class="part-character root-font">${esc(part.char)}</span>`:''}<span class="part-roots">${roots.map(({root,rootIndex})=>`<span class="root-unit root-font" title="${esc(root)} · ${part.rootCodes[rootIndex][0].toUpperCase()+part.rootCodes[rootIndex].slice(1)}">${esc(root)}</span>`).join('<span class="part-plus">·</span>')}</span></div>`;
  }).join('')}</div>`;
}
function codeRow(item,visible,{full=false}={}){
  const steps=full?fullEncodingSteps(item):encodingSteps(item);
  const answer=steps.map(step=>displayLetter(step.letter,step.role)).join('');
  const label=visible?'编码 '+answer.replaceAll('␣',' 空格'):'编码已隐藏';
  return `<div class="prompt-code ${visible?'shown':'hidden-answer'}" id="prompt-code" ${full&&visible?`data-answer-id="${item.id}"`:''} aria-label="${esc(t(label))}">${steps.map((step,i)=>{
    return `<span class="${visible?'role-'+step.role:''}" data-code-position="${i}" title="${visible?ROLE_NAMES[step.role]:''}"><b>${visible?displayLetter(step.letter,step.role):'·'}</b>${visible?`<small>${step.role==='commit'?t('空格'):step.role==='key'?t('简码'):step.role.toUpperCase()}</small>`:''}</span>`;
  }).join('')}</div>`;
}
function targetMarkup(item){
  if(item.type==='initial'){
    const symbols=item.initial==='0'?[t('零声母')]:item.symbols;
    return `<span class="initial-symbols" data-source-text>${symbols.map((symbol,i)=>`<span class="initial-unit"><small class="initial-alias">${esc(item.initial==='0'?item.aliases.join(' · '):item.aliases[Math.min(i,item.aliases.length-1)])}</small><span class="initial-glyph">${esc(symbol)}</span></span>`).join('<span class="initial-separator" aria-hidden="true">/</span>')}</span>`;
  }
  if(item.type==='variant')return '<span class="glyph-taiwan" lang="zh-TW">'+esc(item.text)+'</span>';
  if(item.type!=='stroke')return esc(item.text);
  return `<span class="stroke-glyph" aria-hidden="true">${esc(item.strokeGlyph)}</span><span>${esc(item.text)}</span>`;
}
function lessonCaption(item,visible){
  if(['initial','stroke'].includes(item.type))return '';
  if(item.type==='root')return `${readingMarkup(item,esc)}${current?.firstExposure&&item.mapping?.smallSource==='stroke'?'<span class="silent-root-note">小码同补码</span>':''}<span class="stroke-reference">${strokeLabels[item.mapping?.strokeKey]||''}</span>`;
  return readingMarkup(item,esc);
}
function lessonExamples(item){
  if(!['initial','stroke','root'].includes(item.type)||!item.examples?.length)return '';
  return `<div class="lesson-examples" aria-label="${item.type==='root'?'构字示例':'字根示例'}" style="--example-count:${item.examples.length}">${item.examples.map(example=>`<span class="root-font">${esc(example.text)}</span>`).join('')}</div>`;
}
function practiceView(){
  if(!current)return freeSession?freeCompletionView():completionView();
  const item=current.item,result=current.phase==='result',correction=current.phase==='correction';
  const visible=current.firstExposure||current.guided||result||correction;
  const state=result?'correct':correction?'correction':'typing';
  const status=correction?'订正':free?(current.selfTest?'无提示自测':freeSession?'自由练习':'单项练习'):current.firstExposure?'初识':current.guided?'熟悉':current.supplemental?'巩固':'复习';
  const length=[...item.text].length;
  return `<main class="practice" data-phase="${state}" data-self-test="${!!(free&&current.selfTest)}" data-item-id="${item.id}" data-item-type="${item.type}" data-kind="${current.guided?'guided':current.supplemental?'drill':current.firstExposure?'new':'review'}" aria-label="打字练习">
    <div class="practice-context"><span>${item.type==='variant'?'台湾字形':labels[item.type]}<i>/</i>${status}${!free&&practiceTrack!=='core'&&item.type!==practiceTrack?'<i>/</i>'+(practiceTrack==='short'?'简码前置':'字形前置'):''}</span>${!free?`<span class="path-position" title="${TRACKS[practiceTrack]} · ${num(activePool().length)} 项（含前置）">第 ${num(positionInTrack(item))} 项</span>`:'<button class="quiet-button free-return" data-action="free-exit">返回课程</button>'}</div>
    <section class="focus-stage">
      <div class="target-wrap"><h1 class="target ${item.type==='initial'?'mapping-target':item.type==='stroke'?'stroke-target':'root-font'} ${length>4?'long':''}" data-length="${length===1?'single':length===2?'pair':'short'}" style="--target-length:${length}" id="target">${targetMarkup(item)}</h1><div class="pinyin">${lessonCaption(item,visible)}</div>${lessonExamples(item)}${['char','word','short','variant'].includes(item.type)?`<div class="gloss-wrap" id="practice-meaning">${practiceMeaning(item)}</div>`:''}</div>
      <div class="answer-support" id="answer-support">${visible?parts(item):''}</div>
      <div class="typing-block" style="--code-length:${item.code.length}">
        ${codeRow(item,visible)}
        <div class="entry-wrap" data-retained-error="${!!current.replaceOnType}">
        <label class="sr-only" for="code-input">${esc(item.text)}，${item.code.length} 码</label>
        <input id="code-input" name="code" class="code-input" type="text" inputmode="url" lang="en" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="${item.code.length}" aria-label="${correction?'照着答案输入':'输入'}编码，${item.code.length} 码${item.commit==='space'?'，末键为空格':''}" value="${esc(displayCode(item,current.input))}" ${current.replaceOnType?'aria-invalid="true" aria-errormessage="attempt-status"':''} ${result?'readonly aria-readonly="true"':''}>
        <div class="entry-slots" aria-hidden="true">${[...item.code].map((letter,i)=>`<span class="${i<current.input.length?'filled':i===current.input.length?'active':''}${current.replaceOnType&&current.input[i]!==letter?' mismatch':''}"></span>`).join('')}</div>
        </div>
      </div>
      <div class="attempt-status" id="attempt-status" role="status" aria-live="polite">${!result&&!correction?'<span class="learning-cue">'+sourceTextMarkup(learningCue(item,visible))+'</span>':''}${result?'<span class="status-mark">✓</span><span>正确</span>':correction?`<span>${current.replaceOnType?'输入有误 · 直接重新输入':current.outcome==='blank'?'已看答案 · 照着答案输入':'照着答案输入'}</span><span class="correction-cue">${sourceTextMarkup(learningCue(item,true))}</span>`:''}</div>
    </section>
    <div class="practice-bottom"><span class="session-count">${lastCompletion?'<span class="success-mark" aria-label="上一题已完成">✓</span>':''}${freeSession?'已完成 '+num(freeSession.position)+' / '+num(freeSession.ids.length):'本轮 '+completed}</span><div class="practice-actions"><button class="quiet-button" data-action="derivation">取码说明</button>${item.type==='variant'?'<button class="quiet-button" data-action="glyph" data-id="'+item.id+'">字形对照</button>':''}<button class="quiet-button" data-action="skip" ${result||correction?'disabled':''} title="未输入编码时按空格查看答案">查看答案<kbd>空格</kbd></button></div></div>
  </main>`;
}
function practiceMeaning(item){
  if(!dictionary)return '';
  const match=dictionary.match(item,courseId);
  if(match.primary===null)return '';
  const summary=dictionary.summary(match.primary,courseId);
  const different=['toneless','other'].includes(match.match);
  return `<button class="practice-gloss" data-action="meaning" title="完整释义（;）" aria-haspopup="dialog" aria-keyshortcuts=";" aria-label="查看 ${esc(item.text)} 的英文释义"><span class="gloss-copy"><span class="gloss-text" lang="en" data-source-text>${esc(summary)}</span>${different?`<small class="gloss-reading">词典读音 <span data-source-text>${esc(dictionary.pronunciation(match.primary))}</span></small>`:''}</span><span class="gloss-expand" aria-hidden="true">${icon('expand')}</span></button>`;
}
function definitionMarkup(value){
  const text=value=>esc(value.replace(/\[{1,2}([A-Za-züÜ:0-9' ·.-]+)\]{1,2}/g,(whole,pinyin)=>/[A-Za-züÜ:]+[1-5]/.test(pinyin)?markedPinyin(pinyin):whole));
  let output='',cursor=0;
  for(const match of value.matchAll(new RegExp(REFERENCE))){
    output+=text(value.slice(cursor,match.index));
    const target=dictionary.reference(match),word=courseId==='traditional'?match[1]:match[2]||match[1];
    const label=word+(match[3]?' ('+markedPinyin(match[3])+')':'');
    output+=target===null?esc(dictionary.plain(match[0],courseId)):`<button class="dictionary-reference" data-action="dictionary-entry" data-entry="${target}">${esc(label)}</button>`;
    cursor=match.index+match[0].length;
  }
  return output+text(value.slice(cursor));
}
function dictionaryEntry(id,{related=true}={}){
  const entry=dictionary.entries[id],other=entry[courseId==='traditional'?1:0],word=dictionary.headword(id,courseId);
  const references=related?dictionary.related(id):[];
  const region=`related-${id}-${++disclosureSerial}`;
  return `<article class="dictionary-entry" data-entry-id="${id}"><div class="dictionary-entry-heading" data-source-text><strong class="root-font">${esc(word)}</strong>${other!==word?`<span class="dictionary-variant root-font">${esc(other)}</span>`:''}<span class="reading-pinyin">${esc(dictionary.pronunciation(id))}</span></div><ol class="dictionary-senses" lang="en" data-source-text>${entry[3].map(sense=>`<li>${definitionMarkup(sense)}</li>`).join('')}</ol>${references.length?`<section class="dictionary-related"><button class="disclosure-toggle" data-action="disclosure" aria-expanded="false" aria-controls="${region}"><span>关联词条 · ${references.length}</span>${icon('chevron')}</button><div id="${region}" hidden>${references.map(target=>dictionaryEntry(target,{related:false})).join('')}</div></section>`:''}</article>`;
}
function meaningSection(item,{heading=true}={}){
  if(!['char','word','short','variant'].includes(item.type))return '';
  if(!dictionary)return `<section class="detail-meaning" data-meaning-id="${item.id}"><h3>英文释义</h3><p>${dictionaryError?'词典未能加载，请重试。':'词典加载中…'}</p>${dictionaryError?'<button class="plain-button" data-action="dictionary-retry">重新加载</button>':''}</section>`;
  const match=dictionary.match(item,courseId);
  return `<section class="detail-meaning${heading?'':' meaning-only'}">${heading?'<h3>英文释义</h3>':''}${['toneless','other'].includes(match.match)?'<p class="dictionary-reading-note">词典读音与本题不同。</p>':''}${match.ids.length?match.ids.map(id=>dictionaryEntry(id)).join(''):'<p>暂无这个字词的释义。</p>'}</section>`;
}
function openMeaning(){if(current&&['char','word','short','variant'].includes(current.item.type))dialog('英文释义',meaningSection(current.item,{heading:false}),'','meaning-dialog');}
function openDictionaryEntry(id){if(dictionary?.entries[id])dialog('中英词典',`${dictionaryEntry(id)}`);}
let dictionaryResultsCache;
function dictionaryResults(){
  if(!dictionary)return `<p class="dictionary-empty">${dictionaryError?'词典未能加载，请重试。':'词典加载中…'}</p>${dictionaryError?'<button class="plain-button" data-action="dictionary-retry">重新加载</button>':''}`;
  if(!dictionarySearch.trim())return `<p class="dictionary-empty">输入字词，查看读音和英文释义。</p>`;
  const key=courseId+'\n'+dictionarySearch;
  if(dictionaryResultsCache?.key!==key)dictionaryResultsCache={key,result:dictionary.search(dictionarySearch,courseId,{limit:dictionary.source.entries})};
  const {ids,total}=dictionaryResultsCache.result,pages=Math.max(1,Math.ceil(total/30));dictionaryPage=Math.min(dictionaryPage,pages);
  return `<div class="dictionary-results">${ids.slice((dictionaryPage-1)*30,dictionaryPage*30).map(id=>`<button class="dictionary-result" data-action="dictionary-entry" data-entry="${id}"><span class="dictionary-result-heading" data-source-text><strong class="root-font">${esc(dictionary.headword(id,courseId))}</strong><span class="reading-pinyin">${esc(dictionary.pronunciation(id))}</span></span><span class="dictionary-result-gloss" lang="en" data-source-text>${esc(dictionary.summary(id,courseId))}</span></button>`).join('')||'<p class="dictionary-empty">没有找到词条，试试其他写法或拼音。</p>'}</div><div class="pagination"><span>${num(total)} 条</span><span><button data-action="dictionary-page" data-delta="-1" ${dictionaryPage===1?'disabled':''}>上一页</button> ${dictionaryPage} / ${pages} <button data-action="dictionary-page" data-delta="1" ${dictionaryPage===pages?'disabled':''}>下一页</button></span></div>`;
}
function dictionaryView(){return `<main class="page narrow">${subHeading('中英词典')}<div class="toolbar"><label class="search-field" for="dictionary-search">查词<input id="dictionary-search" name="query" placeholder="中文、英文或拼音…" value="${esc(dictionarySearch)}" type="search" autocomplete="off" spellcheck="false"></label></div><div id="dictionary-results">${dictionaryResults()}</div></main>`;}
function refreshDictionaryResults(){const target=document.querySelector('#dictionary-results');if(target){target.innerHTML=dictionaryResults();localize(target);}}
let dictionaryPreparing=false;
async function prepareDictionary(){
  if(dictionaryPreparing)return;dictionaryPreparing=true;
  dictionaryError='';
  document.documentElement.dataset.dictionary='loading';
  try{dictionary=await loadCedict();searchCache=new WeakMap();}
  catch(error){dictionaryError=error.message;}
  dictionaryPreparing=false;document.documentElement.dataset.dictionary=dictionary?'ready':'error';
  const target=document.querySelector('#practice-meaning');
  if(target&&current){target.innerHTML=practiceMeaning(current.item);localize(target);}
  const pending=overlay.querySelector('[data-meaning-id]');
  if(pending&&itemOf(pending.dataset.meaningId)){pending.outerHTML=meaningSection(itemOf(pending.dataset.meaningId));localize(overlay);}
  if(route==='library'){document.querySelector('#library-results').innerHTML=libraryRows();localize(document.querySelector('#library-results'));syncLocation();}
  refreshDictionaryResults();
}
function freeCompletionView(){
  return `<main class="completion" data-filtered-complete="true"><h1 tabindex="-1">${freeSession.selfTest?'自测完成':'练习完成'}</h1><p>已完成 ${num(freeSession.ids.length)} 项</p><div class="completion-actions"><button class="quiet-button" data-action="free-exit">返回课程</button><button class="plain-button" data-action="free-again">再练一轮</button></div></main>`;
}
function completionView(){
  return `<main class="completion"><h1>没有可练内容</h1><button class="plain-button" data-action="resume">开始学习</button></main>`;
}
function hintNext(){
  if(!current||busy||current.phase!=='typing'||current.firstExposure||current.guided)return;
  const position=current.input.length;
  if(position>=current.item.code.length)return;
  current.hints++;
  clearTimeout(hintTimer);
  const step=encodingSteps(current.item)[position];
  document.querySelectorAll('#prompt-code [data-code-position]').forEach((span,i)=>{
    span.className=i===position?'hinted role-'+step.role:'';
    span.querySelector('b').textContent=i===position?displayLetter(step.letter,step.role):'·';
  });
  const status=document.querySelector('#attempt-status');if(status){status.innerHTML=sourceTextMarkup(briefStepBasis(current.item,position,rootFacts));localize(status);}
  const identity=current;
  hintTimer=setTimeout(()=>{
    if(current===identity&&route==='practice'&&current.phase==='typing'){document.querySelector('#prompt-code').outerHTML=codeRow(current.item,false);document.querySelector('#attempt-status').textContent='';}
  },700);
}
function showResult(selected,outcome,due){
  selected.submittedAnswer=selected.input;
  selected.phase=outcome==='correct'?'result':'correction';
  selected.outcome=outcome;
  selected.resultDue=due;
  selected.revealed=true;
  selected.replaceOnType=outcome==='incorrect';
  if(outcome==='blank')selected.input='';
  if(free&&outcome!=='correct')publishExposure(selected.item);
}
function lockInput(){
  const input=document.querySelector('#code-input');if(input)input.readOnly=true;
  const practice=document.querySelector('.practice');if(practice){practice.dataset.phase='saving';practice.setAttribute('aria-busy','true');}
}
async function submit(skip=false){
  if(!current||busy||route!=='practice'||current.phase!=='typing')return;
  const selected=current;
  const value=skip?'':selected.input;
  if(!skip&&value.length!==selected.item.code.length)return;
  const correct=value===selected.item.code;
  const outcome=correct?'correct':value?'incorrect':'blank';
  const metrics={skill:['short','variant'].includes(selected.item.type)?selected.item.type:'core',firstExposure:selected.firstExposure,elapsedMs:elapsed(),codeLength:selected.item.code.length,mistakes:Number(!correct&&!!value),backspaces:selected.backspaces,hints:selected.hints,revealed:!!selected.guided||selected.revealed||(!free&&answerExposure.has(courseId,selected.item))||!value,pasted:selected.pasted,correct,blank:!value};
  const snapshot=structuredClone(selected);
  clockPause();clearTimeout(hintTimer);
  selected.phase='submitted';selected.pendingCorrect=correct;selected.input=value;selected.mistakes=metrics.mistakes;
  lockInput();
  if(free){completed++;showResult(selected,outcome);if(correct)advance();else{typeAhead='';render();}return;}
  if(!db){current=snapshot;render();notify('进度无法保存，请检查浏览器的网站数据设置。');return;}
  busy=true;
  try{
    for(let retry=0;retry<3;retry++){
    const wasNew=!cards[selected.item.id];
    const before=cards[selected.item.id]?structuredClone(cards[selected.item.id]):null;
    const result=evaluateAttempt(before,metrics,logs,{retention:settings.retention,supplemental:!!selected.supplemental,guided:!!selected.guided});
    const assessment=result.assessment;
    const card={...result.card,id:selected.item.id,answerCode:selected.item.code};
    const previousDay=structuredClone(today()),day=structuredClone(previousDay);
    day.newCount+=Number(wasNew);day.reviews+=Number(result.scheduleUpdated);day.attempts+=Number(!selected.firstExposure&&!selected.guided);
    day.correct+=Number(!selected.firstExposure&&assessment.verified&&!selected.backspaces);
    day.seconds+=Math.min(600,Math.max(0.1,metrics.elapsedMs/1000));
    const log={track:practiceTrack,skill:metrics.skill,itemId:selected.item.id,grade:assessment.grade,at:new Date().toISOString(),fsrs:result.log,automatic:true,oneShot:true,outcome,submitted:value,correct,firstExposure:selected.firstExposure,firstTry:!selected.firstExposure&&assessment.verified&&!selected.backspaces,hinted:!!(selected.hints||metrics.revealed),hintCount:selected.hints,revealed:metrics.revealed,incorrectSubmissions:metrics.mistakes,backspaces:selected.backspaces,pasted:selected.pasted,elapsedMs:metrics.elapsedMs,codeLength:metrics.codeLength,seconds:metrics.elapsedMs/1000,wasNew,reason:assessment.reason,basis:assessment.basis,pace:assessment.pace,earlyPractice:!!selected.early,supplemental:!!selected.supplemental,guided:!!selected.guided,scheduleUpdated:result.scheduleUpdated};
    const entry={id:card.id,card:before,daily:previousDay,current:snapshot,completed,reviewOnly,answerExposed:!correct||metrics.revealed||selected.firstExposure};
    const pending=correct?null:{undo:entry,outcome};
    let saved;
    try{saved=await saveReview(db,card,log,day,pending,progressRevision);}
    catch(error){
      if(!(error instanceof ProgressConflictError)||retry===2)throw error;
      await refreshProgress();
      if(pendingCorrection){
        current=null;restoreCorrection();
        notify('其他页面有待订正题，已同步。');
        return;
      }
      continue;
    }
    const {key,revision}=saved;progressRevision=revision;selected.reviewKey=key;
    entry.logKey=key;undoStack.push(entry);pendingCorrection=pending;
    cards[card.id]=card;logs.push({...log,key});days[day.date]=day;completed++;
    selectionCache?.record(card,logs.at(-1));
    answerExposure.consume(courseId,selected.item);
    showResult(selected,outcome,card.due);
    break;
    }
  }catch(error){
    current=snapshot;
    current.input='';
    notify('保存失败，本次未记录。请再试一次。');
  }finally{
    busy=false;
    if(current===selected&&current.phase==='result')advance();else{typeAhead='';render();}
  }
}
async function finishCorrection(){
  if(!current||busy||current.phase!=='correction')return;
  const selected=current;
  busy=true;selected.phase='submitted';selected.pendingCorrect=true;
  lockInput();
  try{
    if(!free){progressRevision=await clearCorrection(db,selected.reviewKey,progressRevision);pendingCorrection=null;}
    // The original attempt has already been graded. Copying only completes
    // the current question; it must not update FSRS, recall gates or counts.
    selected.phase='result';
  }catch(error){
    if(error instanceof ProgressConflictError){
      await refreshProgress();current=null;
      if(!restoreCorrection())setCurrent(next());
      notify('其他页面已更新进度，已同步当前练习。');
    }else{selected.phase='correction';selected.input='';notify('订正未能保存，请再输入一次。');}
  }
  finally{busy=false;if(current===selected&&selected.phase==='result')advance();else{typeAhead='';render();}}
}
function queueTypeAhead(value){
  if(typeof value!=='string'||!busy||!((current?.phase==='submitted'&&current.pendingCorrect)||(savingTheme&&current?.phase==='typing'))||!/^[a-z]+$/i.test(value))return false;
  typeAhead=(typeAhead+value.toLowerCase()).slice(0,32);return true;
}
function drainTypeAhead(){
  while(typeAhead&&!busy&&route==='practice'&&current?.phase==='typing'){
    const letter=typeAhead[0];typeAhead=typeAhead.slice(1);
    const input=document.querySelector('#code-input');if(!input){typeAhead='';return;}
    input.value=current.input+letter;acceptInput(input);
  }
}
function selectRetainedInput(input){
  if(!input||!current?.replaceOnType||current.phase!=='correction')return false;
  input.setSelectionRange(0,input.value.length);input.scrollLeft=0;
  return true;
}
function replaceRetainedInput(input){
  if(!current?.replaceOnType||current.phase!=='correction')return false;
  current.replaceOnType=false;current.input='';input.value='';
  input.removeAttribute('aria-invalid');input.removeAttribute('aria-errormessage');
  input.closest('.entry-wrap').dataset.retainedError='false';
  document.querySelectorAll('.entry-slots span').forEach((slot,i)=>{slot.classList.remove('filled','mismatch');slot.classList.toggle('active',i===0);});
  document.querySelector('#attempt-status').textContent=t('照着答案输入');
  input.setSelectionRange(0,0);
  return true;
}
function acceptInput(input){
  if(!current||busy||!['typing','correction'].includes(current.phase))return;
  if(current.replaceOnType){const value=input.value;replaceRetainedInput(input);input.value=value;}
  const nativeSpace=current.item.commit==='space'&&/ $/.test(input.value);
  current.input=input.value.toLowerCase().replace(/[^a-z]/g,'').slice(0,current.item.code.length);
  input.value=displayCode(current.item,current.input);
  document.querySelectorAll('.entry-slots span').forEach((slot,i)=>{slot.classList.toggle('filled',i<current.input.length);slot.classList.toggle('active',i===current.input.length);});
  if(nativeSpace&&current.input.length===current.item.code.length-1){commitSpace();return;}
  if(current.input.length===current.item.code.length){
    if(current.phase==='typing')void submit();
    else if(current.input===current.item.code)void finishCorrection();
    else{current.replaceOnType=true;render();}
  }
}
async function undoLast(){
  if(free){
    if(busy)return;
    typeAhead='';lastCompletion=false;
    if(freeSession){
      if(!current||current.phase==='typing')freeSession.position=Math.max(0,freeSession.position-1);
      completed=freeSession.position;setCurrent(freeSelection());
    }else if(current){
      if(['result','correction'].includes(current.phase))completed=Math.max(0,completed-1);
      setCurrent({item:current.item,selfTest:current.selfTest});
    }
    render();return;
  }
  const entry=undoStack.at(-1);
  if(!entry||busy||!db)return;
  busy=true;clockPause();clearTimeout(hintTimer);typeAhead='';lastCompletion=false;
  let restored=false;
  try{
    progressRevision=await undoReview(db,entry,progressRevision);
    if(entry.card)cards[entry.id]=entry.card;else delete cards[entry.id];
    logs=logs.filter(log=>log.key!==entry.logKey);days[entry.daily.date]=entry.daily;
    selectionCache=null;
    completed=entry.completed;reviewOnly=entry.reviewOnly;
    current=structuredClone(entry.current);practiceTrack=current.track||'core';rememberTrack();current.item=itemOf(entry.id);current.input='';route='practice';free=false;practiceReturn=null;
    if(entry.answerExposed){current.revealed=true;answerExposure.remember(courseId,current.item);}
    shownAt=0;elapsedBeforePause=0;
    pendingCorrection=null;undoStack.pop();restored=true;
  }catch(error){
    if(error instanceof ProgressConflictError){
      await refreshProgress();current=null;
      if(!restoreCorrection())setCurrent(next());
      notify('其他页面已更新进度，本次撤销已取消。');
    }else notify('未能回到上一题，请重试。');
  }
  finally{busy=false;render({transition:restored});}
}
function subHeading(title,subtitle=''){return `<div class="page-heading"><div><h1 tabindex="-1">${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="quiet-button page-return" data-action="resume">返回练习 <kbd>Esc</kbd></button></div>`;}
function menuView(){
  return `<main class="page narrow menu-page">${subHeading('已暂停')}
    <div class="pause-summary"><span class="pause-target">${esc(current?.item.text||'潇明')}</span><div><p>${current?labels[current.item.type]:'继续学习'}</p><small>本轮 ${completed} 项，今日新学 ${today().newCount} 项</small></div></div>
    <button class="solid-button resume-button" data-action="resume"><span>继续练习</span><kbd>Esc</kbd></button>
    <div class="menu-links">${[['library','课程'],['roots','字根'],['dictionary','中英词典'],['stats','记录'],['settings','设置'],['help','操作说明']].map(([view,title])=>`<button data-action="navigate" data-view="${view}">${title}</button>`).join('')}</div>
    <div class="track-choices" aria-label="训练内容">${Object.entries(TRACKS).filter(([key])=>key==='core'||dataset.transferItems?.some(item=>item.type===key)).map(([key,title])=>'<button class="plain-button" data-action="track" data-track="'+key+'" aria-pressed="'+(practiceTrack===key)+'">'+title+(key==='core'?'':' · '+num(dataset.transferStats[key]))+'</button>').join('')}</div>
    <div class="menu-actions"><button data-action="export">导出进度</button>${Object.keys(cards).length?'<button data-action="review">复习已练内容</button>':''}${undoStack.length?'<button data-action="undo">回到上一题</button>':''}</div>
  </main>`;
}
function stateOf(item){const card=cardFor(cards,item);return !item.code?'暂不可练':!card?'未练过':!card.verified?'待巩固':new Date(card.due)<=new Date()?'已到期':'已独立完成';}
let searchCache=new WeakMap();
const englishSearchCache=new WeakMap();
function searchable(item){if(!searchCache.has(item))searchCache.set(item,`${item.text} ${item.pinyin} ${item.displayPinyin||''} ${item.zhuyin||''} ${item.code||''} ${item.fullCode||''} ${(item.aliases||[]).join(' ')}`.toLowerCase());return searchCache.get(item);}
function englishSearchable(item){
  if(!dictionary||!['char','word','short','variant'].includes(item.type))return '';
  if(!englishSearchCache.has(item))englishSearchCache.set(item,dictionary.lookup(item.text,courseId).map(id=>dictionary.entries[id][3].join(' ')).join(' ').toLowerCase());
  return englishSearchCache.get(item);
}
function matches(){const q=search.trim().toLowerCase(),english=/[a-z]/i.test(q);return items.filter(item=>(filter==='all'||item.type===filter)&&(stateFilter==='all'||(stateFilter==='new'?!cardFor(cards,item):stateFilter==='learned'?!!cardFor(cards,item):!item.code))&&(!q||searchable(item).includes(q)||String(item.order)===q||(english&&englishSearchable(item).includes(q))));}
function libraryActions(rows){
  const playable=rows.filter(item=>item.code).length,unavailable=rows.length-playable;
  return `<section class="filtered-practice" aria-label="练习筛选结果"><p class="filtered-practice-count" role="status"><span>${num(playable)} 项可练</span>${unavailable?'<small>'+num(unavailable)+' 项暂不可练</small>':''}</p><p class="sr-only" id="filtered-practice-note">练习当前筛选结果中的全部可练课程，包含所有分页；不计入学习进度。</p><div class="filtered-practice-actions"><button class="quiet-button course-action" data-action="free-test" aria-describedby="filtered-practice-note" ${playable?'':'disabled'}>无提示自测</button><button class="quiet-button course-action" data-action="free" aria-describedby="filtered-practice-note" ${playable?'':'disabled'}>自由练习</button></div></section>`;
}
function libraryRows(){
  const rows=matches(),pages=Math.max(1,Math.ceil(rows.length/30));page=Math.min(page,pages);
  return `${libraryActions(rows)}<div class="table-wrap"><table class="course-table" aria-label="学习路径"><thead><tr>${['顺序','类型','内容','编码','状态','<span class="sr-only">操作</span>'].map(title=>`<th scope="col">${title}</th>`).join('')}</tr></thead><tbody>${rows.slice((page-1)*30,page*30).map(libraryRow).join('')||'<tr class="empty-row"><td class="empty-state" colspan="6"><p>没有匹配内容</p><button class="plain-button" data-action="reset-filters">重置筛选</button></td></tr>'}</tbody></table></div>${pages>1?`<div class="pagination"><span>${num((page-1)*30+1)}–${num(Math.min(page*30,rows.length))} / ${num(rows.length)}</span><span><button data-action="page" data-delta="-1" ${page===1?'disabled':''}>上一页</button> ${page} / ${pages} <button data-action="page" data-delta="1" ${page===pages?'disabled':''}>下一页</button></span></div>`:''}`;
}
function libraryRow(item){
  const reading=readingMarkup(item,esc);
  return `<tr><td class="muted" title="第 ${item.order} 项课程">${item.order}</td><td>${labels[item.type]}</td><td><span class="mobile-item-meta">${item.order} · ${labels[item.type]}</span><strong class="table-text root-font">${esc(item.text)}</strong>${reading?`<small>${reading}</small>`:''}</td><td class="mono" ${item.code?`data-answer-id="${item.id}"`:''}>${item.code?inlineCode(item):'—'}</td><td>${stateOf(item)}</td><td><button class="plain-button" data-action="detail" data-id="${item.id}" aria-label="查看 ${esc(item.text)}">查看</button></td></tr>`;
}
function libraryView(){return `<main class="page library-page">${subHeading('课程')}<div class="toolbar"><label class="search-field" for="search">搜索<input id="search" name="query" type="search" autocomplete="off" spellcheck="false" placeholder="字词、英文、读音或编码…" value="${esc(search)}"></label><label for="type-filter">类型<select id="type-filter" name="type">${[['all','全部类型'],...Object.entries(labels)].map(([value,title])=>`<option value="${value}" ${filter===value?'selected':''}>${title}</option>`).join('')}</select></label><label for="state-filter">学习状态<select id="state-filter" name="state">${[['all','全部状态'],['new','未练过'],['learned','已练过'],['unsupported','暂不可练']].map(([value,title])=>`<option value="${value}" ${stateFilter===value?'selected':''}>${title}</option>`).join('')}</select></label></div><div id="library-results">${libraryRows()}</div></main>`;}

function rootKeys(){return ['all',...[...new Set(items.filter(item=>item.type==='root').map(item=>item.code[0]))].sort()];}
function rootResults(){
  const q=rootSearch.trim().toLowerCase(),roots=items.filter(item=>item.type==='root'&&(rootKey==='all'||item.code[0]===rootKey)&&(!q||searchable(item).includes(q)));
  return roots.length?`<div class="root-grid">${[...new Set(roots.map(item=>item.code[0]))].sort().map(key=>{const group=roots.filter(item=>item.code[0]===key);return `<section class="root-group"><h2>${key.toUpperCase()}<small>${group.length} 根</small></h2><div>${group.map(item=>`<button data-action="detail" data-id="${item.id}" data-answer-id="${item.id}" aria-label="${esc(item.text)}，${displayCode(item,item.fullCode,true)}" title="${esc(item.pinyin)}"><strong class="root-font">${esc(item.text)}</strong><small>${coloredCode(item.fullCode)}</small></button>`).join('')}</div></section>`;}).join('')}</div>`:'<p class="root-empty">没有匹配字根，可切换键位或调整搜索。</p>';
}
function updateRoots(){document.querySelector('#root-results').innerHTML=rootResults();localize(document.querySelector('#root-results'));document.querySelectorAll('[data-action="root-key"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.key===rootKey)));}
function rootsView(){return `<main class="page">${subHeading('字根')}<div class="toolbar"><label class="search-field" for="root-search">查找字根<input id="root-search" name="query" type="search" autocomplete="off" spellcheck="false" placeholder="字形、读音或完整编码…" value="${esc(rootSearch)}"></label></div><div class="root-key-index" role="group" aria-label="按大码筛选字根">${rootKeys().map(key=>`<button data-action="root-key" data-key="${key}" aria-pressed="${rootKey===key}" title="${key==='all'?'全部字根':key.toUpperCase()+' 键字根，可用方向键切换'}">${key==='all'?'全部':key.toUpperCase()}</button>`).join('')}</div><div id="root-results">${rootResults()}</div></main>`;}
function statsView(){const verified=Object.values(cards).filter(card=>index.has(card.id)&&!index.get(card.id).practiceAlias&&card.verified),recalls=logs.filter(log=>!log.firstExposure&&!log.guided),correct=recalls.filter(log=>log.firstTry).length;return `<main class="page">${subHeading('练习记录')}<div class="stat-grid"><div><small>已独立完成</small><strong>${num(verified.length)}</strong></div><div><small>累计输入</small><strong>${num(logs.length)}</strong></div><div><small>无提示正确率</small><strong>${recalls.length?Math.round(correct/recalls.length*100)+'%':'—'}</strong></div><div><small>待复习</small><strong>${dueCount()}</strong></div></div><div class="table-wrap"><table><thead><tr><th>内容</th><th>过程</th><th>用时</th><th>删改 / 提示</th><th>判定</th></tr></thead><tbody>${logs.slice(-30).reverse().map(log=>`<tr><td class="table-text root-font">${esc(itemOf(log.itemId)?.text)}</td><td>${log.automatic?(log.firstExposure?'首次认识':log.supplemental?'巩固练习':'间隔复习'):'练习'}${log.skill==='short'?' · 简码':log.skill==='variant'?' · 台湾字形':''}</td><td>${((log.elapsedMs??(log.seconds||0)*1000)/1000).toFixed(1)}s</td><td>${log.backspaces||0} / ${log.hintCount||Number(log.hinted)||0}</td><td>${log.supplemental&&!log.scheduleUpdated?(log.correct?'巩固完成':log.outcome==='blank'?'已看答案':'错码'):log.outcome==='incorrect'?'错码 · 重学':log.outcome==='blank'?'已看答案 · 重学':log.firstExposure?'安排巩固':grades[log.grade]}</td></tr>`).join('')||'<tr><td colspan="5">完成输入后，这里会记录你的练习。</td></tr>'}</tbody></table></div></main>`;}
function offlineSummary(){return !courseCacheSaved?'课程尚未保存，请保持联网。':document.documentElement.dataset.offline==='ready'?'课程已保存，可离线练习。':document.documentElement.dataset.offline==='unavailable'?'课程已保存，离线启动暂不可用。':'课程已保存，正在准备离线页面…';}
document.addEventListener('xiaoming-offline-state',()=>{const note=document.querySelector('#offline-summary');if(note)note.textContent=t(offlineSummary());});
function settingsView(){
  return `<main class="page narrow">${subHeading('设置')}
    <form id="settings-form">
      <fieldset class="settings-group"><legend>学习节奏</legend>
      <label class="setting" for="new-per-day"><span><strong id="new-per-day-label">每日新学目标</strong><small id="new-per-day-note">达到目标后仍会继续练习</small></span><span><input id="new-per-day" aria-labelledby="new-per-day-label" aria-describedby="new-per-day-note" name="newPerDay" type="number" min="1" max="200" step="1" value="${settings.newPerDay}" required> 项</span></label>
      <label class="setting" for="retention"><span><strong id="retention-label">目标记忆保持率</strong><small id="retention-note">目标越高，通常需要更频繁地复习</small></span><span><input id="retention" aria-labelledby="retention-label" aria-describedby="retention-note" name="retention" type="number" min="80" max="97" step="1" value="${Math.round(settings.retention*100)}" required> %</span></label>
      </fieldset>
      <button class="solid-button" type="submit">保存</button>
    </form>
    <section class="backup-section"><h2>学习进度</h2><p id="offline-summary" role="status">${offlineSummary()}</p><p>进度保存在当前浏览器。换设备或清理网站数据前，请先导出备份。</p><div><button class="plain-button" data-action="export">导出备份</button><button class="plain-button" data-action="import">导入备份</button></div><input id="backup-input" aria-label="选择进度备份" type="file" accept=".json,application/json" hidden></section>
  </main>`;
}
function helpView(){
  const undoHint=free?(freeSession?'回溯或重输题目，不改学习进度。':'清空当前输入，重新练习。'):'撤销上一题的记录，回到上一题。';
  return `<main class="page narrow prose">${subHeading('操作说明')}
    <section class="help-section"><h2>怎么练</h2>
      <p>从声母、首笔和字根开始，逐步练习汉字与词语。初次显示编码，之后尝试独立输入；输完编码会自动判定。答错或看过答案后，照着订正再继续。</p>
      <p><span class="role-a">大码 A</span> 记字根键位，<span class="role-s">小码 S</span> 按声母取码，<span class="role-b">补码 B</span> 按首笔取码。字根不取读音时，S 与 B 相同。大码显示为大写，小码和补码显示为小写；输入时都可用小写。</p>
      <p>“取码说明”可查看每一码的来由；台湾字形课还可打开“字形对照”。</p>
    </section>
    <section class="help-section"><h2>常用按键</h2>
      <dl class="shortcut-list">
        <div><dt><kbd>空格</kbd></dt><dd>未输入编码时看答案；末位标有“空格”时，输入字母后按空格提交。</dd></div>
        <div><dt><kbd>Tab</kbd></dt><dd>编码隐藏时，短暂提示下一码。</dd></div>
        <div><dt><kbd>;</kbd></dt><dd>查看当前字词的英文释义。</dd></div>
        <div><dt><kbd>Ctrl+Z</kbd></dt><dd>${undoHint}Mac 使用 ⌘Z。</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>暂停或返回练习；有弹窗时先关闭弹窗。</dd></div>
      </dl>
    </section>
    <section class="help-section"><h2>课程与自测</h2>
      <p>暂停菜单可切换完整取码、简码训练和台湾字形。简码、字形课会先练所需的基础内容；简繁课程分别记录进度。</p>
      <p>课程页可搜索并按类型、学习状态筛选。“自由练习”显示编码，“无提示自测”隐藏编码；两者练习全部筛选结果，包含其他分页，跳过暂不可练项，不计入学习进度。详情中的“练习此项”只练当前一项。</p>
    </section>
    <section class="help-section"><h2>进度与备份</h2>
      <p>首次作答的结果用于安排复习，订正不会把错题改为答对。用过提示、取码说明或看过答案的题，仍需无提示完成。</p>
      <p>进度保存在当前浏览器。换设备、浏览器或清理网站数据前，在“设置”中导出备份，再到新浏览器导入。</p>
    </section>
  </main>`;
}
function closeDialog(){overlay.innerHTML='';app.inert=false;document.body.style.overflow='';pendingImport=null;if(route==='practice'){clockResume();document.querySelector('#code-input')?.focus();}else if(dialogOpener?.isConnected)dialogOpener.focus({preventScroll:true});dialogOpener=null;}
function dialog(title,body,actions='',kind=''){clockPause();typeAhead='';if(!overlay.firstChild)dialogOpener=document.activeElement;overlay.innerHTML=`<div class="dialog-backdrop"><section class="dialog ${kind}" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>${body}<div class="dialog-actions">${actions}</div></section></div>`;localize(overlay);app.inert=true;document.body.style.overflow='hidden';overlay.querySelector('.dialog').focus();}
function dependencyName(item){return item?.type==='initial'?'声母 '+item.text:item?.type==='stroke'?strokeLabels[item.strokeKey]:item?.text||'';}
function detail(id){
  const item=itemOf(id);if(!item)return;publishExposure(item);
  const prerequisites=item.dependencies.map(dep=>'<span class="root-font">'+esc(dependencyName(itemOf(dep)))+'</span>').join('、');
  dialog(item.type==='variant'?'台湾字形':labels[item.type],`<div class="detail-target root-font">${item.type==='variant'?targetMarkup(item):esc(item.text)}</div><p class="detail-pinyin">${readingMarkup(item,esc,{all:true})}<span>${stateOf(item)}</span></p>${item.code?`${parts(item)}${codeRow(item,true)}`:'<p>含字母或符号，暂不支持这类词语的编码练习。</p>'}${item.code?'<p class="detail-teaching-actions"><button class="plain-button" data-action="derivation" data-id="'+id+'">取码说明</button>'+((item.type==='char'||item.type==='variant')&&dataset.glyphVariants?.[item.text]?'<button class="plain-button" data-action="glyph" data-id="'+id+'">字形对照</button>':'')+'</p>':''}${meaningSection(item)}${prerequisites?'<p class="detail-note">先学：'+prerequisites+'</p>':''}`,item.code?`<button class="solid-button" data-action="free-one" data-id="${id}">练习此项</button>`:'');
}
function restorePractice(){
  typeAhead='';free=false;
  if(freeSession){({search,filter,stateFilter,page}=freeSession.library);freeSession=null;}
  if(practiceReturn){current=practiceReturn.current;completed=practiceReturn.completed;reviewOnly=practiceReturn.reviewOnly;lastCompletion=practiceReturn.lastCompletion;elapsedBeforePause=practiceReturn.elapsedMs;shownAt=0;practiceReturn=null;}
  else setCurrent(null);
}
function freeSelection(){
  const id=freeSession?.ids[freeSession.position];
  return id?{item:itemOf(id),selfTest:freeSession.selfTest}:null;
}
function startFree(id=null,selfTest=false){
  const selected=id?[itemOf(id)]:matches().filter(item=>item.code);
  if(!selected.length||selected.some(item=>!item?.code))return;
  closeDialog();clockPause();
  if(!free)practiceReturn={current,completed,reviewOnly,lastCompletion,elapsedMs:elapsedBeforePause};
  freeSession=id?null:{ids:selected.map(item=>item.id),position:0,selfTest,library:{search,filter,stateFilter,page,scrollY:window.scrollY}};
  free=true;completed=0;lastCompletion=false;route='practice';
  setCurrent(freeSession?freeSelection():{item:selected[0],isNew:true,selfTest});render({transition:true});window.scrollTo({top:0});
}
function exitFree(){
  const origin=freeSession?.library,action=freeSession?.selfTest?'free-test':'free';
  restorePractice();navigate('library');
  if(origin){document.querySelector('[data-action="'+action+'"]')?.focus({preventScroll:true});window.scrollTo({top:origin.scrollY});}
}
function restartFree(){
  if(!freeSession)return;
  freeSession.position=0;completed=0;lastCompletion=false;
  setCurrent(freeSelection());render({transition:true});
}
async function exportBackup(){
  try{
    // Read a committed snapshot, including work saved by another tab.
    const progress=db?await readProgress(db):{cards:Object.values(cards),logs,daily:Object.values(days),settings};
    const backup={app:'xiaoming-study',version:3,lessonVersion:dataset.lessonVersion,course:courseId,datasetSha:dataset.source.sha256,curriculumVersion:dataset.curriculumVersion,exportedAt:new Date().toISOString(),cards:progress.cards,logs:progress.logs,daily:progress.daily,settings:progress.settings||settings};
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`潇明习字_${COURSES[courseId].name}_学习备份_${dayKey()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('备份已导出。');
  }catch(error){notify('备份未能导出，请重试。');}
}
async function importFile(file){
  if(!file)return;
  if(!db){notify('进度无法保存，请检查浏览器的网站数据设置。');return;}
  if(file.size>200*1024*1024){notify('备份文件过大，请选择导出的进度备份。');return;}
  let value;
  try{value=JSON.parse(await file.text());}
  catch{notify('文件格式不正确，请选择导出的进度备份。');return;}
  let backup;
  try{backup=validateBackup(value,items,dataset.source.sha256,courseId);}
  catch(error){notify(error.message);return;}
  dialog('恢复学习进度',`<p>将恢复 ${num(backup.cards.length)} 项课程记录和 ${num(backup.logs.length)} 次作答。当前${COURSES[courseId].name}课程的进度将被替换。</p>`,`<button class="plain-button" data-action="export">先导出当前进度</button><button class="solid-button" data-action="confirm-import">替换并恢复</button>`);
  pendingImport=backup;
}
async function confirmImport(){
  if(!pendingImport||!db||busy)return;
  busy=true;const backup=pendingImport;
  try{
    const revision=await replaceProgress(db,backup,progressRevision);
    adoptProgress({...backup,revision});freeSession=null;free=false;reviewOnly=false;current=null;practiceReturn=null;undoStack=[];
    closeDialog();enterPractice();notify('已恢复进度');
  }catch(error){
    if(error instanceof ProgressConflictError){await refreshProgress();closeDialog();notify('其他页面已更新进度，请重新选择备份后恢复。');}
    else notify('恢复失败，原进度已保留。请重试。');
  }finally{busy=false;render();}
}

document.addEventListener('pointerdown',event=>{
  if(event.target.id==='code-input'&&current?.replaceOnType&&event.button===0){
    event.preventDefault();event.target.focus({preventScroll:true});selectRetainedInput(event.target);
  }
});
document.addEventListener('click',event=>{
  if(event.target.closest('.skip-link')){event.preventDefault();(document.querySelector('#code-input')||document.querySelector('main h1')||document.querySelector('main'))?.focus({preventScroll:true});return;}
  if(event.target.id==='code-input')selectRetainedInput(event.target);
  const button=event.target.closest('[data-action]');
  if(!button&&route==='practice'&&!overlay.firstChild&&event.target.closest('.practice')&&!event.target.closest('input,button,a,select,label')&&window.getSelection()?.isCollapsed)document.querySelector('#code-input')?.focus({preventScroll:true});
  if(button?.tagName==='A'){if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();}
  if(!button||button.disabled||busy)return;
  const {action,id,view}=button.dataset;
  if(action==='reload'){app.innerHTML='<main class="loading" id="main-content"><div class="brand-symbol">潇</div><h1 id="loading-status" role="status">正在打开课程…</h1><progress id="download-progress" max="100" value="0" aria-label="课程下载进度" hidden></progress></main>';void initialize();return;}
  else if(action==='theme')void toggleTheme();
  else if(action==='course')void switchCourse(courseId==='simplified'?'traditional':'simplified');
  else if(action==='skip')void submit(true);
  else if(action==='navigate')navigate(view);
  else if(action==='resume'){
    const continuing=route==='menu'&&button.classList.contains('resume-button');
    if(!continuing){if(free)restorePractice();reviewOnly=false;}
    enterPractice();
  }
  else if(action==='review'){if(free)restorePractice();free=false;reviewOnly=true;setCurrent(null);enterPractice();}
  else if(action==='detail')detail(Number(id));
  else if(action==='meaning')openMeaning();
  else if(action==='track')switchTrack(button.dataset.track);
  else if(action==='derivation')openDerivation(id?Number(id):current?.item.id);
  else if(action==='glyph')openGlyph(Number(id));
  else if(action==='explain-step')highlightDerivation(button);
  else if(action==='dictionary-entry')openDictionaryEntry(Number(button.dataset.entry));
  else if(action==='dictionary-retry')void prepareDictionary();
  else if(action==='disclosure'){const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));document.getElementById(button.getAttribute('aria-controls')).hidden=expanded;}
  else if(action==='dictionary-page'){dictionaryPage+=Number(button.dataset.delta);refreshDictionaryResults();document.querySelector('#dictionary-search')?.focus();window.scrollTo({top:0});}
  else if(action==='free')startFree();
  else if(action==='free-test')startFree(null,true);
  else if(action==='free-one')startFree(Number(id));
  else if(action==='free-again'&&free)restartFree();
  else if(action==='free-exit'&&free)exitFree();
  else if(action==='close-dialog')closeDialog();
  else if(action==='undo')void undoLast();
  else if(action==='export')void exportBackup();
  else if(action==='import')document.querySelector('#backup-input').click();
  else if(action==='confirm-import')void confirmImport();
  else if(action==='page'){page+=Number(button.dataset.delta);document.querySelector('#library-results').innerHTML=libraryRows();localize(document.querySelector('#library-results'));syncLocation();}
  else if(action==='reset-filters'){search='';filter='all';stateFilter='all';page=1;render();document.querySelector('#search')?.focus({preventScroll:true});}
  else if(action==='root-key'){rootKey=button.dataset.key;updateRoots();}
});
document.addEventListener('focusin',event=>{
  if(event.target.matches('.derivation-step'))highlightDerivation(event.target);
  if(event.target.id==='code-input')selectRetainedInput(event.target);
});
document.addEventListener('beforeinput',event=>{
  if(event.target.id!=='code-input'||!current)return;
  if(event.data===' '&&current.item.code.endsWith('_')){event.preventDefault();if(!busy)commitSpace();return;}
  if(event.inputType==='historyUndo'){event.preventDefault();void undoLast();return;}
  if(busy&&event.inputType==='insertText'&&!event.isComposing){queueTypeAhead(event.data);event.preventDefault();return;}
  if(busy||!['typing','correction'].includes(current.phase)){event.preventDefault();return;}
  if(current.phase==='correction'){
    if(current.replaceOnType){
      if(event.inputType?.startsWith('insert')){
        if(event.data==null||/[a-z]/i.test(event.data)||event.isComposing)replaceRetainedInput(event.target);else event.preventDefault();
      }
      else if(event.inputType?.startsWith('delete')){replaceRetainedInput(event.target);event.preventDefault();}
    }
    return;
  }
  if(event.inputType?.startsWith('delete')||event.inputType==='historyUndo')current.backspaces++;
  if(event.inputType==='insertFromPaste')current.pasted=true;
});
document.addEventListener('paste',event=>{
  if(event.target.id!=='code-input')return;
  if(busy||!['typing','correction'].includes(current?.phase))event.preventDefault();
  else if(current.phase==='typing')current.pasted=true;
  else if(current.replaceOnType){
    if(/[a-z]/i.test(event.clipboardData?.getData('text')||''))replaceRetainedInput(event.target);
    else event.preventDefault();
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='code-input'&&!event.isComposing)acceptInput(event.target);
  else if(event.target.id==='search'){search=event.target.value;page=1;document.querySelector('#library-results').innerHTML=libraryRows();localize(document.querySelector('#library-results'));syncLocation();}
  else if(event.target.id==='root-search'){rootSearch=event.target.value;updateRoots();}
  else if(event.target.id==='dictionary-search'){dictionarySearch=event.target.value;dictionaryPage=1;clearTimeout(dictionaryTimer);dictionaryTimer=setTimeout(refreshDictionaryResults,120);}
});
document.addEventListener('compositionend',event=>{
  if(event.target.id==='code-input')acceptInput(event.target);
});
document.addEventListener('change',event=>{
  if(event.target.id==='type-filter'){filter=event.target.value;page=1;document.querySelector('#library-results').innerHTML=libraryRows();localize(document.querySelector('#library-results'));syncLocation();}
  else if(event.target.id==='state-filter'){stateFilter=event.target.value;page=1;document.querySelector('#library-results').innerHTML=libraryRows();localize(document.querySelector('#library-results'));syncLocation();}
  else if(event.target.id==='backup-input'){void importFile(event.target.files[0]);event.target.value='';}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='settings-form')return;
  event.preventDefault();
  if(!db)return notify('进度无法保存，请检查浏览器的网站数据设置。');
  const form=new FormData(event.target);
  const updated=cleanSettings({newPerDay:Number(form.get('newPerDay')),retention:Number(form.get('retention'))/100,pinyin:true,keyboard:false,theme:settings.theme});
  if(savingTheme)await themeSave.catch(()=>{});
  if(busy)return;busy=true;
  try{await persistSettings(updated);render();notify('已保存');}
  catch(error){notify('设置未能保存，请重试。');}
  finally{busy=false;render();}
});
document.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(overlay.firstChild){
    if(event.key==='Escape'){event.preventDefault();closeDialog();}
    trapDialogTab(event,overlay.querySelector('.dialog'));
    return;
  }
  if(!dataset)return;
  if(event.key==='Escape'){
    event.preventDefault();
    if(route==='practice')navigate('menu');else enterPractice();
    return;
  }
  if(route==='menu'&&['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();const buttons=[...document.querySelectorAll('main button:not(:disabled)')],position=buttons.indexOf(document.activeElement);
    buttons[(position+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();return;
  }
  if(route==='roots'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,select')){
    const keys=rootKeys();let selected=null;
    if(event.target.matches('[data-action="root-key"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      const position=keys.indexOf(rootKey);selected=event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[(position+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length];
    }else if(/^[a-z]$/i.test(event.key)&&keys.includes(event.key.toLowerCase()))selected=event.key.toLowerCase();
    if(selected){event.preventDefault();rootKey=selected;updateRoots();document.querySelector(`[data-action="root-key"][data-key="${selected}"]`)?.focus();return;}
  }
  if(route==='practice'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='z'){
    event.preventDefault();if(!event.repeat)void undoLast();return;
  }
  if(route!=='practice'||event.target.id!=='code-input')return;
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key===';'&&!busy&&dictionary&&['char','word','short','variant'].includes(current?.item.type)){
    event.preventDefault();if(!event.repeat)openMeaning();return;
  }
  if(savingTheme&&!event.repeat&&(event.key===' '||event.key==='Tab'&&!event.shiftKey)){
    event.preventDefault();
    const selected=current,key=event.key;
    void themeSave.catch(()=>{}).then(()=>{
      if(current!==selected||route!=='practice'||overlay.firstChild||busy||current?.phase!=='typing'||document.activeElement?.id!=='code-input')return;
      if(key==='Tab')hintNext();
      else if(current.input&&current.item.code.endsWith('_'))commitSpace();
      else if(!current.input)void submit(true);
    });
    return;
  }
  if(busy||!['typing','correction'].includes(current?.phase)){
    if(!event.repeat&&/^[a-z]$/i.test(event.key))queueTypeAhead(event.key);
    if(event.key!=='Tab')event.preventDefault();
    return;
  }
  if(current.replaceOnType&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();selectRetainedInput(event.target);return;
  }
  if(current.replaceOnType&&!event.repeat&&(/^[a-z]$/i.test(event.key)||event.key==='Backspace'||event.key==='Delete')){
    replaceRetainedInput(event.target);
    if(event.key==='Backspace'||event.key==='Delete')event.preventDefault();
  }
  if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();if(!event.repeat)hintNext();}
  else if(event.key===' '){event.preventDefault();if(!event.repeat){if(current.input&&current.item.code.endsWith('_'))commitSpace();else if(current.phase==='typing'&&!current.input)void submit(true);}}
  else if(event.key==='Enter'||(event.repeat&&/^[a-z]$/i.test(event.key)))event.preventDefault();
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)clockPause();
  else if(route==='practice'){
    if(!current&&!free)enterPractice();else clockResume();
  }
});
window.addEventListener('blur',()=>{windowActive=false;clockPause();});
window.addEventListener('focus',()=>{windowActive=true;clockResume();});
async function loadCourse(id){
  let data=courseDatasets.get(id);
  if(!data){
    clearTimeout(toastTimer);data=await resourceStore.load(id,{onStatus:state=>{
      const name=id==='traditional'?'繁中课程':'简中课程';
      const text=state.phase==='downloading'?`正在下载${name}… ${Math.min(100,Math.floor(state.received/state.total*100))}%`:state.phase==='switching'?'连接较慢，正在尝试其他来源…':state.phase==='verifying'?'正在检查课程…':state.phase==='ready'?'正在准备练习…':`正在打开${name}…`;
      const status=document.querySelector('#loading-status');
      if(status&&status.textContent!==t(text))status.textContent=t(text);
      const bar=document.querySelector('#download-progress');if(bar&&state.phase==='downloading'){bar.hidden=false;bar.value=state.received/state.total*100;}
      if(!status){const toast=document.querySelector('#toast');if(toast.textContent!==t(text))toast.textContent=t(text);toast.classList.add('visible');}
      if(state.phase==='ready')courseCacheStates.set(id,state.persisted);
    }});
    courseDatasets.set(id,data);
  }
  let database=null,progress={cards:[],logs:[],daily:[],settings:null};
  try{database=await openDatabase(id);progress=await readProgress(database);}
  catch{database?.close();database=null;}
  return {data,database,progress};
}
function adoptCourse({data,database,progress},{keepTheme=false}={}){
  courseCacheSaved=courseCacheStates.get(data.course)??false;dataset=data;items=allLessons(data);index=itemIndex(items);db=database;rootFacts=new Map(data.items.filter(item=>item.type==='root').map(item=>[item.text,item]));
  try{practiceTrack=localStorage.getItem('xiaoming-track:'+courseId)||'core';}catch{practiceTrack='core';}
  if(!TRACKS[practiceTrack]||!practicePool(data,practiceTrack).length)practiceTrack='core';
  adoptProgress(progress,{keepTheme});
  storageError=[database?'':'进度无法保存，请检查浏览器的网站数据设置。',courseCacheSaved?'':'课程尚未保存到此浏览器，暂时无法保证离线使用。'].filter(Boolean).join(' ');
}
function adoptProgress(progress,{keepTheme=false}={}){
  selectionCache=null;
  progressRevision=progress.revision??0;
  cards=Object.fromEntries(progress.cards.map(card=>[card.id,card]));logs=progress.logs;
  days=Object.fromEntries(progress.daily.map(day=>[day.date,day]));
  settings=cleanSettings({...progress.settings,theme:keepTheme?document.documentElement.dataset.theme:progress.settings?.theme||document.documentElement.dataset.theme});
  pendingCorrection=null;
  const pending=progress.pendingCorrection;
  if(pending?.undo?.current&&['incorrect','blank'].includes(pending.outcome)&&logs.some(log=>log.key===pending.undo.logKey&&log.itemId===pending.undo.id))pendingCorrection=pending;
}
async function refreshProgress(){
  const progress=await readProgress(db);
  if(progress.revision===progressRevision)return;
  adoptProgress(progress,{keepTheme:true});undoStack=[];
  courseSessions.delete(courseId);
}
async function persistSettings(changes){
  for(let retry=0;retry<3;retry++){
    const updated=cleanSettings({...settings,...changes});
    try{progressRevision=await saveSettings(db,updated,progressRevision);settings=updated;return;}
    catch(error){if(!(error instanceof ProgressConflictError)||retry===2)throw error;await refreshProgress();}
  }
}
async function switchCourse(id){
  if(!COURSES[id]||id===courseId)return;
  if(busy)return;
  const previousId=courseId,previousDb=db;
  busy=true;clockPause();clearTimeout(hintTimer);typeAhead='';lockInput();
  const toggle=document.querySelector('#course-toggle');toggle.disabled=true;toggle.setAttribute('aria-busy','true');
  let loaded;
  try{
    loaded=await loadCourse(id);
    await setLocale(id);
    courseSessions.set(previousId,{library:{search,filter,stateFilter,page},current,free,freeSession,completed,undoStack,pendingCorrection,reviewOnly,practiceReturn,elapsedBeforePause,lastCompletion,practiceTrack,revision:progressRevision});
    courseId=id;adoptCourse(loaded,{keepTheme:true});previousDb?.close();
    const cachedSession=courseSessions.get(id),session=cachedSession?.revision===progressRevision?cachedSession:null;
    current=session?.current||null;free=session?.free||false;freeSession=session?.freeSession||null;
    completed=session?.completed||0;undoStack=session?.undoStack||[];reviewOnly=session?.reviewOnly||false;
    practiceReturn=session?.practiceReturn||null;elapsedBeforePause=session?.elapsedBeforePause||0;shownAt=0;lastCompletion=session?.lastCompletion||false;
    if(session){pendingCorrection=session.pendingCorrection;practiceTrack=session.practiceTrack||'core';}
    ({search,filter,stateFilter,page}=session?.library||{search:'',filter:'all',stateFilter:'all',page:1});
    rootSearch='';rootKey='all';route='practice';
    if(!current&&!free&&!restoreCorrection())setCurrent(next());
    try{localStorage.setItem('xiaoming-course',id);}catch{}
    clearTimeout(toastTimer);document.querySelector('#toast').classList.remove('visible');document.querySelector('#toast').textContent='';
  }catch(error){if(loaded?.database!==db)loaded?.database?.close();await setLocale(previousId);notify('课程切换失败，请重试。');}
  finally{busy=false;render();}
}
async function initialize(){
  try{
    await setLocale(courseId);adoptCourse(await loadCourse(courseId));
    if(!restoreCorrection())setCurrent(next());
    render();
    const toast=document.querySelector('#toast');toast.classList.remove('visible');toast.textContent='';
  }catch(error){console.error('Course initialization failed',error);app.innerHTML=`<main class="loading" id="main-content" tabindex="-1"><div class="brand-symbol">潇</div><h1>课程暂时无法加载</h1><p role="alert">请检查网络后重试。已保存的课程和学习进度不会被清除。</p><button class="solid-button" data-action="reload">重新加载</button></main>`;}
}
initialize();
