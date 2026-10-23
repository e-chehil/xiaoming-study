import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {applyRating} from '../public/engine.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),errors=[],report=[];
await mkdir('artifacts/filtered-practice',{recursive:true});
const sizes=[[1440,900],[320,640],[375,440],[844,390],[768,1024],[1024,768]];
try{
  for(const course of ['simplified','traditional']){
    const data=await loadCourse(course),all=[...data.items,...data.transferItems];
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.addInitScript(course=>localStorage.setItem('xiaoming-course',course),course);
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    const ready=()=>page.locator('.practice[data-phase="typing"] #code-input:not([readonly])').waitFor();
    const currentId=()=>page.locator('.practice').getAttribute('data-item-id').then(Number);
    const progress=()=>page.evaluate(async course=>{const s=await import('./storage.mjs'),db=await s.openDatabase(course),p=await s.readProgress(db);db.close();return p;},course);
    const library=async(type='all',state='all',query='')=>{
      await page.locator('header [data-view="library"]').click();
      await page.locator('#type-filter').selectOption(type);await page.locator('#state-filter').selectOption(state);await page.locator('#search').fill(query);
    };
    const enter=async(selfTest=false)=>{await page.locator('[data-action="'+(selfTest?'free-test':'free')+'"]').click();await ready();};
    const answer=async(item,{keyboard=false}={})=>{
      if(keyboard){await page.keyboard.type(item.code.replace('_',''));if(item.code.endsWith('_'))await page.keyboard.press('Space');}
      else await page.locator('#code-input').fill(item.code.replace('_',' '));
    };
    async function fit(){
      for(const [width,height]of sizes){
        await page.setViewportSize({width,height});
        const g=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.filtered-practice-actions button,.completion-actions button,.free-return')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};})}));
        if(await page.locator('.filtered-practice').count()){
          const boxes=await page.locator('.filtered-practice').evaluate(n=>{const r=n.getBoundingClientRect(),p=n.querySelector('.filtered-practice-count').getBoundingClientRect(),b=n.querySelector('.filtered-practice-actions').getBoundingClientRect();return {height:r.height,countRight:p.right,actionsLeft:b.left,top:p.top,buttonTop:b.top};});
          assert.ok(boxes.height<=48&&boxes.countRight+8<=boxes.actionsLeft,JSON.stringify(boxes));
        }
        assert.ok(g.scroll<=g.width,JSON.stringify(g));assert.ok(g.buttons.every(r=>r.width>=44&&r.height>=44&&r.left>=0&&r.right<=g.width),JSON.stringify(g));
      }
      await page.setViewportSize({width:1440,height:900});
    }
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:47831/');await ready();
    await page.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');
    const words=data.items.filter(i=>i.type==='word'&&i.code&&i.text.includes('人')).slice(0,65);assert.equal(words.length,65);
    const known=[...data.items.filter(i=>['initial','stroke','root'].includes(i.type)),...words];
    const seed={cards:known.map(i=>({...applyRating(null,3).card,id:i.id,answerCode:i.code,verified:true,due:new Date(Date.now()+3600000).toISOString()})),logs:[],daily:[],settings:{theme:'light',newPerDay:20}};
    await page.evaluate(async({course,seed})=>{const s=await import('./storage.mjs'),db=await s.openDatabase(course);await s.replaceProgress(db,seed);db.close();},{course,seed});
    await page.reload();await ready();
    const formalId=await currentId(),formal=data.items.find(i=>i.id===formalId);assert.ok(formal.code.length>1);
    await page.keyboard.type(formal.code[0]);const originalInput=await page.locator('#code-input').inputValue(),before=await progress();
    await library();assert.ok((await page.locator('.filtered-practice-count').textContent()).includes(new Intl.NumberFormat('zh-CN').format(all.filter(i=>i.code).length)));
    await enter();assert.equal(await currentId(),all.find(i=>i.code).id);await page.locator('[data-action="free-exit"]').click();
    await library('word','learned','人');assert.match(await page.locator('.filtered-practice-count').textContent(),/65/);
    await fit();await page.setViewportSize({width:320,height:640});await page.screenshot({animations:'disabled',path:'artifacts/filtered-practice/'+course+'-list-320.png'});await page.setViewportSize({width:1440,height:900});
    for(const selfTest of [false,true]){
      await page.locator('[data-action="page"][data-delta="1"]').click();
      assert.equal(await page.locator('tbody [data-action="detail"]').first().getAttribute('data-id'),String(words[30].id));
      await enter(selfTest);
      for(let i=0;i<words.length;i++){
        assert.equal(await currentId(),words[i].id,course+' '+selfTest+' position '+i);
        assert.match(await page.locator('.session-count').textContent(),new RegExp(i+' / 65'));
        assert.match(await page.locator('#prompt-code').getAttribute('aria-label'),selfTest?/^(编码已隐藏|編碼已隱藏)$/:/^(编码|編碼) /,course+' position '+i);
        if(i===0){await fit();await page.keyboard.press('Escape');await page.locator('.resume-button').click();await ready();assert.equal(await currentId(),words[i].id);}
        if(i===1){
          await page.locator('#code-input').fill('z'.repeat(words[i].code.length));await page.locator('[data-phase="correction"]').waitFor();
          assert.match(await page.locator('.session-count').textContent(),/1 \/ 65/);
          await answer(words[i],{keyboard:true});
        }else if(i===2){await page.locator('[data-action="skip"]').click();await page.locator('[data-phase="correction"]').waitFor();await answer(words[i]);}
        else await answer(words[i],{keyboard:i===0});
      }
      await page.locator('[data-filtered-complete="true"]').waitFor();assert.match(await page.locator('main p').textContent(),/65/);await fit();
      assert.deepEqual(await progress(),before);
      await page.keyboard.press('Control+z');await ready();assert.equal(await currentId(),words.at(-1).id);await answer(words.at(-1));await page.locator('[data-filtered-complete="true"]').waitFor();
      await page.locator('[data-action="free-again"]').click();await ready();assert.equal(await currentId(),words[0].id);await answer(words[0]);assert.equal(await currentId(),words[1].id);
      await page.keyboard.press('Control+z');await ready();assert.equal(await currentId(),words[0].id);assert.match(await page.locator('.session-count').textContent(),/0 \/ 65/);
      await page.locator('[data-action="free-exit"]').click();await page.locator('#search').waitFor();
      assert.equal(await page.locator('#search').inputValue(),'人');assert.equal(await page.locator('#type-filter').inputValue(),'word');assert.equal(await page.locator('#state-filter').inputValue(),'learned');
      assert.equal(await page.locator('tbody [data-action="detail"]').first().getAttribute('data-id'),String(words[30].id));
      await page.locator('[data-action="page"][data-delta="-1"]').click();
    }
    await library('stroke','all');const strokes=data.items.filter(i=>i.type==='stroke');await enter(true);await answer(strokes[0]);
    const partial=strokes[1].code[0];if(strokes[1].code.length>1)await page.keyboard.type(partial);
    await page.locator('#course-toggle').click();await page.waitForFunction(course=>document.querySelector('#course-toggle')?.dataset.course!==course&&!document.querySelector('#course-toggle').disabled,course);
    await page.locator('#course-toggle').click();await ready();assert.equal(await currentId(),strokes[1].id);assert.match(await page.locator('.session-count').textContent(),/1 \/ 6/);
    for(const item of strokes.slice(1))await answer(item);await page.locator('[data-filtered-complete="true"]').waitFor();
    await page.locator('#course-toggle').click();await page.waitForFunction(course=>document.querySelector('#course-toggle')?.dataset.course!==course&&!document.querySelector('#course-toggle').disabled,course);
    await page.locator('#course-toggle').click();await page.locator('[data-filtered-complete="true"]').waitFor();
    await page.locator('[data-action="free-exit"]').click();assert.equal(await page.locator('#type-filter').inputValue(),'stroke');
    for(const type of ['short',...(course==='traditional'?['variant']:[])]){
      const item=all.find(i=>i.type===type&&(type!=='short'||i.code.endsWith('_')));assert.ok(item);
      await library(type,'new',String(item.order));assert.match(await page.locator('.filtered-practice-count').textContent(),/1/);await enter(true);assert.equal(await currentId(),item.id);
      await fit();await answer(item,{keyboard:true});await page.locator('[data-filtered-complete="true"]').waitFor();await page.locator('[data-action="free-exit"]').click();
    }
    await library('all','unsupported');assert.equal(await page.locator('[data-action="free"]').isDisabled(),true);assert.equal(await page.locator('[data-action="free-test"]').isDisabled(),true);await fit();
    await library('all','all','没有这个课程<>&');assert.equal(await page.locator('[data-action="free"]').isDisabled(),true);assert.equal(await page.locator('[data-action="free-test"]').isDisabled(),true);
    await page.locator('[data-action="reset-filters"]').click();assert.equal(await page.locator('[data-action="free"]').isEnabled(),true);
    await page.locator('header [data-action="resume"]').first().click();await ready();assert.equal(await currentId(),formalId);assert.equal(await page.locator('#code-input').inputValue(),originalInput);assert.deepEqual(await progress(),before);
    await page.locator('#code-input').fill('z'.repeat(formal.code.length));await page.locator('[data-phase="correction"]').waitFor();
    const correctionInput=await page.locator('#code-input').inputValue(),pending=await progress();assert.ok(pending.pendingCorrection);
    await library('stroke','learned');await enter(true);for(const item of strokes)await answer(item);
    await page.locator('[data-filtered-complete="true"]').waitFor();await page.locator('[data-action="free-exit"]').click();
    await page.locator('header [data-action="resume"]').first().click();await page.locator('[data-phase="correction"]').waitFor();
    assert.equal(await currentId(),formalId);assert.equal(await page.locator('#code-input').inputValue(),correctionInput);assert.deepEqual(await progress(),pending);
    report.push(course+': full filtered scope, 65-item cross-page runs in both modes, correction/skip/undo/restart, saved filters/page, course suspension, empty/unsupported, shorthand Space, formal progress/input/pending-correction isolation and six viewport sizes');
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(report.join('\n'));
}finally{await browser.close();}
