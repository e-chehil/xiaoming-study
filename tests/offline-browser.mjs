import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extname,resolve,sep} from 'node:path';
import {launchBrowser} from './support/browser.mjs';
const root=resolve('dist'),types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff':'font/woff','.woff2':'font/woff2','.svg':'image/svg+xml','.txt':'text/plain','.md':'text/plain'},counts=new Map();
let mode='normal';const errors=[],checks=[];
const digest=b=>createHash('sha256').update(b).digest('hex');
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://local').pathname,prefix=pathname.startsWith('/xiaoming-study/')?'/xiaoming-study/':'/',path=pathname.slice(prefix.length)||'index.html';
    if(path==='harness.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Local test</title>');return;}
    const full=resolve(root,path);if(!full.startsWith(root+sep))throw Error('outside');
    let bytes=await readFile(full);
    if(mode!=='normal'&&path==='sw.mjs')bytes=Buffer.concat([bytes,Buffer.from('\n// local '+mode+' fixture\n')]);
    if(mode==='bad-update'&&path==='resource-catalog.mjs')bytes=Buffer.concat([bytes,Buffer.from("\nRESOURCES.simplified.sha256='"+'a'.repeat(64)+"';\n")]);
    if(mode!=='normal'&&path==='offline-shell.mjs'){
      const source=await readFile(resolve(root,'offline-shell.mjs'),'utf8'),start=source.indexOf('export const SHELL_FILES=')+'export const SHELL_FILES='.length,files=JSON.parse(source.slice(start).trim().replace(/;$/,''));
      for(const file of files){if(file.path==='sw.mjs'||mode==='bad-update'&&file.path==='resource-catalog.mjs'){let body=await readFile(resolve(root,file.path));body=Buffer.concat([body,Buffer.from(file.path==='sw.mjs'?'\n// local '+mode+' fixture\n':"\nRESOURCES.simplified.sha256='"+'a'.repeat(64)+"';\n")]);file.bytes=body.length;file.sha256=digest(body);}}
      bytes=Buffer.from('export const SHELL_VERSION="'+mode+'";\nexport const SHELL_FILES='+JSON.stringify(files)+';\n');
    }
    if(['data/learning-runtime.json','data/traditional/learning-runtime.json','data/cedict/dictionary.json'].includes(path))counts.set(prefix+path,(counts.get(prefix+path)||0)+1);
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404);res.end('not found');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port,browser=await launchBrowser();
async function ready(page){await page.locator('#code-input:not([readonly])').waitFor({timeout:45000});}
async function workerReady(page){await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
async function progress(page,base,course='simplified'){return page.evaluate(async({base,course})=>{const s=await import(base+'storage.mjs'),db=await s.openDatabase(course),p=await s.readProgress(db);db.close();return p;},{base,course});}
try{
  for(const prefix of ['/','/xiaoming-study/']){
    const base=origin+prefix,context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await ready(page);await workerReady(page);
    assert.equal(counts.get(prefix+'data/learning-runtime.json'),1);assert.equal(counts.get(prefix+'data/traditional/learning-runtime.json')||0,0);assert.equal(counts.get(prefix+'data/cedict/dictionary.json')||0,0,'Dictionary must be demand loaded');
    await page.keyboard.type('j');await page.waitForFunction(async base=>{const s=await import(base+'storage.mjs'),db=await s.openDatabase(),p=await s.readProgress(db);db.close();return p.logs.length===1;},base);
    const before=await progress(page,base);assert.equal(before.logs.length,1);
    await page.locator('.pause-button').click();await page.locator('.menu-links [data-view="dictionary"]').click();await page.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');assert.equal(counts.get(prefix+'data/cedict/dictionary.json'),1);
    await page.locator('#course-toggle').click();await page.waitForFunction(()=>document.querySelector('#course-toggle')?.dataset.course==='traditional'&&!document.querySelector('#course-toggle').disabled);await ready(page);assert.equal(counts.get(prefix+'data/traditional/learning-runtime.json'),1);
    await context.setOffline(true);await page.close();const offline=await context.newPage();offline.on('pageerror',e=>errors.push(e.message));await offline.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await ready(offline);assert.equal(await offline.locator('#course-toggle').getAttribute('data-course'),'traditional');
    await offline.locator('#course-toggle').click();await offline.waitForFunction(()=>document.querySelector('#course-toggle')?.dataset.course==='simplified'&&!document.querySelector('#course-toggle').disabled);await ready(offline);assert.deepEqual(await progress(offline,base),before);
    await offline.locator('.pause-button').click();await offline.locator('.menu-links [data-view="dictionary"]').click();await offline.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');
    assert.equal(counts.get(prefix+'data/learning-runtime.json'),1);assert.equal(counts.get(prefix+'data/traditional/learning-runtime.json'),1);assert.equal(counts.get(prefix+'data/cedict/dictionary.json'),1);
    checks.push(prefix+': first visit downloads selected course only; demand dictionary; offline reopen, both scripts and dictionary; FSRS unchanged; no network course revalidation');
    if(prefix==='/'){
      await offline.locator('header [data-action="resume"]').first().click();await ready(offline);
      await offline.locator('header [data-view="library"]').click();await offline.locator('#type-filter').selectOption('root');await offline.locator('#search').fill('石');await offline.waitForURL(url=>url.searchParams.get('q')==='石',{timeout:5000});assert.equal(new URL(offline.url()).searchParams.get('q'),'石');await offline.reload();await offline.locator('#search').waitFor();assert.equal(await offline.locator('#search').inputValue(),'石');assert.equal(await offline.locator('#type-filter').inputValue(),'root');await offline.locator('header [data-action="resume"]').first().click();await ready(offline);checks.push('Filtered course URL restores correctly during offline reload');
      await offline.evaluate(async base=>{const m=await import(base+'resource-store.mjs'),c=await caches.open(m.resourceStore.cacheName),r=await import(base+'resource-catalog.mjs');await c.put(m.resourceStore.key(r.RESOURCES.simplified),new Response('<html>damaged</html>',{headers:{'Content-Type':'application/json'}}));},base);
      await offline.reload();await offline.locator('[data-action="reload"]').waitFor();assert.deepEqual(await progress(offline,base),before);
      await context.setOffline(false);await offline.locator('[data-action="reload"]').click();await ready(offline);assert.deepEqual(await progress(offline,base),before);checks.push('Corrupt cache is rejected, offline retry is usable and online recovery preserves FSRS');
      mode='bad-update';
      const update=await offline.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;return new Promise(async(resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Update was not observed')),30000);registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker.addEventListener('statechange',()=>{if(worker.state==='redundant'){clearTimeout(timer);resolve('rejected');}});},{once:true});await registration.update();});});
      assert.equal(update,'rejected');mode='normal';await context.setOffline(true);await offline.reload();await ready(offline);assert.deepEqual(await progress(offline,base),before);checks.push('Bad new resource version prevents worker activation; previous complete page and course still work offline');
      await context.setOffline(false);mode='good-update';const downloads=counts.get(prefix+'data/learning-runtime.json');await offline.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await new Promise(async(resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Good update not observed')),30000);registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker.addEventListener('statechange',()=>{if(worker.state==='installed'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error('Good update rejected'));}});},{once:true});await registration.update();});if(!registration.waiting)throw Error('Update should wait for the current practice');});await context.setOffline(true);await offline.close();const upgraded=await context.newPage();await upgraded.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await ready(upgraded);assert.deepEqual(await progress(upgraded,base),before);assert.equal(counts.get(prefix+'data/learning-runtime.json'),downloads);await upgraded.close();mode='normal';checks.push('Valid program update waits for old tabs, reuses installed course and opens offline with FSRS intact');
    }
    await context.close();console.log(checks.at(-1));
  }
  const cross=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json',...(req.url==='/allowed'?{'Access-Control-Allow-Origin':'*'}:{})});res.end('{"ok":true}');});cross.listen(0,'127.0.0.1');await once(cross,'listening');
  try{const context=await browser.newContext(),page=await context.newPage();await page.goto(origin+'/harness.html');const result=await page.evaluate(async({origin,cross})=>{const {createResourceStore}=await import(origin+'/resource-store.mjs'),raw=new TextEncoder().encode('{"ok":true}'),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(b=>b.toString(16).padStart(2,'0')).join('');const store=createResourceStore({records:{test:{id:'test',path:'test.json',bytes:raw.length,sha256:sha}},validate:()=>{},sources:()=>[cross+'/denied',cross+'/allowed']});return store.load('test');},{origin,cross:'http://127.0.0.1:'+cross.address().port});assert.deepEqual(result,{ok:true});await context.close();checks.push('Real browser CORS denial falls back to an allowed cross-origin source');}finally{cross.closeAllConnections();await new Promise(r=>cross.close(r));}
  assert.deepEqual(errors,[]);await mkdir('artifacts/offline',{recursive:true});await writeFile('artifacts/offline/report.json',JSON.stringify({checks,errors,counts:Object.fromEntries(counts)},null,2)+'\n');console.log('Offline browser passed: '+checks.join('; '));
}catch(error){for(const c of browser.contexts())for(const p of c.pages()){console.error('Offline failure URL: '+p.url());try{console.error((await p.locator('body').innerText({timeout:1000})).slice(0,500));}catch{}}throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
