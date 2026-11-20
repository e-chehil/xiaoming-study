import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
const browser=await launchBrowser(),errors=[];
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
const base=process.env.TEST_URL||'http://127.0.0.1:47831/';
await mkdir('artifacts/mobile-practice',{recursive:true});
// Model iOS/Android's visual-only resize: layout viewport and CSS media queries stay tall.
await context.addInitScript(()=>{
  // Exercise the optional, longest numeric reference label on the traditional track.
  if (new URL(location.href).searchParams.get('course')==='traditional') localStorage.setItem('xiaoming-wangma','numeric9_head_rest');
  else localStorage.removeItem('xiaoming-wangma');
  window.keyboardViewport={height:null,top:0,scale:1};
  const viewport=window.visualViewport;
  for(const key of ['height','offsetTop','scale']){
    const original=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(viewport),key).get;
    Object.defineProperty(viewport,key,{get(){return key==='height'?(window.keyboardViewport.height??original.call(this)):key==='offsetTop'?window.keyboardViewport.top:window.keyboardViewport.scale;}});
  }
});
async function viewport(height,top=0,scale=1){
  await page.evaluate(({height,top,scale})=>{Object.assign(window.keyboardViewport,{height,top,scale});visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));},{height,top,scale});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function open(item,course,selfTest=false){
  await page.goto(base+'?view=library&course='+course+'&type='+item.type+'&q='+encodeURIComponent(item.text));
  await page.locator('tbody [data-id="'+item.id+'"]').first().waitFor();
  if(selfTest)await page.locator('[data-action="free-test"]').click();
  else{await page.locator('tbody [data-id="'+item.id+'"]').first().click();await page.locator('[data-action="free-one"]').click();}
  await page.locator('#code-input').waitFor();await page.evaluate(()=>document.fonts.ready);
}
async function fits(label){
  const g=await page.evaluate(()=>{
    const box=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    const app=document.querySelector('#app');
    return {height:visualViewport.height,top:visualViewport.offsetTop,width:innerWidth,layoutHeight:innerHeight,scroll:app.scrollHeight,client:app.clientHeight,
      boxes:['#target','.pinyin','.lesson-examples','.gloss-wrap','.wangma-reference','.decomposition','#prompt-code','.entry-wrap','#attempt-status','.practice-bottom'].map(box).filter(b=>b?.height>0)};
  });
  const detail=label+' '+JSON.stringify(g);
  assert.ok(g.scroll<=g.client+1,detail);
  for(const b of g.boxes){assert.ok(b.top>=g.top-1&&b.bottom<=g.top+g.height+1,detail);assert.ok(b.left>=-1&&b.right<=g.width+1,detail);}
  assert.ok(g.boxes.find(b=>b.height>0),detail);
}
try{
  for(const course of ['simplified','traditional']){
    const data=await loadCourse(course);
    const picked=[data.items.find(i=>i.type==='initial'&&i.initial==='r'),data.items.find(i=>i.type==='stroke'),data.items.find(i=>i.type==='root'&&i.code.startsWith('g')),data.items.find(i=>i.type==='root'&&i.mapping.smallSource==='stroke'),data.items.find(i=>i.type==='char'&&i.text==='好'),data.items.find(i=>i.type==='word'&&i.text===(course==='traditional'?'中國人民解放軍':'中国人民解放军')),data.transferItems.find(i=>i.type==='short'&&i.shortRule==='one'),data.transferItems.find(i=>i.type==='variant')].filter(Boolean);
    for(const item of picked){
      await open(item,course);
      if(course==='traditional') await page.locator('main .wangma-entry').first().waitFor();
      for(const width of [320,390]){
        await page.setViewportSize({width,height:844});
        for(const height of [360,440,540]){await viewport(height,35);await fits(course+' '+item.type+' '+item.text+' '+width);}
      }
      await viewport(390,0);await page.screenshot({path:'artifacts/mobile-practice/'+course+'-'+item.type+'.png'});
      await page.locator('#code-input').focus();await page.keyboard.press('Space');await page.locator('[data-phase="correction"]').waitFor();
      await viewport(360,25);await fits(course+' correction '+item.type);
      await page.keyboard.press('Shift+Slash');await page.locator('.teaching-dialog').waitFor();
      const b=await page.locator('.dialog').boundingBox();assert.ok(b.y>=25&&b.y+b.height<=385);
      await page.keyboard.press('/');assert.equal(await page.locator('.dialog').count(),0);
      assert.ok(await page.locator('#code-input').evaluate(n=>n===document.activeElement));
      await viewport(null);assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('compact-practice')),false);
    }
  }
  const data=await loadCourse('simplified'),white=data.items.find(i=>i.type==='root'&&i.text==='白');
  await open(white,'simplified');await viewport(390,40);
  await page.keyboard.type('o');
  await page.evaluate(()=>{window.savedInput=document.querySelector('#code-input');window.blurs=0;savedInput.addEventListener('blur',()=>window.blurs++);});
  for(const [openKey,closeKey] of [['/','/'],['Shift+Slash','/'],['Shift+Slash','Shift+Slash']]){
    await page.keyboard.press(openKey);await page.locator('.dialog').waitFor();
    await page.evaluate(()=>document.querySelector('.dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true,repeat:true})));
    assert.equal(await page.locator('.dialog').count(),1,'holding the shortcut does not close/reopen');
    await page.keyboard.press('Control+/');assert.equal(await page.locator('.dialog').count(),1);
    await page.keyboard.press(closeKey);assert.equal(await page.locator('.dialog').count(),0);
    assert.equal(await page.locator('#code-input').inputValue(),'O');
    assert.deepEqual(await page.locator('#code-input').evaluate(n=>[n===document.activeElement,n.selectionStart,n.selectionEnd]),[true,1,1]);
  }
  // Zoom and route changes must release the fixed desk so content stays reachable.
  await viewport(390,0,2);assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('compact-practice')),false);
  await viewport(390);await page.keyboard.press('Escape');assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('compact-practice')),false);
  await page.locator('.resume-button').click();await fits('resumed');
  // Continuous practice keeps the same input and native editing session across questions.
  await page.goto(base);await page.locator('#code-input').waitFor();await viewport(390,30);
  await page.evaluate(()=>{window.savedInput=document.querySelector('#code-input');window.blurs=0;savedInput.addEventListener('blur',()=>window.blurs++);});
  for(let n=0;n<5;n++){
    const id=Number(await page.locator('.practice').getAttribute('data-item-id')),item=data.items.find(i=>i.id===id);
    await page.keyboard.insertText(item.code);await page.waitForFunction(id=>Number(document.querySelector('.practice')?.dataset.itemId)!==id,id);
    assert.deepEqual(await page.evaluate(()=>[savedInput===document.activeElement,savedInput===document.querySelector('#code-input'),blurs]),[true,true,0]);await fits('next question '+n);
  }
  const good=data.items.find(i=>i.type==='char'&&i.text==='好');await open(good,'simplified');
  await page.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');await viewport(390,20);
  await page.keyboard.type('c');await page.keyboard.press(';');await page.locator('.meaning-dialog').waitFor();await page.keyboard.press(';');
  assert.equal(await page.locator('.dialog').count(),0);assert.equal(await page.locator('#code-input').inputValue(),'C');
  assert.ok(await page.locator('#code-input').evaluate(n=>n===document.activeElement));
  await page.keyboard.type('zzz');await page.locator('[data-phase="correction"]').waitFor();const retained=await page.locator('#code-input').inputValue();
  for(const key of [';','/','Shift+Slash']){await page.keyboard.press(key);await page.locator('.dialog').waitFor();await page.keyboard.press(key==='Shift+Slash'?'/':key);assert.deepEqual(await page.locator('#code-input').evaluate(n=>[n.selectionStart,n.selectionEnd]),[0,retained.length]);}
  await page.keyboard.type(good.code);await page.locator('#search').waitFor();assert.deepEqual(errors,[]);
  console.log('Mobile practice passed: visual-only resize, viewport pan/zoom, both courses, eight lesson types, corrections, continuous focus, panel toggles and input selection.');
}finally{await context.close();await browser.close();}
