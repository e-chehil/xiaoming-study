import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const base=process.env.TEST_URL||'http://127.0.0.1:47831';
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try{
  for(let round=0;round<3;round++)for(const format of ['full','shared']){
    const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
    if(format==='full')await page.route('**/data/learning-runtime.json',route=>route.continue({url:base+'/data/learning.json'}));
    await page.addInitScript(()=>{
      const observer=new MutationObserver(()=>{if(document.querySelector('#code-input')){window.readyAt=performance.now();observer.disconnect();}});
      observer.observe(document,{childList:true,subtree:true});
    });
    await page.goto(base);await page.locator('#code-input').waitFor({timeout:30000});
    const readyMs=await page.evaluate(()=>window.readyAt);
    await page.waitForLoadState('networkidle');
    const session=await context.newCDPSession(page);await session.send('HeapProfiler.collectGarbage');
    const memory=await session.send('Runtime.getHeapUsage');results.push({round,format,readyMs,heapBytes:memory.usedSize});
    await context.close();
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary=Object.fromEntries(['full','shared'].map(format=>{const rows=results.filter(r=>r.format===format);return [format,{medianReadyMs:median(rows.map(r=>r.readyMs)),medianHeapBytes:median(rows.map(r=>r.heapBytes))}];}));
  await writeFile('artifacts/learning-v6-20261024/load-benchmark.json',JSON.stringify({environment:'Local Edge; three fresh contexts per format; same new application and course contents; dictionary settled before heap GC.',results,summary},null,2)+'\n');
  console.log(JSON.stringify(summary));
}finally{await browser.close();}
