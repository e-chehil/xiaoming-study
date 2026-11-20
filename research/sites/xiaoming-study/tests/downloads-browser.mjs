import {chromium} from 'playwright-core';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const base=process.env.TEST_URL||'http://127.0.0.1:47831/';
const ready=()=>page.locator('.practice #code-input:not([readonly])').waitFor();
await mkdir('artifacts',{recursive:true});
try{
  await page.goto(base);await ready();
  for(const course of ['simplified','traditional']){
    if(course==='traditional'){await page.locator('#course-toggle').click();await ready();}
    await page.keyboard.press('Escape');await page.locator('main [data-view="library"]').click();
    const directory=course==='traditional'?'data/traditional/':'data/';
    const manifest=JSON.parse(await readFile(new URL('../dist/'+directory+'exports/manifest.json',import.meta.url),'utf8'));
    for(const key of ['path','words','roots']){
      const file=manifest.files[key],response=await page.request.get(new URL(directory+'exports/'+encodeURIComponent(file.name),base).href);
      assert.equal(response.status(),200);assert.equal(createHash('sha256').update(await response.body()).digest('hex'),file.sha256);
    }
    for(const [width,height]of [[1440,900],[375,812],[320,700]]){
      await page.setViewportSize({width,height});
      for(const theme of ['dark','light']){
        if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('[data-action="theme"]').click();
        assert.equal(await page.locator('main a[download],main details,main summary,.course-downloads').count(),0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.ok(await page.locator('.table-wrap').evaluate(node=>node.scrollWidth<=node.clientWidth));
        await page.screenshot({path:`artifacts/v20-course-${course}-${width}-${theme}.png`});
      }
    }
    await page.setViewportSize({width:1440,height:900});
    await page.keyboard.press('Escape');await ready();
  }
  assert.deepEqual(errors,[]);
  console.log('Clean course UI passed: no download/history or native disclosure controls, six local artifact hashes, and 12 responsive theme layouts.');
}finally{await context.close();await browser.close();}
