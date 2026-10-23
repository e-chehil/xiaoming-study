import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyRating} from '../public/engine.mjs';
import {hydrateCourse,practicePool} from '../public/lesson-data.mjs';
const sc=hydrateCourse(await loadCourse('simplified')),tc=hydrateCourse(await loadCourse('traditional'));
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const page=await context.newPage();page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const output='artifacts/learning-v6-20261024';await mkdir(output,{recursive:true});
const results=[];
const ready=()=>page.locator('.practice[data-phase="typing"] #code-input:not([readonly])').waitFor();
const progress=course=>page.evaluate(async course=>{const s=await import('/storage.mjs'),db=await s.openDatabase(course),p=await s.readProgress(db);db.close();return p;},course);
const card=(item,due=Date.now()+86400000)=>({...applyRating(null,3).card,id:item.id,answerCode:item.code,verified:true,due:new Date(due).toISOString()});
async function install(data,track,target){
  const pool=track==='core'?data.items.filter(i=>['initial','stroke','root'].includes(i.type)):practicePool(data,track).filter(i=>!['short','variant'].includes(i.type)&&!i.practiceAlias);
  const cards=pool.map(i=>card(i));if(target){const existing=cards.findIndex(c=>c.id===target.id);if(existing>=0)cards.splice(existing,1);cards.push(card(target,Date.now()-10000));}
  await page.evaluate(async({course,track,cards})=>{
    localStorage.setItem('xiaoming-course',course);localStorage.setItem('xiaoming-track:'+course,track);
    const s=await import('/storage.mjs'),db=await s.openDatabase(course);await s.replaceProgress(db,{cards,logs:[],daily:[],settings:{newPerDay:200,theme:'dark',retention:.9}});db.close();
  },{course:data.course,track,cards});await page.reload();await ready();
  if(target)assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),target.id);
}
async function logged(course,n){await page.waitForFunction(async({course,n})=>{const s=await import('/storage.mjs'),db=await s.openDatabase(course),p=await s.readProgress(db);db.close();return p.logs.length===n;},{course,n});return progress(course);}
async function geometry(){
  const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,dialogScroll:document.querySelector('.dialog')?.scrollWidth,dialogWidth:document.querySelector('.dialog')?.clientWidth}));
  assert.ok(value.scroll<=value.width,JSON.stringify(value));
  if(value.dialogWidth)assert.ok(value.dialogScroll<=value.dialogWidth+1,JSON.stringify(value));
}
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:47831/');await ready();
  const good=sc.items.find(i=>i.type==='char'&&i.text==='好');
  await install(sc,'core',good);
  await page.keyboard.type('c');await page.keyboard.press('Tab');
  assert.match(await page.locator('#attempt-status').textContent(),/n.*k/);
  await page.locator('[data-action="derivation"]').click();
  await page.locator('.derivation-step[data-step-index="1"]').focus();
  assert.match(await page.locator('[data-step-basis]').textContent(),/n.*k/);
  assert.equal(await page.locator('.derivation-root[data-active="true"]>.root-font').textContent(),'女');
  await page.screenshot({path:output+'/derivation-good-desktop.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#code-input').inputValue(),'C');
  await page.keyboard.type('kgi');let p=await logged('simplified',1);assert.equal(p.logs[0].revealed,true);assert.equal(p.cards.find(i=>i.id===good.id).verified,false);
  results.push('per-key explanation, focus highlight, partial input, assisted recall');

  await install(sc,'core',good);await page.keyboard.type('cjgi');
  await page.locator('.practice[data-phase="correction"]').waitFor();
  assert.match(await page.locator('.correction-cue').textContent(),/第 2 位.*n.*k/);
  await page.locator('[data-action="derivation"]').click();
  assert.equal(await page.locator('.derivation-step[data-step-index="1"]').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');await page.keyboard.type(good.code);await ready();
  p=await progress('simplified');assert.equal(p.logs.length,1);assert.equal(p.pendingCorrection,undefined);
  results.push('first wrong position explained; correction never adds a review');

  await install(sc,'core',good);await page.keyboard.type('c');await page.keyboard.press('Escape');
  await page.locator('[data-action="track"][data-track="short"]').click();await ready();
  await page.locator('[data-action="derivation"]').click();await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');await page.locator('[data-action="track"][data-track="core"]').click();await ready();
  assert.equal(await page.locator('#code-input').inputValue(),'C');
  await page.keyboard.type('kgi');p=await logged('simplified',1);assert.equal(p.logs[0].revealed,true);
  results.push('track switching preserves partial input and answer exposure');

  const one=sc.transferItems.find(i=>i.type==='short'&&i.text==='一');
  await install(sc,'short',one);
  await page.locator('[data-action="derivation"]').click();await page.locator('.derivation-step').last().focus();
  assert.equal(await page.locator('.derivation-root[data-active="true"]').count(),0);
  assert.match(await page.locator('[data-step-basis]').textContent(),/空格/);await page.keyboard.press('Escape');await page.keyboard.type('h');
  assert.equal((await progress('simplified')).logs.length,0);assert.equal(await page.locator('#code-input').inputValue(),'H');
  await page.keyboard.press('Space');p=await logged('simplified',1);
  assert.equal(p.logs[0].submitted,'h_');assert.equal(p.logs[0].correct,true);assert.equal(p.logs[0].track,'short');
  results.push('one-letter shorthand requires a real Space before automatic submission');


  await install(sc,'short',one);
  const other=await context.newPage();await other.goto(process.env.TEST_URL||'http://127.0.0.1:47831/');await other.locator('#code-input').waitFor();
  const heard=page.evaluate(()=>new Promise(resolve=>{const channel=new BroadcastChannel('xiaoming-study-dev-v5-answers');channel.onmessage=event=>{channel.close();resolve(event.data.id);};}));
  await other.bringToFront();await other.locator('[data-action="derivation"]').click();assert.equal(await heard,one.id);
  await page.bringToFront();await page.keyboard.type('h');await page.keyboard.press('Space');p=await logged('simplified',1);assert.equal(p.logs[0].revealed,true);await other.close();
  results.push('cross-tab lookup marks a supplementary lesson as assisted');

  await install(sc,'short',one);await page.keyboard.type('a');await page.keyboard.press('Space');
  await page.locator('.practice[data-phase="correction"]').waitFor();assert.equal((await progress('simplified')).logs.length,1);
  await page.reload();await page.locator('.practice[data-phase="correction"]').waitFor();
  assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),one.id);
  await page.keyboard.type('h');assert.equal((await progress('simplified')).logs.length,1);
  await page.keyboard.press('Space');await ready();p=await progress('simplified');assert.equal(p.logs.length,1);assert.equal(p.pendingCorrection,undefined);
  results.push('shorthand correction and reload preserve the commit key and single-attempt grading');

  await install(sc,'short',one);await page.evaluate(()=>{const input=document.querySelector('#code-input');input.value='h ';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));});p=await logged('simplified',1);assert.equal(p.logs[0].submitted,'h_');assert.equal(p.logs[0].correct,true);results.push('native soft-keyboard Space works when InputEvent.data is null');

  const fixed=sc.transferItems.find(i=>i.type==='short'&&i.text==='的');
  await install(sc,'short',fixed);await page.keyboard.type(fixed.code);p=await logged('simplified',1);assert.equal(p.logs[0].correct,true);
  results.push('fixed one-key shorthand commits without Space');

  for(const rule of ['two','three']){const target=sc.transferItems.find(i=>i.type==='short'&&i.shortRule===rule);await install(sc,'short',target);await page.keyboard.type(target.code.slice(0,-1));assert.equal((await progress('simplified')).logs.length,0);await page.keyboard.type(target.code.at(-1));p=await logged('simplified',1);assert.equal(p.logs[0].correct,true);}results.push('two- and three-key shorthand commit only at their exact lengths');

  const variant=tc.transferItems.find(i=>i.type==='variant'&&i.text==='起');
  await install(tc,'variant',variant);
  assert.equal(await page.locator('#target .glyph-taiwan').textContent(),'起');
  const originalBase=(await progress('traditional')).cards.find(i=>i.id===variant.baseId);
  await page.locator('[data-action="derivation"]').click();assert.match(await page.locator('.derivation-step .derivation-role').first().textContent(),/大碼/);await page.locator('.dialog [data-action="glyph"]').click();
  assert.equal(await page.locator('.glyph-comparison .glyph-default').textContent(),'起');
  assert.equal(await page.locator('.glyph-comparison .glyph-taiwan').textContent(),'起');
  assert.match(await page.locator('.glyph-comparison').textContent(),/巳/);
  await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.fonts.check('24px XiaomingTaiwan','起')),true);
  await page.screenshot({path:output+'/glyph-rise-desktop.png'});
  for(const width of [320,375,768])for(const theme of ['dark','light']){
    await page.setViewportSize({width,height:740});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await geometry();
    if(width===320)await page.screenshot({path:output+'/glyph-rise-320-'+theme+'.png'});
  }
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:900});await page.keyboard.type(variant.code);
  p=await logged('traditional',1);assert.equal(p.logs[0].itemId,variant.id);assert.equal(p.logs[0].track,'variant');
  assert.deepEqual(p.cards.find(i=>i.id===variant.baseId),originalBase);
  results.push('Taiwan font, official default/compatible comparison and independent variant progress');

  const originalRoot=tc.items.find(i=>i.type==='root'&&i.text==='门');await install(tc,'core',originalRoot);await page.locator('[data-action="derivation"]').click();await page.locator('.derivation-step[data-step-index="0"]').focus();assert.ok((await page.locator('[data-step-basis] [data-source-text]').allTextContents()).includes('门'));assert.ok(!(await page.locator('[data-step-basis] [data-source-text]').allTextContents()).includes('門'));await page.keyboard.press('Escape');results.push('traditional UI preserves exact original root glyphs inside explanations');

  await install(sc,'short',one);
  for(const size of [{width:320,height:568},{width:375,height:740},{width:844,height:390}]){
    await page.setViewportSize(size);await geometry();await page.locator('[data-action="derivation"]').click();await geometry();
    const action=await page.locator('.dialog-actions [data-action="close-dialog"]').boundingBox();assert.ok(action.y>=0&&action.y+action.height<=size.height,'dialog return control remains visible');
    await page.screenshot({path:output+'/short-'+size.width+'.png'});await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);results.push('mobile/landscape explanations and commit controls without horizontal overflow');
  await writeFile(output+'/teaching-browser.json',JSON.stringify({cases:results,errors},null,2)+'\n','utf8');
  console.log('Teaching browser checks passed: '+results.length+' cases.');
}finally{await context.close();await browser.close();}
