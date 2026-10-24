import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyRating} from '../public/engine.mjs';
const data=await loadCourse('simplified');
const root=data.items.find(i=>i.type==='root'),rare=data.items.findLast(i=>i.type==='root');
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'}),page=await context.newPage();
const base=process.env.TEST_URL||'http://127.0.0.1:47831',report={checks:[],errors:[]};
const dir='artifacts/fixes-20261023';await mkdir(dir,{recursive:true});
context.on('page',p=>{p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(e.message));});
page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
const ready=p=>p.locator('.practice[data-phase="typing"] #code-input:not([readonly])').waitFor();
const progress=p=>p.evaluate(async()=>{const s=await import('/storage.mjs'),db=await s.openDatabase(),v=await s.readProgress(db);db.close();return v;});
const count=(p,n)=>p.waitForFunction(async n=>{const s=await import('/storage.mjs'),db=await s.openDatabase(),v=await s.readProgress(db);db.close();return v.logs.length===n;},n);
const card=(i,verified,due)=>({...applyRating(null,1).card,id:i.id,answerCode:i.code,verified,holdUntilDue:false,due});
const foundations=()=>data.items.filter(i=>['initial','stroke'].includes(i.type)).map(i=>card(i,true,new Date(Date.now()+3600000).toISOString()));
const fixture=item=>({cards:item?[...foundations(),card(item,false,new Date(Date.now()-10000).toISOString())]:[],logs:[],daily:[],settings:{newPerDay:20}});
async function seed(item){
  await page.evaluate(async value=>{sessionStorage.clear();const s=await import('/storage.mjs'),db=await s.openDatabase();await s.replaceProgress(db,value);db.close();},fixture(item));
  await page.evaluate(()=>history.replaceState(null,'',location.pathname+'?course=simplified'));await page.reload();await ready(page);
}
async function lookup(item,{selfTest=false,preview=false}={}){
  await page.locator('header [data-view="library"]').click();await page.locator('#type-filter').selectOption(item.type);await page.locator('#search').fill(item.text);
  if(!selfTest)await page.locator(`tbody [data-id="${item.id}"]`).click();
  if(selfTest||preview){await page.locator(`[data-action="${selfTest?'free-test':'free-one'}"]`).click();await ready(page);}
  else{await page.locator('[data-action="close-dialog"]').click();await page.locator('[data-action="resume"]').first().click();await ready(page);}
}
async function checkAssisted(label){
  await page.keyboard.type(root.code,{delay:20});await count(page,1);
  const p=await progress(page);assert.equal(p.logs[0].grade,1);assert.equal(p.logs[0].revealed,true);assert.equal(p.cards.find(c=>c.id===root.id).verified,false);report.checks.push(label);
}
try{
  await page.goto(base);await ready(page);
  await seed(root);await lookup(root);await checkAssisted('current answer lookup is assisted and cannot unlock prerequisites');
  await seed(root);await lookup(root);await page.reload();await ready(page);await checkAssisted('lookup exposure survives reload');
  await seed(root);const lookupTab=await context.newPage();await lookupTab.goto(base);await ready(lookupTab);
  await lookup(root);await lookupTab.waitForTimeout(100);await lookupTab.bringToFront();await lookupTab.keyboard.type(root.code,{delay:20});await count(lookupTab,1);
  assert.equal((await progress(lookupTab)).logs[0].grade,1);assert.equal((await progress(lookupTab)).logs[0].revealed,true);
  await lookupTab.close();report.checks.push('lookup in another tab also marks the active recall as assisted');
  await seed(root);
  await page.locator('header [data-view="roots"]').click();await page.locator('#root-search').fill(root.text);
  await page.waitForTimeout(100);await page.locator('[data-action="resume"]').first().click();await ready(page);await checkAssisted('visible root table answers count without opening a detail dialog');
  await seed(rare);await lookup(root);await page.keyboard.type(rare.code,{delay:20});await count(page,1);
  assert.equal((await progress(page)).logs[0].grade,3);report.checks.push('unrelated lookups do not penalize independent recall');
  await seed(root);await page.keyboard.type('zzz');await page.locator('[data-phase="correction"]').waitFor();
  await page.evaluate(async()=>{
    const s=await import('/storage.mjs'),db=await s.openDatabase(),tx=db.transaction('meta','readwrite'),store=tx.objectStore('meta');
    const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    const request=store.get('pendingCorrection');request.onsuccess=()=>{const pending=request.result;delete pending.undo.answerExposed;store.put(pending,'pendingCorrection');};
    await done;db.close();
  });
  await page.reload();await page.locator('[data-phase="correction"]').waitFor();
  await page.keyboard.press('Control+z');await count(page,0);await ready(page);await checkAssisted('undo after revealed correction remains assisted, including restored corrections');
  await seed();const first=data.items[0];await page.keyboard.type(first.code);await count(page,1);await ready(page);
  await lookup(root,{preview:true});const before=await progress(page);await page.keyboard.press('Control+z');await ready(page);assert.deepEqual(await progress(page),before);
  await page.keyboard.type(root.code);await page.locator('#search').waitFor();report.checks.push('preview undo is isolated and preview retains one-shot return');
  await page.locator('#search').fill(String(root.order));await page.locator('[data-action="free-test"]').click();await ready(page);
  assert.equal(await page.locator('#prompt-code').getAttribute('aria-label'),'编码已隐藏');const beforeTest=await progress(page);
  await page.keyboard.type(root.code);await page.locator('[data-action="free-again"]').waitFor();assert.deepEqual(await progress(page),beforeTest);
  await page.setViewportSize({width:320,height:640});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);await page.screenshot({path:dir+'/self-test-320.png'});
  await page.locator('[data-action="free-again"]').click();await ready(page);assert.equal(await page.locator('#prompt-code').getAttribute('aria-label'),'编码已隐藏');
  await page.keyboard.press('Control+z');assert.deepEqual(await progress(page),beforeTest);
  await page.locator('[data-action="free-exit"]').click();await page.locator('#search').waitFor();await page.setViewportSize({width:1440,height:900});report.checks.push('blind self-test repeats without changing cards, logs, statistics, or correction metadata');
  await seed();const other=await context.newPage();await other.goto(base);await ready(other);
  const simultaneous=p=>p.evaluate(code=>{const input=document.querySelector('#code-input');input.value=code;input.dispatchEvent(new InputEvent('input',{bubbles:true,data:code}));},first.code);
  await Promise.all([simultaneous(page),simultaneous(other)]);await count(page,2);await ready(page);await ready(other);
  assert.match(await page.locator('.session-count').textContent(),/本轮 1/);assert.match(await other.locator('.session-count').textContent(),/本轮 1/);
  const concurrent=await progress(page);assert.equal(concurrent.cards[0].reps,2);assert.equal(concurrent.daily[0].reviews,2);assert.equal(concurrent.daily[0].newCount,1);
  report.concurrent={logs:2,reps:concurrent.cards[0].reps,daily:concurrent.daily[0]};report.checks.push('simultaneous tab reviews preserve both logs, FSRS repetitions and daily totals');
  // A deterministic stale-undo scenario, with A writing before B.
  await other.close();await seed();const stale=await context.newPage();await stale.goto(base);await ready(stale);
  await page.bringToFront();await page.keyboard.type(first.code);await count(page,1);await ready(page);await stale.bringToFront();await stale.keyboard.type(first.code);await count(stale,2);await ready(stale);
  const committed=await progress(stale);assert.equal(committed.logs.length,2);
  report.staleBefore={revision:committed.revision,logs:committed.logs.length};
  await page.bringToFront();await page.locator('#code-input').focus();await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('撤销已取消'));
  assert.deepEqual(await progress(page),committed);report.checks.push('stale undo cannot overwrite another tab or remove its later review');
  await ready(stale);const latestId=Number(await stale.locator('.practice').getAttribute('data-item-id'));
  const latestItem=data.items.find(i=>i.id===latestId);
  await page.locator('header [data-view="settings"]').click();
  const backup={app:'xiaoming-study',version:3,lessonVersion:data.lessonVersion,course:'simplified',datasetSha:data.source.sha256,...fixture()};
  await page.locator('#backup-input').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('[data-action="confirm-import"]').waitFor();
  await stale.bringToFront();await stale.keyboard.type(latestItem.code);await count(stale,3);const beforeImport=await progress(stale);
  await page.bringToFront();await page.locator('[data-action="confirm-import"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('重新选择备份'));
  assert.deepEqual(await progress(page),beforeImport);report.checks.push('stale import confirmation cannot replace newly saved progress');
  // Direct checks cover every mutation, not just the UI paths above.
  const protections=await page.evaluate(async()=>{
    const s=await import('/storage.mjs'),db=await s.openDatabase(),p=await s.readProgress(db),results=[];
    for(const operation of [()=>s.saveSettings(db,{theme:'light'},p.revision-1),()=>s.clearCorrection(db,0,p.revision-1),()=>s.undoReview(db,{id:p.cards[0].id,card:null,logKey:p.logs[0].key,daily:p.daily[0]},p.revision-1),()=>s.replaceProgress(db,p,p.revision-1)]){
      try{await operation();results.push(false);}catch(error){results.push(error.name==='ProgressConflictError');}
    }
    db.close();return results;
  });
  assert.deepEqual(protections,[true,true,true,true]);assert.deepEqual(await progress(page),beforeImport);report.checks.push('settings, correction, undo and replacement all reject stale revisions atomically');
  await stale.close();
  await seed();const correctionTab=await context.newPage();await correctionTab.goto(base);await ready(correctionTab);
  await page.bringToFront();await page.keyboard.type('z');await page.locator('[data-phase="correction"]').waitFor();const failed=await progress(page);
  await correctionTab.bringToFront();await correctionTab.keyboard.type(first.code);await correctionTab.locator('[data-phase="correction"]').waitFor();
  assert.deepEqual(await progress(page),failed);
  await correctionTab.keyboard.type(first.code);await ready(correctionTab);
  const nextId=Number(await correctionTab.locator('.practice').getAttribute('data-item-id')),nextItem=data.items.find(i=>i.id===nextId);
  await correctionTab.keyboard.type('z'.repeat(nextItem.code.length));await correctionTab.locator('[data-phase="correction"]').waitFor();
  const newerCorrection=await progress(correctionTab);assert.equal(newerCorrection.logs.length,2);
  // Refreshing settings must not let an older correction borrow the new one's key.
  await page.bringToFront();await page.locator('[data-action="theme"]').click();
  await page.waitForFunction(async revision=>{const s=await import('/storage.mjs'),db=await s.openDatabase(),p=await s.readProgress(db);db.close();return p.revision>revision;},newerCorrection.revision);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const withSettings=await progress(page);assert.equal(withSettings.pendingCorrection.undo.logKey,newerCorrection.pendingCorrection.undo.logKey);
  await page.bringToFront();await page.keyboard.type(first.code);await page.waitForFunction(id=>document.querySelector('.practice')?.dataset.itemId===String(id),nextId);
  assert.deepEqual(await progress(page),withSettings);report.checks.push('another tab cannot overwrite or clear a newer pending correction, including after a settings refresh');
  await correctionTab.close();assert.deepEqual(report.errors,[]);
  console.log('Integrity checks passed: '+report.checks.join('; '));
}catch(error){
  report.failure={message:error.message,state:await page.evaluate(()=>({toast:document.querySelector('#toast').textContent,phase:document.querySelector('.practice')?.dataset.phase,focus:document.activeElement?.outerHTML}))};
  throw error;
}finally{await context.close();await browser.close();await writeFile(dir+'/integrity.json',JSON.stringify(report,null,2));}
