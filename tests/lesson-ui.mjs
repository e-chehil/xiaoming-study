import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const data=await loadCourse('simplified');
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await mkdir('artifacts/v21-lessons',{recursive:true});
async function open(item){
  await page.setViewportSize({width:1440,height:900});
  await page.locator('header [data-view="library"]').click();
  await page.locator('#type-filter').selectOption(item.type);await page.locator('#search').fill(item.text);
  await page.locator(`tbody [data-id="${item.id}"]`).click();await page.locator('[data-action="free-one"]').click();
  await page.locator('#code-input:not([readonly])').waitFor();
}
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:47831/');await page.locator('#code-input').waitFor();
  const selected=[...data.items.filter(item=>item.type==='stroke'),...['b','s','z','y','0'].map(initial=>data.items.find(item=>item.type==='initial'&&item.initial===initial)),data.items.find(item=>item.type==='root'&&item.text==='石')];
  for(const item of selected){
    await open(item);
    assert.deepEqual(await page.locator('.lesson-examples>span').allTextContents(),item.examples.map(example=>example.text));
    for(const [width,height]of [[1440,900],[320,640]]){
      await page.setViewportSize({width,height});
      const frame=await page.evaluate(()=>{
        const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,w:r.width,top:r.top,bottom:r.bottom,c:r.x+r.width/2};};
        return {examples:box('.lesson-examples'),target:box('#target'),input:box('.entry-wrap'),answer:box('#prompt-code'),alias:document.querySelector('.initial-alias')&&box('.initial-alias'),scroll:document.documentElement.scrollWidth};
      });
      assert.ok(Math.abs(frame.examples.c-frame.target.c)<1,JSON.stringify(frame));
      assert.ok(Math.abs(frame.input.c-frame.answer.c)<1,JSON.stringify(frame));
      assert.ok(frame.examples.bottom<=frame.answer.top,JSON.stringify(frame));assert.ok(frame.input.bottom<=height,JSON.stringify(frame));assert.ok(frame.scroll<=width);
      if(frame.alias)assert.ok(frame.alias.bottom<frame.examples.top);const pairs=await page.locator('.initial-unit').evaluateAll(nodes=>nodes.map(node=>{const a=node.querySelector('.initial-alias').getBoundingClientRect(),g=node.querySelector('.initial-glyph').getBoundingClientRect();return Math.abs(a.x+a.width/2-g.x-g.width/2);}));assert.ok(pairs.every(gap=>gap<1));
      if(item.type==='root')assert.equal(await page.locator('#code-input').getAttribute('maxlength'),'3');
      if(item.type!=='stroke'||item.strokeKey==='f'){
        for(const theme of ['dark','light']){
          if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('[data-action="theme"]').click();
          await page.screenshot({path:`artifacts/v21-lessons/${item.type}-${item.initial||item.strokeKey||'stone'}-${width}-${theme}.png`});
        }
      }
    }
    if(item.type==='root'){
      await page.keyboard.type(item.code[0]);assert.equal(await page.locator('.practice').getAttribute('data-item-id'),String(item.id));
      assert.equal(await page.locator('#code-input').inputValue(),item.code[0].toUpperCase());
      await page.keyboard.type(item.code.slice(1));await page.locator('#search').waitFor();
    }
  }
  assert.equal(await page.locator('details,summary,.course-downloads').count(),0);assert.deepEqual(errors,[]);
  console.log('Lesson UI passed: all six stroke examples, five paired phonetic annotations, centered examples and full ASB, two widths/themes, no early single-A submission or native details.');
}finally{await context.close();await browser.close();}
