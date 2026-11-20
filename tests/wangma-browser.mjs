import assert from 'node:assert/strict';
import {launchBrowser} from './support/browser.mjs';
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1280,height:850}});
const page=await context.newPage();page.setDefaultTimeout(45000);
const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().endsWith('/data/wangma.json'))requests.push(r.url());});
const slot=page.locator('main .wangma-reference');
const detail=page.locator('.dialog .wangma-reference');
const zoom=page.locator('dialog.wangma-zoom[open]');
// SHA-256 of the concatenated, top-to-bottom RGBA pixels of the source BMPs.
// 民 is NAV in all three Wubi editions, with a different set of drawings in each.
const minWubi=['e325cd9af337a6572029619985c0adbdba84ff7fe964de945d2100242e71dcc4',
  'd3ccc7cced57e67307b0d6e7311250087e5bacf6eb82dc6744b34fd480952a1d',
  '6b4552a993ea8e91e9ab64e9e665503ccd5a9f25a793448b2ffdc68e12893fde'];
const minNumeric='c6ef02d157826eb30330846b662a2ac03e4d3a701165f51866bf708c6cf00719';
const renWubi='16600e4a1544353f6973a2649401cf7129f1fea82a73e46dddc07c8f166e4fa9';
function glyph(ref,char){return ref.locator(`[data-action="wangma-zoom"][data-glyph="${char}"]`);}
async function checkPixels(ref,count,expected){
  const imgs=ref.locator('.wangma-parts img');
  await imgs.first().waitFor();
  assert.equal(await imgs.count(),count);
  const hash=await imgs.evaluateAll(async nodes=>{
    const bytes=[];
    for(const img of nodes){
      await img.decode();
      const bounds=img.getBoundingClientRect();
      if(bounds.width<1||bounds.height<1)throw new Error('A Wangma root is hidden');
      const canvas=document.createElement('canvas');
      canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0);
      bytes.push(...ctx.getImageData(0,0,canvas.width,canvas.height).data);
    }
    const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  });
  assert.equal(hash,expected);
}
async function wordPage(){
  const library=page.locator('[data-view="library"]:visible').first();
  if(!await library.count())await page.keyboard.press('Escape');
  await library.click();
  await page.locator('#type-filter').selectOption('word');
  await page.locator('#search').fill('人民');
}
async function settings(scheme){
  if (!await page.locator('[data-view="settings"]:visible').count()) await page.keyboard.press('Escape');
  await page.locator('[data-view="settings"]:visible').first().click();
  await page.locator('#wangma').selectOption(scheme);
  await page.locator('#settings-form button[type=submit]').click();
  await page.waitForFunction(s=>localStorage.getItem('xiaoming-wangma')===s,scheme);
  await page.locator('main [data-action="resume"]').click();
}
try {
  await page.goto(process.env.TEST_URL,{waitUntil:'domcontentloaded'});await page.locator('#code-input').waitFor();
  assert.equal(requests.length,0);assert.equal(await slot.count(),0);
  await settings('wubi86');await slot.locator('code').first().waitFor();
  const firstLoadRequests=requests.length;
  assert.ok(firstLoadRequests>=1);
  assert.match(await slot.textContent(),/示例.*QTN/);
  await checkPixels(glyph(slot,'勹'),3,'23148e240292c8d088f740d1a9fb4449ae7491765f0e674f11864d916cff4c95');
  await page.locator('#course-toggle').click();
  await page.waitForFunction(()=>document.documentElement.lang==='zh-Hant');
  // The Traditional course's first lesson has a private-use root with no Wangma entry.
  // Wait for that lesson, as changing the interface language can precede its data download.
  const missing=slot.locator('.wangma-entry').filter({hasText:'\uF620'});
  await missing.waitFor();
  assert.match(await missing.innerText(),/未收[录錄]/);
  assert.equal(await missing.locator('img,code,button').count(),0);
  assert.equal(await missing.getAttribute('data-action'),null);
  await wordPage();
  await page.locator('[data-action="detail"][data-id="7524"]').click();
  assert.match(await detail.textContent(),/人\s*WWWW/);
  await checkPixels(glyph(detail,'人'),4,renWubi);
  await checkPixels(glyph(detail,'民'),3,minWubi[0]);
  await glyph(detail,'民').click();
  await checkPixels(zoom,3,minWubi[0]);
  await page.keyboard.press('Escape');
  assert.ok(await detail.isVisible());
  await page.locator('[data-action="free-one"]').click();assert.equal(await slot.locator('code').count(),2);
  await page.locator('[data-action="derivation"]').click();assert.equal(await page.locator('.dialog .wangma-reference code').count(),2);
  await checkPixels(glyph(detail,'民'),3,minWubi[0]);
  await page.keyboard.press('Escape');
  for(const [scheme,count,digest] of [['wubi98',3,minWubi[1]],['wubi2006',3,minWubi[2]],
      ['numeric6_first4_last1',0,null],['numeric9_first4_last1',5,minNumeric],['numeric6_head_rest',5,minNumeric]]){
    await settings(scheme);
    await wordPage();
    await page.locator('[data-action="detail"][data-id="7524"]').click();
    const button=glyph(detail,'民');
    if(count)await checkPixels(button,count,digest);
    else{
      assert.equal(await button.locator('img').count(),0);
      assert.equal((await button.locator('.wangma-strokes').innerText()).replace(/\s/g,''),'乙一乙一乙');
      await button.click();
      assert.equal((await zoom.locator('.wangma-strokes').innerText()).replace(/\s/g,''),'乙一乙一乙');
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
  }
  await settings('numeric9_head_rest');
  await wordPage();
  await page.locator('[data-action="free-test"]').click();await slot.locator('code').first().waitFor();
  assert.equal(await slot.locator('code').first().textContent(),'8');
  await checkPixels(glyph(slot,'民'),5,minNumeric);
  assert.equal(await page.locator('.prompt-code.hidden-answer').count(),1);
  await page.locator('#code-input').fill('zzzzz');await page.locator('main[data-phase="correction"]').waitFor();
  assert.equal(await slot.locator('code').first().textContent(),'8');
  await checkPixels(glyph(slot,'民'),5,minNumeric);
  await page.setViewportSize({width:375,height:390});
  await page.waitForFunction(()=>document.documentElement.classList.contains('compact-practice'));
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const fit=await page.evaluate(()=>({width:document.documentElement.scrollWidth, right:document.querySelector('.wangma-reference').getBoundingClientRect().right,
    bottom:document.querySelector('.practice-bottom').getBoundingClientRect().bottom}));
  assert.ok(fit.width<=375 && fit.right<=375 && fit.bottom<=391, JSON.stringify(fit));
  await glyph(slot,'民').click();
  await checkPixels(zoom,5,minNumeric);
  const box=await zoom.boundingBox();
  const small=await glyph(slot,'民').locator('img').first().boundingBox();
  const large=await zoom.locator('img').first().boundingBox();
  assert.ok(box.x>=0 && box.x+box.width<=375 && box.y>=0 && box.y+box.height<=391,JSON.stringify(box));
  assert.ok(large.width>small.width && large.height>small.height);
  await page.keyboard.press('Escape');
  // The course can be usable while the service worker is still installing the shell.
  // Checking the same readiness shown in Settings also catches rejected installations.
  await page.waitForFunction(()=>document.documentElement.dataset.offline==='unavailable'||
    document.documentElement.dataset.offline==='ready'&&!!navigator.serviceWorker.controller,null,{timeout:120000});
  assert.equal(await page.locator('html').getAttribute('data-offline'),'ready');
  await context.setOffline(true);await page.reload();await slot.locator('code').first().waitFor();
  assert.match(await slot.textContent(),/9鍵|9键/);
  await wordPage();
  await page.locator('[data-action="detail"][data-id="7524"]').click();
  await glyph(detail,'民').click();await checkPixels(zoom,5,minNumeric);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await settings('');assert.equal(await slot.count(),0);
  assert.equal(requests.length,firstLoadRequests);
  assert.deepEqual(errors,[]);
  console.log('Seven Wangma splits, decoded source pixels, course switch, self-test, correction, mobile zoom and offline reload passed.');
} finally { await browser.close(); }
