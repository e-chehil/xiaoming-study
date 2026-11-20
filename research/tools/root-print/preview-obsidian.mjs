import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(path.resolve(process.env.XIAOMING_STUDY_REPO || path.join(root,'..'),'package.json'));
const {chromium}=require('playwright-core');
await fs.mkdir(path.join(root,'tmp/pdfs/xiaoming-roots'),{recursive:true});
const md=await fs.readFile(path.join(root,'output/obsidian/潇明字根总表.md'),'utf8');
const css=await fs.readFile(path.join(root,'output/obsidian/xiaoming-roots.css'),'utf8');
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let html='',open=false;
for(const line of md.split('\n')){
 if(line.startsWith('## ')){
  if(open){html+='</tbody></table>';open=false}
  html+='<h2>'+esc(line.slice(3))+'</h2>';
 }else if(line==='| 字根 | 例字 |'){
  html+='<table><thead><tr><th>字根</th><th>例字</th></tr></thead><tbody>';open=true;
 }else if(open&&line.startsWith('| ')&&!line.startsWith('| :')){
  const cells=line.slice(1,-1).split('|').map(x=>x.trim());
  html+='<tr>'+cells.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>';
 }
}
if(open)html+='</tbody></table>';
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH,channel:process.env.EDGE_PATH?undefined:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:960,height:1000},deviceScaleFactor:1.5});
 await page.setContent('<meta charset="utf-8"><style>:root{--font-text:"SimSun"}body{margin:30px;font-family:SimSun;font-size:18px}article{max-width:760px;margin:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 14px;text-align:left}h1{font-size:30px}h2{margin:30px 0 12px}'+css+'</style><article class="markdown-preview-view xiaoming-root-table"><h1>潇明字根总表</h1><p>19 个大码 · 397 个字根</p>'+html+'</article><div class="markdown-source-view xiaoming-root-table"><div class="cm-content"><div class="cm-line">\uf782 \uf6a5</div></div></div><div id="control">普通笔记</div>');
 await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(()=>({roots:document.querySelectorAll('tbody tr').length,fontLoaded:document.fonts.check('24px XiaomingRoots','\uf782'),previewFont:getComputedStyle(document.querySelector('td')).fontFamily,editorFont:getComputedStyle(document.querySelector('.cm-line')).fontFamily,ordinaryFont:getComputedStyle(document.querySelector('#control')).fontFamily}));
 if(result.roots!==397||!result.fontLoaded||!result.previewFont.includes('XiaomingRoots')||!result.editorFont.includes('XiaomingRoots')||result.ordinaryFont.includes('XiaomingRoots'))throw new Error(JSON.stringify(result));
 await page.screenshot({path:path.join(root,'tmp/pdfs/xiaoming-roots/obsidian-preview.png')});
 console.log(JSON.stringify(result));
}finally{await browser.close()}
