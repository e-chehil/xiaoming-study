import {verifyShellBytes} from './offline-integrity.mjs';
import {SHELL_VERSION,SHELL_FILES} from './offline-shell.mjs';
import {resourceStore,scopePrefix} from './resource-store.mjs';
const base=new URL('./',import.meta.url),prefix=scopePrefix(base),shellName=prefix+'shell-'+SHELL_VERSION;
const files=new Map(SHELL_FILES.map(file=>[new URL(file.path,base).pathname,file]));
async function fetchFile(file){
  const response=await fetch(new URL(file.path,base),{cache:'reload',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('离线页面下载失败');
  const bytes=await verifyShellBytes(new Uint8Array(await response.arrayBuffer()),file);
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');return new Response(bytes,{headers});
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(shellName);
  try{
    let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<SHELL_FILES.length){const file=SHELL_FILES[cursor++];await cache.put(new URL(file.path,base),await fetchFile(file));}}));
    for(const id of ['simplified','traditional'])if(await resourceStore.hasInstalled(id)){let persisted=false;await resourceStore.load(id,{onStatus:state=>{if(state.phase==='ready')persisted=state.persisted;}});if(!persisted)throw new Error('新版课程尚未保存');}
    await cache.put(new URL('__offline_complete__',base),new Response(SHELL_VERSION));
  }catch(error){await caches.delete(shellName);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const old=(await caches.keys()).filter(name=>name.startsWith(prefix+'shell-')&&name!==shellName);
  for(const name of old.slice(0,-1))await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
  const navigation=request.mode==='navigate'&&[base.pathname,new URL('index.html',base).pathname].includes(url.pathname);
  const file=navigation?files.get(new URL('index.html',base).pathname):files.get(url.pathname);
  if(!file)return;
  event.respondWith((async()=>{const cache=await caches.open(shellName),key=new URL(file.path,base),saved=await cache.match(key);return saved||fetchFile(file);})());
});
