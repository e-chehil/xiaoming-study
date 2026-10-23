import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='artifacts/frontend-v25';await mkdir(output,{recursive:true});
const browser=await launchBrowser();
const errors=[],report={frames:0,lessons:[],dialogs:0,utilityFrames:0,controls:[]};
const sizes=[{width:1440,height:900},{width:320,height:640},{width:375,height:440},{width:844,height:390},{width:375,height:812},{width:768,height:1024}];
let page;
async function open(item,selfTest=false){
  await page.setViewportSize(sizes[0]);
  await page.locator('header [data-view="library"]').click();
  await page.locator('#type-filter').selectOption(item.type);await page.locator('#search').fill(item.text);
  if(selfTest)await page.locator('[data-action="free-test"]').click();
  else{await page.locator('tbody [data-id="'+item.id+'"]').click();await page.locator('[data-action="free-one"]').click();}
  await page.locator('#code-input:not([readonly])').waitFor();await page.evaluate(()=>document.fonts.ready);
}
async function frame(item){
  const g=await page.evaluate(()=>{
    const box=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,c:r.x+r.width/2};};
    const status=document.querySelector('#attempt-status');
    return {target:box('#target'),wrap:box('.target-wrap'),examples:box('.lesson-examples'),caption:box('.pinyin'),gloss:box('.gloss-wrap'),support:box('.answer-support'),parts:box('.decomposition'),code:box('#prompt-code'),input:box('.entry-wrap'),status:box('#attempt-status'),statusScroll:status.scrollHeight,statusHeight:status.clientHeight,
      glyphs:[...document.querySelectorAll('.initial-unit')].map(n=>{const a=n.querySelector('.initial-alias').getBoundingClientRect(),g=n.querySelector('.initial-glyph').getBoundingClientRect();return {aliasBottom:a.bottom,glyphTop:g.top,glyphBottom:g.bottom,centers:Math.abs(a.x+a.width/2-g.x-g.width/2)};}),
      columns:[...document.querySelectorAll('#prompt-code>span')].map(n=>{const r=n.getBoundingClientRect();return r.x+r.width/2;}),slots:[...document.querySelectorAll('.entry-slots>span')].map(n=>{const r=n.getBoundingClientRect();return r.x+r.width/2;}),width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth};
  });
  const detail=JSON.stringify({id:item.id,text:item.text,type:item.type,...g});
  assert.ok(g.scroll<=g.width,detail);assert.ok(g.input.bottom<=g.height+1,detail);
  assert.ok(g.target.top>=g.wrap.top-1&&g.target.bottom<=g.wrap.bottom+1,detail);
  assert.ok(Math.abs(g.target.c-g.input.c)<1,detail);
  for(let i=0;i<g.columns.length;i++)assert.ok(Math.abs(g.columns[i]-g.slots[i])<1,detail);
  if(g.examples){assert.ok(g.target.bottom+3<=g.examples.top,detail);assert.ok(g.examples.bottom<=g.code.top,detail);}
  for(const glyph of g.glyphs){assert.ok(glyph.aliasBottom+1<=glyph.glyphTop,detail);assert.ok(glyph.centers<1,detail);assert.ok(glyph.glyphBottom+3<=g.examples.top,detail);}
  if(g.caption.height>0)assert.ok(g.target.bottom<=g.caption.top+1,detail);
  if(g.gloss){assert.ok(g.caption.bottom<=g.gloss.top+1,detail);assert.ok(g.gloss.bottom<=g.support.top+1,detail);}
  if(g.parts)assert.ok(g.parts.bottom<=g.code.top+1,detail);
  if(item.type==='variant'){const rows=await page.locator('.practice-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));assert.equal(new Set(rows).size,1,detail);}
  assert.ok(g.statusScroll<=g.statusHeight+1,detail);report.frames++;
}
async function modal(item){
  await page.locator('[data-action="derivation"]').click();
  for(const size of [sizes[1],sizes[3]]){
    await page.setViewportSize(size);
    const g=await page.locator('.dialog').evaluate(n=>{const r=n.getBoundingClientRect(),b=n.querySelector('.dialog-actions').getBoundingClientRect();return {width:n.clientWidth,scroll:n.scrollWidth,top:r.top,bottom:r.bottom,actions:b.bottom,height:innerHeight};});
    assert.ok(g.scroll<=g.width+1&&g.top>=0&&g.bottom<=g.height&&g.actions<=g.height,JSON.stringify(g));
    const buttons=await page.locator('.derivation-step').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {y:r.y,width:r.width,scroll:n.scrollWidth,client:n.clientWidth};}));assert.equal(new Set(buttons.map(b=>b.y)).size,1);assert.ok(buttons.every(b=>b.scroll<=b.client+1));
    await page.locator('.derivation-step').last().focus();
    assert.equal(await page.locator('.derivation-step').last().getAttribute('aria-pressed'),'true');
    report.dialogs++;
    if(['short','variant'].includes(item.type))await page.screenshot({animations:'disabled',path:output+'/'+item.type+'-'+(item.shortRule||'glyph')+'-'+size.width+'.png'});
  }
  await page.keyboard.press('Escape');
}
try{
  for(const course of ['simplified','traditional']){
    const data=await loadCourse(course);
    const context=await browser.newContext({viewport:sizes[0],locale:'zh-CN'});
    await context.addInitScript(course=>localStorage.setItem('xiaoming-course',course),course);
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:47831/');await page.locator('#code-input').waitFor();
    const picked=[...data.items.filter(i=>['initial','stroke'].includes(i.type)),data.items.find(i=>i.type==='root'&&i.text==='石'),data.items.find(i=>i.type==='root'&&i.mapping.smallSource==='stroke'),data.items.find(i=>i.type==='root'&&!i.examples?.length),
      ...[1,2,3,4].map(n=>data.items.find(i=>i.type==='char'&&i.code&&i.parts[0].division.length===n)),
      data.items.find(i=>i.type==='word'&&i.text===(course==='traditional'?'中國人民解放軍':'中国人民解放军')),
      ...['fixed','one','two','three','assigned'].map(rule=>data.transferItems.find(i=>i.type==='short'&&i.shortRule===rule)),
      ...[true,false].map(same=>data.transferItems.find(i=>i.type==='variant'&&(i.code===i.baseCode)===same))].filter(Boolean);
    const words=data.items.filter(i=>i.type==='word'&&i.code);
    for(const key of [i=>i.text.length,i=>(i.displayPinyin||i.pinyin||'').split(' / ')[0].length,i=>(i.zhuyin||'').split(' / ')[0].length]){
      const edge=words.reduce((a,b)=>key(a)>=key(b)?a:b);if(!picked.some(i=>i.id===edge.id))picked.push(edge);
    }
    for(const item of picked){
      await open(item);
      for(const size of sizes){
        await page.setViewportSize(size);
        for(const theme of ['light','dark']){
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await frame(item);
          if((item.initial==='r'||item.initial==='s'||item.type==='short'&&item.shortRule==='one'||item.type==='variant')&&[320,375,1440].includes(size.width))await page.screenshot({animations:'disabled',path:output+'/'+course+'-'+item.type+'-'+(item.initial||item.shortRule||item.id)+'-'+size.width+'x'+size.height+'-'+theme+'.png'});
        }
      }
      if(item.initial==='r'||item.type==='root'&&item.text==='石'||item.type==='short'&&item.shortRule==='one'||item.type==='variant'){
        await page.locator('#code-input').focus();await page.keyboard.press('Space');await page.locator('.practice[data-phase="correction"]').waitFor();
        for(const size of sizes){await page.setViewportSize(size);for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await frame(item);}}
      }
      if(['short','variant'].includes(item.type))await modal(item);
      if(item.type==='variant'){
        await page.locator('.practice [data-action="glyph"]').click();
        await page.setViewportSize({width:320,height:640});
        const codes=await page.locator('.glyph-comparison code').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().bottom));assert.ok(Math.abs(codes[0]-codes[1])<1);
        await page.screenshot({animations:'disabled',path:output+'/'+course+'-comparison-'+item.id+'.png'});await page.keyboard.press('Escape');
      }
      if(item.type==='short'&&['fixed','assigned'].includes(item.shortRule))assert.equal(await page.locator('.decomposition').count(),0);
      assert.doesNotMatch(await page.locator('.practice-context').textContent(),/简码.*简码训练|簡碼.*簡碼訓練/);
      report.lessons.push({course,id:item.id,type:item.type});
    }
    // Theme persistence must not swallow the next practice shortcut.
    const sample=data.items.find(i=>i.type==='char'&&i.text==='好');await open(sample);
    await page.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');window.restoreTransaction=()=>Object.defineProperty(IDBTransaction.prototype,'oncomplete',d);Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...d,set(fn){d.set.call(this,typeof fn==='function'?e=>setTimeout(()=>fn.call(this,e),250):fn);}});});
    await page.locator('[data-action="theme"]').click();await page.keyboard.press('Space');
    await page.locator('.practice[data-phase="correction"]').waitFor();await page.evaluate(()=>window.restoreTransaction());
    report.controls.push(course+': Space survives theme persistence');
    await page.keyboard.type(sample.code);await page.locator('#search').waitFor();
    await open(sample,true);
    await page.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');window.restoreTransaction=()=>Object.defineProperty(IDBTransaction.prototype,'oncomplete',d);Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...d,set(fn){d.set.call(this,typeof fn==='function'?e=>setTimeout(()=>fn.call(this,e),250):fn);}});});
    await page.locator('[data-action="theme"]').click();await page.keyboard.press('Tab');await page.locator('#prompt-code .hinted').waitFor();await page.evaluate(()=>window.restoreTransaction());
    report.controls.push(course+': Tab survives theme persistence');
    if(course==='simplified'){
      const fallback=data.items.find(i=>i.type==='char'&&i.code&&data.teaching.glyphSource.fontFallbacks.includes(i.text)&&data.glyphVariants[i.text]);
      await open(fallback);await page.locator('[data-action="derivation"]').click();await page.locator('.dialog [data-action="glyph"]').click();
      assert.equal(await page.locator('.glyph-comparison .glyph-taiwan').count(),0);assert.equal(await page.locator('.glyph-comparison .glyph-default').count(),2);
      assert.match(await page.locator('.glyph-comparison').textContent(),/原字形/);await page.screenshot({animations:'disabled',path:output+'/glyph-fallback.png'});await page.keyboard.press('Escape');
    }
    for(const view of ['menu','library','roots','stats','settings','help','dictionary']){
      await page.setViewportSize(sizes[0]);await page.locator('.pause-button').click();
      if(view!=='menu')await page.locator('.menu-links [data-view="'+view+'"]').click();
      if(view==='dictionary')await page.locator('#dictionary-search').waitFor();
      for(const width of [320,768])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:740});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        const checks=await page.evaluate(()=>{
          const controls=[...document.querySelectorAll('main button,main input:not([hidden]),main select')];
          return {width:innerWidth,scroll:document.documentElement.scrollWidth,headings:document.querySelectorAll('main h1').length,unnamed:controls.filter(n=>!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby')&&!n.textContent.trim()&&!n.labels?.length).map(n=>n.outerHTML)};
        });
        assert.ok(checks.scroll<=checks.width,course+' '+view+': overflow');assert.equal(checks.headings,1);assert.deepEqual(checks.unnamed,[]);report.utilityFrames++;
        if(width===320&&theme==='light')await page.screenshot({animations:'disabled',path:output+'/'+course+'-'+view+'-320.png',fullPage:true});
      }
    }
    await context.close();console.log(course+': '+picked.length+' lessons checked');
  }
  assert.deepEqual(errors,[]);await writeFile(output+'/report.json',JSON.stringify({...report,errors},null,2)+'\n');
  console.log('Frontend layout passed: '+report.frames+' learning frames, '+report.lessons.length+' lessons, '+report.dialogs+' dialogs, '+report.utilityFrames+' utility frames, '+report.controls.length+' theme shortcuts.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({animations:'disabled',path:output+'/failure.png',fullPage:true});throw error;}
finally{await browser.close();}
