import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {launchBrowser} from './support/browser.mjs';
const browser=await launchBrowser(),page=await browser.newPage();
const errors=[],bad=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/.test(m.text()))errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)bad.push(r.url());});page.on('request',r=>requests.push(r.url()));
const root=fileURLToPath(new URL('../',import.meta.url));let server;
try{
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin='http://127.0.0.1:'+port,base=origin+'/xiaoming-study/';
  server=spawn(process.execPath,['scripts/serve.mjs','--built'],{cwd:root,env:{...process.env,XIAOMING_PORT:String(port),XIAOMING_BASE_PATH:'/xiaoming-study/'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  const deadline=Date.now()+10000;while(!output.includes('Local:')){if(server.exitCode!==null||Date.now()>deadline)throw new Error(output||'Server not ready');await new Promise(resolve=>setTimeout(resolve,25));}
  await page.goto(base);await page.locator('#code-input:not([readonly])').waitFor();
  for(const course of ['simplified','traditional']){
    if(await page.locator('#course-toggle').getAttribute('data-course')!==course){await page.locator('#course-toggle').click();await page.waitForFunction(course=>document.querySelector('#course-toggle')?.dataset.course===course&&!document.querySelector('#course-toggle').disabled,course);}
    await page.locator('#code-input:not([readonly])').waitFor();await page.locator('.pause-button').click();await page.locator('.menu-links [data-view="help"]').click();
    assert.equal(await page.locator('main a[href]').count(),0,'Learning help must not contain resource or license links');
    assert.doesNotMatch(await page.locator('main').innerText(),/CC-CEDICT|FSRS|Noto|OpenCC|MIT|许可|許可|原表/);
    await page.locator('.pause-button').click();await page.locator('.menu-links [data-view="dictionary"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.dictionary==='ready');
    assert.equal(await page.locator('main a[href],.dictionary-credit').count(),0);
    await page.locator('header [data-action="resume"]').first().click();
  }
  for(const file of ['vendor/THIRD_PARTY_NOTICES.md','vendor/FSRS-LICENSE.txt','vendor/NotoSerifTC-OFL.txt','data/cedict/NOTICE.txt'])assert.equal((await page.request.get(base+file)).status(),200,file);
  assert.ok(requests.every(url=>url.startsWith(base)),'A runtime asset escaped the project subpath');
  assert.deepEqual(bad,[]);assert.deepEqual(errors,[]);
  assert.equal((await page.request.get(base+'focus.css',{method:'HEAD'})).status(),200);
  assert.equal((await page.request.post(base)).status(),405);
  for(const path of ['package.json','scripts/serve.mjs','tests/data.test.mjs','.env','%2e%2e/package.json'])assert.ok([403,404].includes((await page.request.get(base+path)).status()),path);
  assert.equal((await page.request.get(base+'%')).status(),400);
  const manifest=await page.request.get(base+'asset-manifest.json').then(r=>r.json());assert.equal(manifest.version,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);assert.ok(manifest.files.every(f=>!f.path.startsWith('tests/')&&!f.path.startsWith('scripts/')));
  const transient=await browser.newContext(),resilient=await transient.newPage();let attempts=0;
  await resilient.route('**/data/learning-runtime.json',route=>++attempts===1?route.fulfill({status:503,body:'temporary failure'}):route.continue());
  await resilient.goto(base);await resilient.locator('#code-input:not([readonly])').waitFor();assert.equal(attempts,2);await transient.close();
  const missingModule=await browser.newContext(),fallback=await missingModule.newPage();
  await fallback.route('**/practice.mjs*',route=>route.fulfill({status:503,contentType:'text/javascript',body:''}));
  await fallback.goto(base);await fallback.waitForFunction(()=>document.querySelector('#loading-status')?.textContent.includes('未能打开'));
  assert.equal(await fallback.locator('.loading a').getAttribute('href'),'./');
  await fallback.unroute('**/practice.mjs*');await fallback.locator('.loading a').click();await fallback.locator('#code-input:not([readonly])').waitFor();await missingModule.close();
  const recovery=await browser.newContext(),retry=await recovery.newPage(),recoveryErrors=[];
  retry.on('pageerror',e=>recoveryErrors.push(e.message));retry.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/.test(m.text()))recoveryErrors.push(m.text());});
  await retry.route('**/data/learning-runtime.json',r=>r.fulfill({status:503,body:'technical-response-canary'}));
  await retry.goto(base);await retry.locator('[data-action="reload"]').waitFor();
  assert.doesNotMatch(await retry.locator('main').innerText(),/technical-response-canary|Error|JSON|FSRS/);
  await retry.unroute('**/data/learning-runtime.json');await retry.locator('[data-action="reload"]').click();await retry.locator('#code-input:not([readonly])').waitFor();
  await retry.locator('header [data-view="settings"]').click();
  await retry.locator('#backup-input').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"private-invalid-json-canary":')});
  await retry.waitForFunction(()=>document.querySelector('#toast').textContent.length>0);
  assert.doesNotMatch(await retry.locator('#toast').textContent(),/private-invalid-json-canary|SyntaxError|Unexpected|position/);
  assert.equal(await retry.locator('[data-action="confirm-import"]').count(),0);assert.deepEqual(recoveryErrors,[]);await recovery.close();
  console.log('Release browser passed: built site under project subpath, both courses, CSP, learner-facing copy, transient retry, bootstrap failure recovery, load failure recovery, invalid backup, bundled notices, static asset boundary, HEAD and method validation.');
}finally{await browser.close();if(server&&server.exitCode===null){server.kill();await once(server,'exit');}}
