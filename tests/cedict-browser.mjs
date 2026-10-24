import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyRating} from '../public/engine.mjs';
const data=await loadCourse('simplified');
const metadata=JSON.parse(await readFile(new URL('../public/data/cedict/metadata.json',import.meta.url),'utf8'));
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();page.setDefaultTimeout(25000);
const errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))remote.push(r.url());});
await mkdir('artifacts',{recursive:true});
const base=process.env.TEST_URL||'http://127.0.0.1:47831/';
const ready=()=>page.locator('.practice[data-phase="typing"] #code-input:not([readonly])').waitFor();
const dictionaryReady=()=>page.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');
const progress=()=>page.evaluate(async()=>{const s=await import('/storage.mjs'),db=await s.openDatabase(),p=await s.readProgress(db);db.close();return p;});
const frame=()=>page.evaluate(()=>{
  const bounds=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
  return {target:bounds('#target'),input:bounds('.entry-wrap'),gloss:bounds('.gloss-wrap'),width:innerWidth,scroll:document.documentElement.scrollWidth};
});
async function dictionaryPage(){await page.keyboard.press('Escape');await page.locator('[data-view="dictionary"]').click();}
async function lookup(query){await page.locator('#dictionary-search').fill(query);await page.waitForTimeout(200);await page.locator('.dictionary-result').first().waitFor();}
try{
  await page.goto(base);await ready();await page.locator('header [data-view="library"]').click();await dictionaryReady();await page.locator('header [data-action="resume"]').first().click();
  assert.equal(await page.locator('.practice-gloss').count(),0);
  const character=data.items.find(item=>item.id===1);
  const foundations=data.items.filter(item=>['initial','stroke','rule','root'].includes(item.type));
  const fixture={cards:[...foundations.map(item=>({...applyRating(null,3).card,id:item.id,verified:true,due:new Date(Date.now()+3600000).toISOString()})),{...applyRating(null,3).card,id:character.id,verified:true,due:new Date(Date.now()-1000).toISOString()}],logs:[],daily:[],settings:{theme:'dark'}};
  await page.evaluate(async fixture=>{const s=await import('/storage.mjs'),db=await s.openDatabase();await s.replaceProgress(db,fixture);db.close();},fixture);
  await page.reload();await ready();await dictionaryReady();
  assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),character.id);
  assert.ok((await page.locator('.gloss-text').textContent()).length>0);
  assert.match(await page.locator('#prompt-code').getAttribute('aria-label'),/隐藏/);
  await page.keyboard.type(character.code.slice(0,2));const partial=await page.locator('#code-input').inputValue(),before=await progress();
  await page.keyboard.press(';');await page.locator('.dialog .dictionary-entry').first().waitFor();
  assert.equal(await page.locator('.dialog #prompt-code').count(),0);
  assert.ok(await page.locator('.dictionary-senses li').count()>1);
  await page.screenshot({path:'artifacts/v15-meaning-desktop.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#code-input').inputValue(),partial);assert.equal(await page.locator('#code-input').evaluate(n=>n===document.activeElement),true);assert.deepEqual(await progress(),before);
  for(const [width,height]of [[1440,900],[375,812],[320,568],[844,390],[375,440]]){
    await page.setViewportSize({width,height});const f=await frame();assert.ok(f.scroll<=width,JSON.stringify(f));assert.ok(f.input.bottom<=height,JSON.stringify(f));
    assert.ok(f.gloss.bottom<=f.input.y,JSON.stringify(f));
    await page.screenshot({path:`artifacts/v15-english-${width}-${height}.png`});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.keyboard.type('z'.repeat(character.code.length-partial.length));await page.locator('[data-phase="correction"]').waitFor();const retained=await page.locator('#code-input').inputValue(),errorFrame=await frame();
  await page.keyboard.press(';');await page.locator('.dialog').waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#code-input').inputValue(),retained);
  assert.deepEqual(await page.locator('#code-input').evaluate(n=>[n.selectionStart,n.selectionEnd]),[0,retained.length]);
  assert.deepEqual(await frame(),errorFrame);assert.equal((await progress()).logs.length,1);
  await page.keyboard.type(character.code);await ready();assert.equal((await progress()).logs.length,1);
  await dictionaryPage();await lookup('銀行');assert.equal(await page.locator('.dictionary-result-heading strong').first().textContent(),'银行');
  await page.locator('.dictionary-result').first().click();assert.match(await page.locator('.dictionary-senses').first().textContent(),/bank/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.dictionary-result').first().evaluate(n=>n===document.activeElement),true);
  await lookup('bank');assert.ok(await page.locator('.dictionary-result').count()>1);
  await lookup('麟');await page.locator('.dictionary-result').first().click();assert.ok(await page.locator('.dictionary-reference').count());
  await page.locator('.dictionary-related .disclosure-toggle').first().click();assert.match(await page.locator('.dictionary-related').first().textContent(),/qilin/);
  assert.equal(await page.locator('#app').evaluate(node=>node.inert),true);
  // Summaries and expanded reference links belong to the same keyboard loop.
  const focusable='.dialog a[href],.dialog button,.dialog .disclosure-toggle';
  const count=await page.locator(focusable).evaluateAll(nodes=>nodes.filter(node=>!node.disabled&&node.getClientRects().length).length);
  for(let i=0;i<count+2;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.dialog')),true);}
  await page.locator('.dictionary-reference').first().click();await page.keyboard.press('Escape');assert.equal(await page.locator('.dictionary-result').first().evaluate(n=>n===document.activeElement),true);
  assert.equal(await page.locator('#app').evaluate(node=>node.inert),false);
  await page.locator('#course-toggle').click();await ready();assert.equal(await page.locator('html').getAttribute('lang'),'zh-Hant');
  await page.keyboard.press('Escape');await page.locator('main [data-view="library"]').click();await page.locator('#search').fill('學習');await page.locator('tbody [data-action="detail"]').first().click();
  assert.match(await page.locator('.detail-meaning').textContent(),/to learn; to study/);
  assert.equal(await page.locator('.dictionary-entry-heading strong').first().textContent(),'學習');
  assert.equal(await page.locator('.dictionary-variant').first().textContent(),'学习');
  await page.locator('[data-action="free-one"]').click();await page.locator('.practice-gloss').waitFor();
  assert.equal(await page.locator('.gloss-text').textContent(),'to learn; to study');
  assert.ok((await page.locator('.reading-zhuyin').first().textContent()).includes('ㄒㄩㄝˊ'));
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:'artifacts/v15-traditional-english-375.png'});
  await page.keyboard.press('Escape');await page.locator('[data-view="dictionary"]').click();await lookup('学习');assert.equal(await page.locator('.dictionary-result-heading strong').first().textContent(),'學習');
  await page.screenshot({path:'artifacts/v15-dictionary-mobile.png'});
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  // A dictionary failure must leave typing and FSRS usable, with an explicit retry in the dictionary.
  const failure=await browser.newContext(),broken=await failure.newPage();
  await broken.route('**/data/cedict/dictionary.json',r=>r.fulfill({status:503,body:'unavailable'}));await broken.goto(base);await broken.locator('#code-input:not([readonly])').waitFor();await broken.locator('header [data-view="library"]').click();
  await broken.waitForFunction(()=>document.documentElement.dataset.dictionary==='error');await broken.locator('header [data-action="resume"]').first().click();await broken.locator('#code-input:not([readonly])').waitFor();
  await broken.keyboard.type('b');await broken.keyboard.press('Escape');await broken.locator('[data-view="dictionary"]').click();
  await broken.locator('[data-action="dictionary-retry"]').waitFor();await broken.unroute('**/data/cedict/dictionary.json');await broken.locator('[data-action="dictionary-retry"]').click();
  await broken.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');assert.match(await broken.locator('#dictionary-results').textContent(),/输入字词/);await failure.close();
  const escaped=await browser.newContext(),safe=await escaped.newPage();
  const malicious='<img src=x onerror="window.dictionaryInjected=true"> & <script>window.dictionaryInjected=true</script>';
  const testDictionary=JSON.stringify({version:1,source:{...metadata,entries:1},entries:[['測試','测试','ce4 shi4',[malicious],1]]});
  await safe.route('**/resource-catalog.mjs',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+'\nRESOURCES.dictionary.bytes='+Buffer.byteLength(testDictionary)+';RESOURCES.dictionary.sha256="'+createHash('sha256').update(testDictionary).digest('hex')+'";'});});
  await safe.route('**/data/cedict/dictionary.json',r=>r.fulfill({contentType:'application/json',body:testDictionary}));
  await safe.goto(base);await safe.locator('#code-input:not([readonly])').waitFor();await safe.locator('header [data-view="library"]').click();await safe.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');await safe.locator('header [data-action="resume"]').first().click();await safe.keyboard.press('Escape');await safe.locator('main [data-view="dictionary"]').click();
  await safe.locator('#dictionary-search').fill('测试');await safe.locator('.dictionary-result').click();
  assert.equal(await safe.locator('.dictionary-senses img,.dictionary-senses script').count(),0);
  assert.ok((await safe.locator('.dictionary-senses').textContent()).includes(malicious));assert.equal(await safe.evaluate(()=>!!window.dictionaryInjected),false);await escaped.close();
  await writeFile('artifacts/v15-cedict-browser.json',JSON.stringify({entries:metadata.entries,keyboard:true,separateScripts:true,offline:true,viewports:5,errors,remote},null,2));
  console.log('CC-CEDICT browser checks passed: English, all senses/references, keyboard modal and partial/error input preservation, isolated grading, five viewports, both scripts, no remote queries, failure and retry.');
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:'artifacts/v15-dictionary-failure.png',fullPage:true});throw error;}
finally{await context.close();await browser.close();}
