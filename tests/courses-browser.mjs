import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyRating} from '../public/engine.mjs';

const sc=await loadCourse('simplified');
const tc=await loadCourse('traditional');
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('artifacts',{recursive:true});
const ready=()=>page.locator('.practice[data-phase="typing"] #code-input:not([readonly])').waitFor();
const progress=course=>page.evaluate(async course=>{const s=await import('/storage.mjs'),db=await s.openDatabase(course),p=await s.readProgress(db);db.close();return p;},course);
const count=async(course,n)=>{await page.waitForFunction(async({course,n})=>{const s=await import('/storage.mjs'),db=await s.openDatabase(course),p=await s.readProgress(db);db.close();return p.logs.length===n;},{course,n});};
async function choose(course,key){
  const toggle=page.locator('#course-toggle');
  if(await toggle.getAttribute('data-course')!==course){if(key)await toggle.press(key);else await toggle.click();}
  await page.waitForFunction(course=>document.documentElement.lang===(course==='traditional'?'zh-Hant':'zh-Hans')&&document.querySelector('#course-toggle')?.dataset.course===course&&!document.querySelector('#course-toggle').disabled,course);
  await page.locator('#code-input').waitFor();
}
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:47831/');await ready();
  assert.equal(await page.locator('header select').count(),0);
  assert.equal(await page.locator('#course-toggle').textContent(),'简');
  assert.match(await page.locator('#course-toggle').getAttribute('aria-label'),/当前简中，切换到繁中/);
  assert.equal(await page.locator('#course-toggle').evaluate(node=>node.nextElementSibling.dataset.action),'theme');
  const character=sc.items.find(item=>item.id===1),foundations=sc.items.filter(item=>['initial','stroke','rule','root'].includes(item.type));
  const seed={cards:foundations.map(item=>({...applyRating(null,3).card,id:item.id,verified:true,due:new Date(Date.now()+3600000).toISOString()})),logs:[],daily:[],settings:{theme:'light',pinyin:false,newPerDay:20,retention:.9}};
  await page.evaluate(async payload=>{const s=await import('/storage.mjs'),db=await s.openDatabase();await s.replaceProgress(db,payload);db.close();},seed);await page.reload();await ready();
  assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),character.id);
  assert.equal(await page.locator('.pinyin .reading-zhuyin').textContent(),character.zhuyin);
  assert.equal(await page.locator('.pinyin .reading-pinyin').textContent(),character.pinyin);
  await page.keyboard.type(character.code[0]);assert.equal(await page.locator('#code-input').inputValue(),'O');
  const scBefore=await progress('simplified');
  let releaseLoad;const loading=new Promise(resolve=>{releaseLoad=resolve;});
  await page.route('**/data/traditional/learning-runtime.json',async route=>{await loading;await route.fulfill({status:503,body:'test unavailable'});});
  await page.locator('#course-toggle').click();
  assert.equal(await page.locator('#course-toggle').isDisabled(),true);
  assert.equal(await page.locator('#course-toggle').getAttribute('aria-busy'),'true');
  assert.equal(await page.locator('#course-toggle').getAttribute('data-course'),'simplified');
  releaseLoad();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('切换失败'));
  assert.equal(await page.locator('#course-toggle').getAttribute('data-course'),'simplified');assert.equal(await page.locator('#course-toggle').isEnabled(),true);assert.equal(await page.locator('#code-input').inputValue(),'O');assert.deepEqual(await progress('simplified'),scBefore);
  await page.unroute('**/data/traditional/learning-runtime.json');
  await choose('traditional','Enter');assert.equal((await progress('traditional')).cards.length,0);
  assert.equal(await page.locator('#course-toggle').textContent(),'繁');
  assert.match(await page.locator('#course-toggle').getAttribute('aria-label'),/切換到簡中/);
  assert.equal(await page.locator('#code-input').evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.locator('#toast').textContent(),'');
  assert.deepEqual(await progress('simplified'),scBefore);
  assert.match(await page.locator('header').innerText(),/瀟明習字/);
  const firstId=Number(await page.locator('.practice').getAttribute('data-item-id')),first=tc.items.find(item=>item.id===firstId);
  await page.keyboard.type(first.code);await count('traditional',1);await ready();
  assert.equal((await progress('simplified')).logs.length,0);
  const rawRoot=tc.items.find(item=>item.type==='root'&&['习','纟','讠','饣','见','门'].includes(item.text));
  assert.ok(rawRoot);
  {
    await page.locator('[data-view="roots"]').click();await page.locator('#root-search').fill(rawRoot.fullCode);
    assert.equal(await page.locator(`.root-group [data-id="${rawRoot.id}"] strong`).textContent(),rawRoot.text);
  }
  await page.locator('[data-view="library"]').first().click();await page.locator('#search').fill('學習');
  const study=tc.items.find(item=>item.type==='word'&&item.text==='學習');
  await page.locator(`tbody [data-id="${study.id}"]`).click();await page.locator('[data-action="free-one"]').click();
  assert.equal(await page.locator('.pinyin .reading-zhuyin').textContent(),'ㄒㄩㄝˊ ㄒㄧˊ');
  assert.equal(await page.locator('.pinyin .reading-pinyin').textContent(),'xuéxí');
  assert.equal(await page.locator('.pinyin .reading-source').count(),0);
  await page.waitForTimeout(160);await page.screenshot({path:'artifacts/v14-traditional-study-desktop.png'});
  for(const [width,height]of [[375,812],[320,640],[844,390]]){
    await page.setViewportSize({width,height});
    const fit=await page.evaluate(()=>{const input=document.querySelector('.entry-wrap').getBoundingClientRect(),caption=document.querySelector('.pinyin').getBoundingClientRect(),answer=document.querySelector('#prompt-code').getBoundingClientRect();return {scroll:document.documentElement.scrollWidth,width:innerWidth,inputBottom:input.bottom,height:innerHeight,captionBottom:caption.bottom,answerTop:answer.top};});
    assert.ok(fit.scroll<=fit.width,JSON.stringify(fit));assert.ok(fit.inputBottom<=fit.height,JSON.stringify(fit));assert.ok(fit.captionBottom<=fit.answerTop,JSON.stringify(fit));
    const tools=await page.locator('.header-tools button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {width:r.width,height:r.height,right:r.right,top:r.top,color:s.color,radius:s.borderRadius,background:s.backgroundColor};}));
    assert.ok(tools.every(tool=>tool.width===44&&tool.height===44&&tool.right<=width&&tool.top===tools[0].top),JSON.stringify(tools));
    assert.equal(tools[0].color,tools[1].color);assert.equal(tools[0].radius,tools[1].radius);assert.equal(tools[0].background,tools[1].background);
    await page.screenshot({path:`artifacts/v14-traditional-study-${width}.png`});
  }
  await page.keyboard.type(study.code);await page.locator('#search').waitFor();assert.equal((await progress('traditional')).logs.length,1);
  await page.setViewportSize({width:1440,height:900});await choose('simplified','Space');
  assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),character.id);assert.equal(await page.locator('#code-input').inputValue(),'O');
  await page.keyboard.type(character.code.slice(1));await count('simplified',1);await ready();assert.equal((await progress('traditional')).logs.length,1);
  await page.keyboard.press('Control+z');await count('simplified',0);await ready();assert.equal((await progress('traditional')).logs.length,1);
  await choose('traditional');await page.keyboard.press('Control+z');await count('traditional',0);await ready();
  const failedId=Number(await page.locator('.practice').getAttribute('data-item-id')),failed=tc.items.find(item=>item.id===failedId);
  await page.keyboard.type((failed.code==='z'?'q':'z').repeat(failed.code.length));await count('traditional',1);await page.locator('[data-phase="correction"]').waitFor();
  const retained=await page.locator('#code-input').inputValue();
  await choose('simplified');await ready();assert.equal((await progress('simplified')).pendingCorrection,undefined);
  await choose('traditional');assert.equal(await page.locator('#code-input').inputValue(),retained);
  await page.reload();await page.locator('[data-phase="correction"]').waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'zh-Hant');assert.equal(await page.locator('#code-input').inputValue(),retained);
  await page.locator('[data-view="settings"]').click();assert.equal(await page.locator('main h1').textContent(),'設定');
  const incoming=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await incoming;assert.match(download.suggestedFilename(),/繁中/);await download.saveAs('artifacts/v14-traditional-backup.json');
  const backup=JSON.parse(await readFile('artifacts/v14-traditional-backup.json','utf8'));assert.equal(backup.course,'traditional');assert.equal(backup.datasetSha,tc.source.sha256);
  await page.locator('#backup-input').setInputFiles({name:'wrong-course.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'xiaoming-study',version:3,lessonVersion:sc.lessonVersion,course:'simplified',datasetSha:sc.source.sha256,...seed}))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('不屬於'));
  assert.equal(await page.locator('[data-action="confirm-import"]').count(),0);assert.equal((await progress('traditional')).logs.length,1);
  await page.locator('[data-view="library"]').click();assert.equal(await page.locator('.study-download,.course-downloads,details,summary').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Dual-course browser checks passed: seeded course progress, separate FSRS/daily/pending correction and undo, partial-input return, persisted choice, traditional UI, exact roots, paired readings, free practice, backup isolation, and three mobile/landscape sizes.');
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:'artifacts/v14-courses-failure.png',fullPage:true});throw error;}
finally{await context.close();await browser.close();}
