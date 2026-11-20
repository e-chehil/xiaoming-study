import assert from 'node:assert/strict';
import {launchBrowser} from './support/browser.mjs';
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1280,height:850}});
const page=await context.newPage();page.setDefaultTimeout(45000);
const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().endsWith('/data/wangma.json'))requests.push(r.url());});
const slot=page.locator('main .wangma-reference');
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
  await page.locator('#course-toggle').click();
  await page.waitForFunction(()=>document.documentElement.lang==='zh-Hant');
  await slot.locator('code').first().waitFor();
  await page.locator('header [data-view="library"]').click();
  await page.locator('#type-filter').selectOption('word');await page.locator('#search').fill('人民');
  await page.locator('[data-action="detail"][data-id="7524"]').click();
  assert.match(await page.locator('.dialog .wangma-reference').textContent(),/人\s*WWWW/);
  await page.locator('[data-action="free-one"]').click();assert.equal(await slot.locator('code').count(),2);
  await page.locator('[data-action="derivation"]').click();assert.equal(await page.locator('.dialog .wangma-reference code').count(),2);
  await page.keyboard.press('Escape');
  await settings('numeric9_head_rest');
  await page.locator('header [data-view="library"]').click();
  await page.locator('#type-filter').selectOption('word');await page.locator('#search').fill('人民');
  await page.locator('[data-action="free-test"]').click();await slot.locator('code').first().waitFor();
  assert.equal(await slot.locator('code').first().textContent(),'8');
  assert.equal(await page.locator('.prompt-code.hidden-answer').count(),1);
  await page.locator('#code-input').fill('zzzzz');await page.locator('main[data-phase="correction"]').waitFor();
  assert.equal(await slot.locator('code').first().textContent(),'8');
  await page.setViewportSize({width:375,height:390});
  await page.waitForFunction(()=>document.documentElement.classList.contains('compact-practice'));
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const fit=await page.evaluate(()=>({width:document.documentElement.scrollWidth, right:document.querySelector('.wangma-reference').getBoundingClientRect().right,
    bottom:document.querySelector('.practice-bottom').getBoundingClientRect().bottom}));
  assert.ok(fit.width<=375 && fit.right<=375 && fit.bottom<=391, JSON.stringify(fit));
  // The course can be usable while the service worker is still installing the shell.
  // Checking the same readiness shown in Settings also catches rejected installations.
  await page.waitForFunction(()=>document.documentElement.dataset.offline==='unavailable'||
    document.documentElement.dataset.offline==='ready'&&!!navigator.serviceWorker.controller,null,{timeout:120000});
  assert.equal(await page.locator('html').getAttribute('data-offline'),'ready');
  await context.setOffline(true);await page.reload();await slot.locator('code').first().waitFor();
  assert.match(await slot.textContent(),/9鍵|9键/);
  await settings('');assert.equal(await slot.count(),0);
  assert.equal(requests.length,firstLoadRequests);
  assert.deepEqual(errors,[]);
  console.log('Seven-scheme reference, course switch, self-test, correction, mobile fit and offline reload passed.');
} finally { await browser.close(); }
