import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyRating,dayKey} from '../public/engine.mjs';
import {displayCode} from '../public/encoding.mjs';

const data=await loadCourse('simplified');
const index=new Map(data.items.map(item=>[item.id,item]));
const roots=data.items.filter(item=>item.type==='root').slice(0,3);
const foundations=data.items.filter(item=>['initial','stroke','rule'].includes(item.type));
const first=data.items[0],errors=[],external=[];
const base=process.env.TEST_URL||'http://127.0.0.1:47831';
await mkdir('artifacts',{recursive:true});
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,locale:'zh-CN'});
const page=await context.newPage();page.setDefaultTimeout(10000);
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(!request.url().startsWith(base))external.push(request.url());});
async function progress(){return page.evaluate(async()=>{const store=await import('/storage.mjs'),db=await store.openDatabase();const result=await store.readProgress(db);db.close();return result;});}
async function count(expected){await page.waitForFunction(async expected=>{const store=await import('/storage.mjs'),db=await store.openDatabase();const result=await store.readProgress(db);db.close();return result.logs.length===expected;},expected);}
async function ready(){await page.locator('.practice[data-phase="typing"] #code-input').waitFor();assert.equal(await page.locator('.completion').count(),0);}
async function current(){await ready();return index.get(Number(await page.locator('.practice').getAttribute('data-item-id')));}
async function type(code){const expected=(await progress()).logs.length+1;await ready();await page.keyboard.type(code,{delay:25});await count(expected);return expected;}
async function settings(){await page.locator('[data-view="settings"]').first().click();await page.locator('#settings-form').waitFor();}
async function install(backup){await settings();await page.locator('#backup-input').setInputFiles({name:'test-progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('[data-action="confirm-import"]').click();await ready();}
async function knownOnly(){await page.keyboard.press('Escape');await page.locator('[data-action="review"]').click();await ready();}
const letters=()=>page.locator('#prompt-code [data-code-position] b').allTextContents();
async function assertReplacementSelection(){
  const state=await page.locator('#code-input').evaluate(input=>({start:input.selectionStart,end:input.selectionEnd,length:input.value.length,caret:getComputedStyle(input).caretColor,scroll:input.scrollLeft}));
  assert.equal(state.start,0);assert.equal(state.end,state.length);assert.equal(state.caret,'rgba(0, 0, 0, 0)');assert.equal(state.scroll,0);
}
function cardFor(item,verified=true){return {...applyRating(null,1,new Date()).card,id:item.id,verified,holdUntilDue:false,cleanRecalls:0,due:new Date(Date.now()+3600000).toISOString()};}
function snapshot({rootVerified=true,rootHeld=false,newCount=20,newLimit=20}={}){
  return {app:'xiaoming-study',version:3,lessonVersion:data.lessonVersion,course:'simplified',datasetSha:data.source.sha256,
    cards:[...foundations.map(item=>cardFor(item)),...roots.map(item=>({...cardFor(item,rootVerified),holdUntilDue:rootHeld}))],
    logs:[],daily:[{date:dayKey(),newCount,reviews:0,attempts:0,correct:0,seconds:0}],settings:{newPerDay:newLimit,retention:.9,theme:'dark',pinyin:true}};
}
function unchangedSchedule(before,after){for(const field of ['due','stability','difficulty','reps','lapses','last_review'])assert.equal(after[field],before[field],field);}

try{
  await page.goto(base);await ready();assert.equal((await current()).id,first.id);assert.equal(first.type,'stroke');
  assert.equal((await letters()).join(''),first.code);assert.equal(await page.locator('.stroke-glyph').textContent(),first.strokeGlyph);assert.equal(await page.locator('.stroke-target svg').count(),0);
  assert.equal(await page.locator('#prompt-code b').evaluate(node=>getComputedStyle(node).textTransform),'none');
  assert.equal(await page.locator('.practice p').count(),0);await page.screenshot({path:'artifacts/v7-stroke-dark.png',fullPage:true});
  await page.keyboard.press('Enter');await page.keyboard.press('?');await page.keyboard.press('Control+z');assert.equal((await progress()).logs.length,0);
  await page.keyboard.type('Z');await count(1);await page.locator('.practice[data-phase="correction"]').waitFor();
  assert.equal(await page.locator('#code-input').inputValue(),'z');assert.equal(await page.locator('#code-input').getAttribute('readonly'),null);
  assert.equal(await page.locator('#code-input').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('.entry-slots .mismatch').count(),1);
  await assertReplacementSelection();await page.locator('#code-input').click();await assertReplacementSelection();
  assert.equal((await letters()).join(''),first.code);
  const failed=await progress();assert.equal(failed.logs[0].grade,1);assert.equal(failed.logs[0].submitted,'z');
  await page.keyboard.press('?');await page.keyboard.press('Space');await page.keyboard.press('Tab');assert.equal(await page.locator('#code-input').inputValue(),'z');
  await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#code-input').inputValue(),'z');await assertReplacementSelection();
  await page.keyboard.press('Backspace');assert.equal(await page.locator('#code-input').inputValue(),'');assert.equal(await page.locator('#code-input').getAttribute('aria-invalid'),null);
  await page.keyboard.type('z');assert.equal(await page.locator('#code-input').inputValue(),'z');assert.equal((await progress()).logs.length,1);
  await page.waitForTimeout(3100);assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),first.id);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.locator('#code-input').inputValue(),'z');await assertReplacementSelection();
  await page.screenshot({path:'artifacts/v11-correction-mapping.png',fullPage:true});
  await page.reload();await page.locator('.practice[data-phase="correction"] #code-input').waitFor();
  assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),first.id);assert.equal(await page.locator('#code-input').inputValue(),'z');assert.equal(await page.locator('#code-input').getAttribute('aria-invalid'),'true');
  await assertReplacementSelection();
  assert.deepEqual((await progress()).cards,failed.cards);assert.deepEqual((await progress()).logs,failed.logs);
  await page.keyboard.press('Control+z');await count(0);await ready();assert.equal((await current()).id,first.id);
  assert.equal((await progress()).cards.length,0);assert.equal((await progress()).pendingCorrection,undefined);
  await page.keyboard.press('Space');await count(1);await page.locator('.practice[data-phase="correction"]').waitFor();
  const blank=await progress();assert.equal(blank.logs[0].outcome,'blank');assert.equal(blank.logs[0].grade,1);assert.equal(blank.logs[0].submitted,'');
  await page.keyboard.press('Enter');await page.keyboard.press('Space');await page.waitForTimeout(3100);
  assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),first.id);assert.equal(await page.locator('#code-input').inputValue(),'');
  await page.keyboard.type(first.code);await ready();assert.notEqual((await current()).id,first.id);
  assert.equal(await page.locator('#target').evaluate(node=>getComputedStyle(node).animationName),'question-arrive');
  assert.equal(await page.locator('#code-input').evaluate(node=>getComputedStyle(node).animationName),'none');
  const afterCorrection=await progress();assert.deepEqual(afterCorrection.cards,blank.cards);assert.deepEqual(afterCorrection.logs,blank.logs);assert.deepEqual(afterCorrection.daily,blank.daily);assert.equal(afterCorrection.pendingCorrection,undefined);
  const second=await current();await type(second.code);await ready();const third=await current();await type(third.code);await ready();
  await page.keyboard.press('Control+z');await count(2);assert.equal((await current()).id,third.id);assert.equal(await page.locator('#code-input').inputValue(),'');
  await page.keyboard.press('Control+z');await count(1);assert.equal((await current()).id,second.id);assert.deepEqual((await progress()).cards,afterCorrection.cards);assert.deepEqual((await progress()).daily,afterCorrection.daily);
  await page.keyboard.press('Control+z');await count(0);assert.equal((await current()).id,first.id);assert.equal((await progress()).cards.length,0);assert.equal((await progress()).daily[0].newCount,0);
  await type(first.code);await ready();
  console.log('Checked correction without a timeout, blank Space reveal, reload recovery and repeated Ctrl+Z with atomic FSRS/stat rollback.');
  let steps=0,sawInitial=false;
  while((await current()).type!=='root'){
    assert.ok(steps++<30);const item=await current();if(item.type==='initial'){
      assert.equal((await page.locator('.initial-glyph').allTextContents()).join('/'),item.text);assert.equal(await page.locator('.lesson-examples>span').count(),item.examples.length);
      if(!sawInitial)await page.screenshot({path:'artifacts/v7-zhuyin-dark.png',fullPage:true});sawInitial=true;
    }
    const saved=await progress();for(const id of item.dependencies)assert.equal(saved.cards.find(card=>card.id===id)?.verified,true);
    await type(item.code.toUpperCase());await ready();
  }
  assert.equal(sawInitial,true);
  const firstRoot=await current(),saved=await progress();
  for(const id of firstRoot.dependencies)assert.equal(saved.cards.find(card=>card.id===id)?.verified,true);
  assert.equal(await page.locator('#code-input').getAttribute('maxlength'),'3');
  assert.equal((await letters()).join(''),displayCode(firstRoot));
  assert.equal(await page.locator('#prompt-code [data-known-code]').count(),0);
  assert.equal(new Set(await page.locator('.focus-stage #prompt-code b').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color))).size,3);
  assert.equal((await page.locator('#prompt-code>span b').allTextContents()).join(''),displayCode(firstRoot,firstRoot.fullCode,true));
  assert.deepEqual(await page.locator('#prompt-code>span small').allTextContents(),['A','S','B']);
  assert.equal(await page.locator('#answer-support').textContent(),'');
  await page.screenshot({path:'artifacts/v20-root-full-ASB.png',fullPage:true});
  await type(firstRoot.code);assert.equal((await progress()).logs.at(-1).codeLength,3);await ready();
  console.log('Checked real mapping-first progression and full ASB root.');

  const rootRecall=snapshot();rootRecall.cards.find(card=>card.id===roots[0].id).verified=false;
  await install(rootRecall);await knownOnly();assert.equal((await current()).id,roots[0].id);
  assert.equal((await letters()).join(''),'···');
  await page.keyboard.press('Tab');assert.equal((await letters()).join(''),roots[0].code[0].toUpperCase()+'··');
  assert.equal(await page.locator('#prompt-code [data-known-code]').count(),0);
  await page.waitForTimeout(800);assert.equal((await letters()).join(''),'···');
  await type(roots[0].code.toUpperCase());await ready();assert.equal((await progress()).logs.at(-1).hintCount,1);assert.equal((await progress()).logs.at(-1).scheduleUpdated,true);

  await install(snapshot({rootVerified:false,rootHeld:true}));
  let sawNew=false;
  for(let i=0;i<7;i++){
    const item=await current();assert.ok(!roots.some(root=>root.id===item.id));await type(item.code);await ready();
    if((await progress()).daily[0].newCount>20){sawNew=true;break;}
  }
  assert.equal(sawNew,true);

  await install(snapshot());await knownOnly();const poolBefore=(await progress()).cards;let previous=null;
  for(let i=0;i<9;i++){const item=await current();assert.notEqual(item.id,previous);await type(item.code);await ready();previous=item.id;}
  let state=await progress();assert.equal(state.cards.length,poolBefore.length);assert.equal(state.daily[0].reviews,0);
  for(const card of state.cards)unchangedSchedule(poolBefore.find(old=>old.id===card.id),card);
  assert.ok(state.logs.every(log=>log.supplemental&&!log.scheduleUpdated));

  const due=foundations.find(item=>item.type==='initial'&&item.initial==='b');
  const priority=snapshot();priority.cards.find(card=>card.id===due.id).due=new Date(Date.now()+1800).toISOString();
  await install(priority);const filler=await current();assert.notEqual(filler.id,due.id);
  await page.waitForTimeout(1900);await type(filler.code);await ready();assert.equal((await current()).id,due.id);await type(due.code);await ready();
  assert.equal((await progress()).logs.at(-1).scheduleUpdated,true);
  console.log('Checked infinite flow and FSRS due priority with mapping lessons.');

  await install(snapshot({newCount:3}));const character=data.items.find(item=>item.id===1);
  assert.equal((await current()).id,character.id);assert.equal((await letters()).join(''),'OeRLf');
  assert.deepEqual(await page.locator('#prompt-code>span small').allTextContents(),['A','S','A','A','S']);
  await page.screenshot({path:'artifacts/v6-character-dark.png',fullPage:true});
  await page.keyboard.type('oX');await page.keyboard.press('Space');assert.equal(await page.locator('#code-input').inputValue(),'Ox');assert.equal((await progress()).logs.length,0);await page.keyboard.press('Backspace');
  await page.locator('[data-action="theme"]').click();assert.equal(await page.locator('#code-input').inputValue(),'O');
  await page.screenshot({path:'artifacts/v6-character-light.png',fullPage:true});
  await type('ERLF');await ready();state=await progress();assert.equal(state.logs.at(-1).submitted,character.code);assert.equal(state.logs.at(-1).correct,true);assert.equal(state.logs.at(-1).backspaces,1);
  await page.reload();await ready();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');

  const extra=snapshot();const characterCard=cardFor(character,false);extra.cards.push(characterCard);
  await install(extra);await knownOnly();assert.equal((await current()).id,character.id);assert.equal((await letters()).join(''),'·····');
  await page.keyboard.type('oX');await page.keyboard.press('Backspace');await type('eRLf');await ready();state=await progress();
  assert.equal(state.logs.at(-1).grade,2);assert.equal(state.logs.at(-1).scheduleUpdated,false);unchangedSchedule(characterCard,state.cards.find(card=>card.id===character.id));
  await page.keyboard.press('Control+z');await count(0);assert.equal((await current()).id,character.id);unchangedSchedule(characterCard,(await progress()).cards.find(card=>card.id===character.id));
  assert.equal((await letters()).join(''),'·····');await type('oxrlf');await page.locator('.practice[data-phase="correction"]').waitFor();
  assert.equal((await letters()).join(''),'OeRLf');assert.equal(await page.locator('.decomposition').count(),1);assert.equal(await page.locator('#code-input').inputValue(),'OxRLf');
  assert.equal(await page.locator('.entry-slots .mismatch').count(),1);assert.ok((await page.locator('.entry-slots span').nth(1).getAttribute('class')).includes('mismatch'));
  await assertReplacementSelection();
  for(const key of ['ArrowLeft','ArrowRight','Home','End']){await page.keyboard.press(key);await assertReplacementSelection();}
  await page.locator('#code-input').click();await assertReplacementSelection();
  await page.locator('[data-action="theme"]').click();await assertReplacementSelection();await page.locator('[data-action="theme"]').click();
  await page.screenshot({path:'artifacts/v12-retained-error.png',fullPage:true});
  const wrongCharacter=await progress();assert.equal(wrongCharacter.logs[0].grade,1);assert.equal(wrongCharacter.cards.find(card=>card.id===character.id).verified,false);
  await page.keyboard.type('zzzzz');assert.equal(await page.locator('#code-input').inputValue(),'ZzZZz');assert.equal((await progress()).logs.length,1);await assertReplacementSelection();
  await page.keyboard.type('o');assert.equal(await page.locator('#code-input').inputValue(),'O');assert.equal(await page.locator('#code-input').getAttribute('aria-invalid'),null);assert.equal(await page.locator('.entry-slots .mismatch').count(),0);
  assert.notEqual(await page.locator('#code-input').evaluate(input=>getComputedStyle(input).caretColor),'rgba(0, 0, 0, 0)');
  await page.locator('[data-action="theme"]').click();assert.equal(await page.locator('#code-input').inputValue(),'O');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.locator('#code-input').inputValue(),'O');
  await page.screenshot({path:'artifacts/v8-correction-character.png',fullPage:true});
  await page.keyboard.type('eRLf');await ready();const copiedCharacter=await progress();assert.deepEqual(copiedCharacter.cards,wrongCharacter.cards);assert.deepEqual(copiedCharacter.logs,wrongCharacter.logs);assert.deepEqual(copiedCharacter.daily,wrongCharacter.daily);

  await settings();const downloadEvent=page.waitForEvent('download');await page.locator('[data-action="export"]').click();await (await downloadEvent).saveAs('artifacts/v6-backup.json');
  const backup=JSON.parse(await readFile('artifacts/v6-backup.json','utf8'));assert.equal(backup.logs.length,1);
  await page.locator('[data-view="library"]').click();await page.locator('#type-filter').selectOption('initial');
  assert.match(await page.locator('tbody').textContent(),/声母/);
  const symbols=await page.locator('tbody .table-text').allTextContents();assert.equal(symbols.length,21);
  for(const symbol of ['ㄅ','ㄗ/ㄓ','ㄘ/ㄔ','ㄙ/ㄕ','ㄧ/ㄩ','ㄨ','零声母'])assert.ok(symbols.includes(symbol));
  assert.ok(symbols.every(symbol=>!/[a-z]/i.test(symbol)));
  await page.locator('#type-filter').selectOption('stroke');
  for(const key of ['e','d']){
    const stroke=foundations.find(item=>item.type==='stroke'&&item.strokeKey===key);
    await page.locator(`[data-action="detail"][data-id="${stroke.id}"]`).click();await page.locator('[data-action="free-one"]').click();
    assert.equal(await page.locator('.stroke-glyph').textContent(),stroke.strokeGlyph);assert.equal(await page.locator('.stroke-target svg').count(),0);
    await page.screenshot({path:`artifacts/v7-fold-${key}.png`,fullPage:true});await page.keyboard.type(stroke.code);await page.locator('#search').waitFor();
  }
  await page.locator('#type-filter').selectOption('root');await page.locator('#search').fill(roots[0].fullCode);
  await page.locator(`[data-action="detail"][data-id="${roots[0].id}"]`).click();assert.match(await page.locator('.detail-note').textContent(),new RegExp(firstRoot.mapping.stroke+'画'));
  await page.locator('[data-action="close-dialog"]').click();await page.locator('#type-filter').selectOption('all');await page.locator('#search').fill('我们');
  await page.locator('tbody tr').first().locator('[data-action="detail"]').click();await page.locator('[data-action="free-one"]').click();const word=await current();
  assert.equal((await letters()).join(''),displayCode(word));await page.keyboard.type('z'.repeat(word.code.length));await page.locator('.practice[data-phase="correction"]').waitFor();
  assert.equal(await page.locator('#code-input').inputValue(),displayCode(word,'z'.repeat(word.code.length)));assert.equal((await progress()).logs.length,1);
  await page.keyboard.type(word.code.toUpperCase());await page.locator('#search').waitFor();assert.equal((await progress()).logs.length,1);
  await install(backup);assert.equal((await progress()).logs.length,1);
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'});
  const phone=await mobile.newPage();phone.on('pageerror',error=>errors.push(error.message));await phone.goto(base);await phone.locator('#code-input').waitFor();
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await phone.screenshot({path:'artifacts/v7-mobile-stroke.png',fullPage:true});
  await phone.locator('[data-action="theme"]').click();await phone.screenshot({path:'artifacts/v7-mobile-light.png',fullPage:true});
  await phone.keyboard.press('Space');await phone.locator('.practice[data-phase="correction"]').waitFor();assert.equal(await phone.locator('#code-input').inputValue(),'');
  await phone.keyboard.type('z');assert.equal(await phone.locator('#code-input').inputValue(),'z');
  const nativeReplacement=await phone.locator('#code-input').evaluate((node,code)=>{node.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:code}));return {value:node.value,invalid:node.getAttribute('aria-invalid')};},first.code);
  assert.deepEqual(nativeReplacement,{value:'',invalid:null});
  await phone.screenshot({path:'artifacts/v8-mobile-correction.png',fullPage:true});
  await phone.locator('#code-input').fill(first.code.toUpperCase());await phone.locator('.practice[data-phase="typing"]').waitFor();assert.equal(await phone.locator('.completion').count(),0);
  await mobile.close();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Browser checks passed: correction-only copying never regrades, Ctrl+Z, Space reveal, reload recovery, sound/stroke prerequisites, role case, hints, continuous flow, due priority, themes, exports and mobile.');
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:'artifacts/v11-failure.png',fullPage:true});throw error;}
finally{await context.close();await browser.close();}
