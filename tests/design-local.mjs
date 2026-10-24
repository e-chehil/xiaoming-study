import {loadCourse} from './support/course.mjs';
import {launchBrowser} from './support/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {applyRating,evaluateAttempt,pickContinuous} from '../public/engine.mjs';

const data=await loadCourse('simplified');
const base=process.env.TEST_URL||'http://127.0.0.1:47831';
const dir='artifacts/design-after';await mkdir(dir,{recursive:true});
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={contrast:{},layout:[],rootLayout:[],input:[]};
const character=data.items.find(item=>item.id===1);
const firstRoot=data.items.find(item=>item.type==='root');
const stone=data.items.find(item=>item.type==='root'&&item.text==='石');
const foundations=data.items.filter(item=>['initial','stroke','rule','root'].includes(item.type));
const baseCards=()=>foundations.map(item=>({...applyRating(null,3).card,id:item.id,verified:true,due:new Date(Date.now()+3600000).toISOString()}));
const fixture=(extra=[])=>({cards:[...baseCards(),...extra],logs:[],daily:[],settings:{theme:'dark',newPerDay:20,retention:.9,pinyin:true}});
const ready=()=>page.locator('.practice[data-phase="typing"] #code-input:not([readonly])').waitFor();
const progress=()=>page.evaluate(async()=>{const s=await import('/storage.mjs'),db=await s.openDatabase(),p=await s.readProgress(db);db.close();return p;});
async function install(payload){await page.evaluate(async payload=>{const s=await import('/storage.mjs'),db=await s.openDatabase();await s.replaceProgress(db,payload);db.close();},payload);await page.evaluate(()=>history.replaceState(null,'',location.pathname+'?course=simplified'));await page.reload();await ready();}
async function theme(value){if(await page.locator('html').getAttribute('data-theme')!==value)await page.locator('[data-action="theme"]').click();}
async function geometry(){return page.evaluate(()=>{
  const bounds=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const columns=[...document.querySelectorAll('#prompt-code>[data-code-position]')].map(n=>{const r=n.getBoundingClientRect();return r.x+r.width/2;});
  const slots=[...document.querySelectorAll('.entry-slots span')].map(n=>{const r=n.getBoundingClientRect();return r.x+r.width/2;});
  return {target:bounds('#target'),input:bounds('.entry-wrap'),columns,slots,viewport:innerWidth,scroll:document.documentElement.scrollWidth};
});}
function assertColumns(g){assert.equal(g.columns.length,g.slots.length);for(let i=0;i<g.columns.length;i++)assert.ok(Math.abs(g.columns[i]-g.slots[i])<1,JSON.stringify(g));assert.ok(g.scroll<=g.viewport);}
async function assertRootCentered(){
  assertColumns(await geometry());
  const frame=await page.evaluate(()=>{
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    const target=rect('#target'),answer=rect('#prompt-code'),input=rect('.entry-wrap'),caption=rect('.pinyin');
    const center=r=>r.x+r.width/2;
    const cells=[...document.querySelectorAll('#prompt-code>span')].map(node=>{const r=node.getBoundingClientRect(),letter=node.querySelector('b');return {center:center(r),left:r.left,right:r.right,y:letter.getBoundingClientRect().y,size:getComputedStyle(letter).fontSize};});
    return {target:center(target),answer:center(answer),input:center(input),captionBottom:caption.bottom,answerTop:answer.top,cells,rows:[...document.querySelectorAll('.focus-stage .prompt-code')].length};
  });
  assert.equal(frame.rows,1);assert.equal(frame.cells.length,3);
  assert.ok(Math.abs((frame.cells[0].left+frame.cells[2].right)/2-frame.target)<1,JSON.stringify(frame));
  assert.ok(Math.abs(frame.input-frame.target)<1,JSON.stringify(frame));
  assert.ok(Math.abs((frame.cells[1].center-frame.cells[0].center)-(frame.cells[2].center-frame.cells[1].center))<1,JSON.stringify(frame));
  assert.equal(new Set(frame.cells.map(cell=>cell.y)).size,1);assert.equal(new Set(frame.cells.map(cell=>cell.size)).size,1);
  assert.ok(frame.captionBottom<=frame.answerTop,JSON.stringify(frame));
  return frame;
}
async function assertRootDetailCentered(){
  const frame=await page.locator('.dialog').evaluate(dialog=>{
    const target=dialog.querySelector('.detail-target').getBoundingClientRect();
    const letters=[...dialog.querySelectorAll('.prompt-code>span')].map(node=>{const r=node.getBoundingClientRect(),b=node.querySelector('b');return {left:r.left,right:r.right,center:r.left+r.width/2,y:b.getBoundingClientRect().y,size:getComputedStyle(b).fontSize};});
    return {center:target.x+target.width/2,letters,answer:dialog.querySelector('.prompt-code').getAttribute('aria-label')};
  });
  assert.equal(frame.letters.length,3);assert.equal(frame.answer,'编码 '+firstRoot.fullCode[0].toUpperCase()+firstRoot.fullCode.slice(1));
  assert.ok(Math.abs((frame.letters[0].left+frame.letters[2].right)/2-frame.center)<1,JSON.stringify(frame));
  assert.ok(Math.abs((frame.letters[1].center-frame.letters[0].center)-(frame.letters[2].center-frame.letters[1].center))<1,JSON.stringify(frame));
  assert.equal(new Set(frame.letters.map(letter=>letter.y)).size,1);assert.equal(new Set(frame.letters.map(letter=>letter.size)).size,1);
}
async function contrast(){return page.evaluate(()=>{
  const style=getComputedStyle(document.documentElement),hex=token=>style.getPropertyValue(token).trim();
  const luminance=color=>{const rgb=color.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  return Object.fromEntries(['--ink','--muted','--faint','--accent','--role-a','--role-s','--role-b','--red','--line'].map(token=>[token,Number(ratio(hex(token),hex('--bg')).toFixed(2))]));
});}
async function slowCompletion(enable){await page.evaluate(enable=>{
  if(enable){const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');window.restoreTransaction=()=>Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(fn){descriptor.set.call(this,typeof fn==='function'?event=>setTimeout(()=>fn.call(this,event),200):fn);}});}
  else window.restoreTransaction?.();
},enable);}

try{
  await page.goto(base);await ready();await page.screenshot({path:`${dir}/stroke-dark.png`});
  for(const value of ['dark','light']){await theme(value);report.contrast[value]=await contrast();for(const [token,ratio]of Object.entries(report.contrast[value]))assert.ok(ratio>=(token==='--line'?3:4.5),`${token}: ${ratio}`);}
  const due={...applyRating(null,3).card,id:character.id,verified:false,due:new Date(Date.now()-1000).toISOString()};
  await install(fixture([due]));
  const recall=await geometry();assertColumns(recall);await page.screenshot({path:`${dir}/character-recall-dark.png`});
  await page.keyboard.press('Tab');const hinted=await geometry();assert.deepEqual(hinted,recall);await page.waitForTimeout(750);
  await page.keyboard.press('Space');await page.locator('[data-phase="correction"]').waitFor();
  const correction=await geometry();assert.deepEqual(correction,recall);assert.equal(await page.locator('#code-input').inputValue(),'');
  await page.screenshot({path:`${dir}/character-correction-dark.png`});await theme('light');await page.screenshot({path:`${dir}/character-correction-light.png`});
  await page.locator('#target').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'code-input');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.resume-button').evaluate(n=>n===document.activeElement),true);
  await page.screenshot({path:`${dir}/pause-light.png`});await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.locator('#search').waitFor();assert.equal(await page.locator('main h1').evaluate(n=>n===document.activeElement),true);
  await page.screenshot({path:`${dir}/library-light.png`});
  // Redrawing a utility page must preserve keyboard focus, disclosures and scroll.
  await page.locator('[data-action="theme"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-action="theme"]').evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.locator('details,summary,.course-downloads').count(),0);
  await page.locator('#search').fill('不存在的搜尋測試字串xyz');
  await page.setViewportSize({width:320,height:700});
  assert.equal(await page.locator('[data-action="reset-filters"]').isVisible(),true);
  await page.locator('[data-action="reset-filters"]').click();
  assert.equal(await page.locator('#search').inputValue(),'');
  assert.equal(await page.locator('#search').evaluate(node=>node===document.activeElement),true);
  assert.ok(await page.locator('tbody [data-action="detail"]').count()>0);
  assert.equal(await page.locator('.mobile-item-meta').first().isVisible(),true);
  assert.ok(await page.locator('.table-wrap').evaluate(node=>node.scrollWidth<=node.clientWidth));
  await page.setViewportSize({width:1440,height:900});
  await theme('light');
  const opener=page.locator('tbody [data-action="detail"]').first();await opener.click();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[data-action="free-one"]').evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('[data-action="close-dialog"]').evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await opener.evaluate(n=>n===document.activeElement),true);
  await page.locator('[data-view="roots"]').first().click();await page.keyboard.press('l');
  assert.equal(await page.locator('.root-group').count(),1);assert.match(await page.locator('.root-group h2').textContent(),/^L/);
  await page.keyboard.press('ArrowRight');assert.match(await page.locator('.root-group h2').textContent(),/^M/);
  await page.locator('[data-action="root-key"][data-key="all"]').click();await page.locator('#root-search').fill('lff');
  assert.equal(await page.locator('.root-group').count(),1);await page.screenshot({path:`${dir}/roots-light.png`});
  await page.locator('#root-search').fill(firstRoot.fullCode);await page.locator(`.root-group button[data-id="${firstRoot.id}"]`).click();
  await assertRootDetailCentered();await page.screenshot({path:`${dir}/v12-root-detail-desktop.png`});
  await page.setViewportSize({width:375,height:812});await assertRootDetailCentered();await page.screenshot({path:`${dir}/v12-root-detail-mobile.png`});
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:900});
  await page.locator('#root-search').fill(stone.fullCode);await page.locator(`.root-group button[data-id="${stone.id}"]`).click();await page.locator('[data-action="free-one"]').click();
  await assertRootCentered();await page.screenshot({path:`${dir}/v13-stone-desktop.png`});
  await page.setViewportSize({width:375,height:812});await assertRootCentered();await page.screenshot({path:`${dir}/v13-stone-mobile.png`});
  await page.keyboard.type(stone.code);await page.locator('#search').waitFor();await page.setViewportSize({width:1440,height:900});
  await page.locator('[data-view="settings"]').first().click();await page.screenshot({path:`${dir}/settings-light.png`});
  await page.locator('#new-per-day').fill('27');
  await page.locator('[data-action="theme"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#new-per-day').inputValue(),'27');
  await page.locator('#new-per-day').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement.id==='new-per-day'&&document.querySelector('#toast').textContent.includes('已保存'));
  const rootFixture=fixture();rootFixture.cards=rootFixture.cards.filter(card=>card.id!==firstRoot.id);
  for(const [width,height]of [[375,812],[768,1024],[1024,768],[1440,900],[844,390],[375,440],[720,450]]){
    await page.setViewportSize({width,height});
    for(const value of ['dark','light']){
      await install(fixture([due]));await theme(value);const before=await geometry();assertColumns(before);assert.ok(before.input.y+before.input.height<=height,`Input below viewport: ${width}×${height}`);
      const targets=await page.locator('.header-tools button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return [r.width,r.height];}));assert.ok(targets.every(([w,h])=>w>=44&&h>=44));
      await page.keyboard.press('Space');await page.locator('[data-phase="correction"]').waitFor();assert.deepEqual(await geometry(),before);
      report.layout.push({width,height,theme:value,targetY:before.target.y,inputY:before.input.y});
      await page.screenshot({path:`${dir}/practice-${width}-${value}.png`});
      await page.keyboard.press('Control+z');await ready();
      await install(rootFixture);await theme(value);assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),firstRoot.id);
      const rootFrame=await assertRootCentered();report.rootLayout.push({width,height,theme:value,...rootFrame});
      await page.screenshot({path:`${dir}/v13-root-${width}-${height}-${value}.png`});
    }
  }
  await page.setViewportSize({width:1440,height:900});await install(fixture());
  await slowCompletion(true);
  const result=evaluateAttempt(null,{correct:true,firstExposure:true,elapsedMs:1000,codeLength:character.code.length},[],{});
  const nextCards=Object.fromEntries([...baseCards(),{...result.card,id:character.id}].map(card=>[card.id,card]));
  const second=pickContinuous(data.items,nextCards,{newToday:1,newLimit:20,history:[{itemId:character.id,wasNew:true,firstExposure:true}]}).item;
  await page.keyboard.type(character.code+second.code,{delay:0});
  await page.waitForFunction(ids=>{const node=document.querySelector('.practice');return node?.dataset.phase==='typing'&&!ids.includes(Number(node.dataset.itemId));},[character.id,second.id]);await ready();
  let p=await progress();assert.deepEqual(p.logs.map(l=>[l.itemId,l.submitted,l.correct]),[[character.id,character.code,true],[second.id,second.code,true]]);await slowCompletion(false);
  await install(fixture());await slowCompletion(true);
  await page.keyboard.type('zzzzz'+character.code,{delay:0});await page.locator('[data-phase="correction"]').waitFor();
  assert.equal(await page.locator('#code-input').inputValue(),'ZzZZz');assert.equal(await page.locator('#code-input').getAttribute('aria-invalid'),'true');p=await progress();assert.equal(p.logs.length,1);assert.equal(p.logs[0].grade,1);await slowCompletion(false);
  await install(fixture());
  await page.evaluate(()=>{window.keySamples=[];let at=0;document.addEventListener('keydown',e=>{if(e.target.id==='code-input'&&/^[a-z]$/i.test(e.key))at=performance.now();},true);document.addEventListener('input',e=>{if(e.target.id==='code-input'&&at)window.keySamples.push(performance.now()-at);});});
  await page.keyboard.type(character.code.slice(0,-1),{delay:30});report.input=await page.evaluate(()=>window.keySamples);
  assert.equal(await page.locator('#code-input').evaluate(n=>n.scrollLeft),0);
  await page.keyboard.press('Escape');await page.locator('[data-view="library"]').last().click();
  await page.locator('#search').fill('中国人民解放军');await page.locator('tbody [data-action="detail"]').first().click();await page.locator('[data-action="free-one"]').click();
  assert.equal(await page.locator('.part').count(),4);
  await page.setViewportSize({width:375,height:812});assertColumns(await geometry());await page.screenshot({path:`${dir}/long-word-mobile.png`});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-action="theme"]').evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
  await page.screenshot({path:`${dir}/reduced-motion.png`});
  const longWord=data.items.find(item=>item.text==='中国人民解放军');await page.keyboard.type(longWord.code);await page.locator('#search').waitFor();
  await page.locator('.brand').click();await ready();assert.equal(Number(await page.locator('.practice').getAttribute('data-item-id')),character.id);assert.equal(await page.locator('#code-input').inputValue(),'OeRL');assert.equal((await progress()).logs.length,0);
  await page.keyboard.type('f');await ready();assert.equal(await page.locator('#target').evaluate(node=>getComputedStyle(node).animationName),'none');
  assert.deepEqual(errors,[]);
  await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({contrast:report.contrast,layouts:report.layout.length,rootLayouts:report.rootLayout.length,keyToDOMms:report.input,rapidTyping:'passed with delayed persistence',focus:'pause, routes, modal return and root index passed'}));
}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:`${dir}/failure.png`,fullPage:true});throw error;}
finally{await context.close();await browser.close();}
