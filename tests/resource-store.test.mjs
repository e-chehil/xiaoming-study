import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createResourceStore,validateResource} from '../public/resource-store.mjs';
import {RESOURCES,resourceSources,DATA_COMMIT} from '../public/resource-catalog.mjs';
class MemoryCache{
  rows=new Map();
  async match(key){return this.rows.get(String(key))?.clone();}
  async put(key,response){this.rows.set(String(key),response.clone());}
  async delete(key){return this.rows.delete(String(key));}
  async keys(){return [...this.rows.keys()].map(url=>new Request(url));}
}
function storage(){const cache=new MemoryCache();return {cache,async open(){return cache;}};}
const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
function record(value,id='simplified'){const data=bytes(value);return {id,path:id+'.json',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}
function setup({value={ok:true},id='simplified',cacheStorage=storage(),...options}={}){
  const info=record(value,id),store=createResourceStore({base:new URL('https://site.test/study/'),records:{[id]:info},cacheStorage,sources:()=>['https://one.test/data','https://two.test/data'],validate:()=>{},headerTimeoutMs:30,idleTimeoutMs:30,totalTimeoutMs:300,...options});
  return {store,info,cacheStorage};
}
test('pinned sources cover both complete courses and dictionary, with an explicit third-party switch',async()=>{
  assert.match(DATA_COMMIT,/^[a-f0-9]{40}$/);
  for(const info of Object.values(RESOURCES)){
    const data=await readFile(new URL('../public/'+info.path,import.meta.url));assert.equal(data.length,info.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),info.sha256);await validateResource(JSON.parse(data),info);
    const sources=resourceSources(info,new URL('https://site.test/study/'));assert.ok(sources.some(url=>url.startsWith('https://cdn.jsdmirror.com/gh/')&&url.includes('@'+DATA_COMMIT)));assert.ok(sources.some(url=>url.startsWith('https://cdn.jsdelivr.net/gh/')));assert.ok(!sources.some(url=>url.includes('cdn.jsdmirror.cn')));
    assert.ok(!resourceSources(info,new URL('https://site.test/study/'),{thirdParty:false}).some(url=>url.includes('/gh/')));
  }
});
test('a valid persistent cache is read without any network access',async()=>{
  let calls=0;const states=[],s=setup({fetcher:async()=>{calls++;return Response.json({ok:true});}});await s.store.load('simplified');
  const offline=setup({cacheStorage:s.cacheStorage,fetcher:async()=>{throw new Error('Network must not be checked');}});assert.deepEqual(await offline.store.load('simplified',{onStatus:s=>states.push(s)}),{ok:true});assert.equal(calls,1);assert.deepEqual(states.at(-1),{phase:'ready',cached:true,persisted:true});
});
test('HTTP and CORS failures switch sources sequentially, without duplicate full-file downloads',async()=>{
  const calls=[],s=setup({sources:()=>['https://one.test/a','https://two.test/a','https://three.test/a'],fetcher:async url=>{calls.push(url);if(calls.length===1)return new Response('error',{status:503});if(calls.length===2)throw new TypeError('CORS refused');return Response.json({ok:true});}});
  assert.deepEqual(await s.store.load('simplified'),{ok:true});assert.equal(calls.length,3);
});
test('HTML error pages with HTTP 200 and corrupt JSON bytes never become valid cache entries',async()=>{
  let calls=0;const s=setup({sources:()=>['a','b','c'],fetcher:async()=>{calls++;return calls===1?new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}}):calls===2?Response.json({ok:false}):Response.json({ok:true});}});
  await s.store.load('simplified');assert.equal(calls,3);assert.equal(s.cacheStorage.cache.rows.size,1);assert.deepEqual(await (await s.cacheStorage.cache.match(s.store.key(s.info))).json(),{ok:true});
});
test('a stalled source is aborted before moving on',async()=>{
  let signal,calls=0;const s=setup({fetcher:async(url,init)=>{calls++;if(calls===1){signal=init.signal;return new Promise(()=>{});}assert.ok(signal.aborted);return Response.json({ok:true});}});await s.store.load('simplified');assert.equal(calls,2);
});
test('body interruption cancels the stream and retries another source',async()=>{
  let calls=0,canceled=false;const s=setup({fetcher:async()=>++calls===1?new Response(new ReadableStream({start(c){c.enqueue(bytes({ok:true}).slice(0,3));},cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}}):Response.json({ok:true})});await s.store.load('simplified');assert.ok(canceled);assert.equal(calls,2);
});
test('damaged local cache is discarded and repaired from a validated download',async()=>{
  let calls=0;const s=setup({fetcher:async()=>{calls++;return Response.json({ok:true});}});await s.cacheStorage.cache.put(s.store.key(s.info),Response.json({poison:true}));await s.store.load('simplified');assert.equal(calls,1);assert.deepEqual(await (await s.cacheStorage.cache.match(s.store.key(s.info))).json(),{ok:true});
});
test('a failed new version leaves the old valid course intact and usable offline',async()=>{
  const first=setup({fetcher:async()=>Response.json({ok:true})});await first.store.load('simplified');
  const update=setup({value:{updated:true},cacheStorage:first.cacheStorage,fetcher:async()=>Response.json({wrong:true})});await assert.rejects(update.store.load('simplified'));assert.equal(first.cacheStorage.cache.rows.size,1);
  const old=setup({cacheStorage:first.cacheStorage,fetcher:async()=>{throw Error('offline');}});assert.deepEqual(await old.store.load('simplified'),{ok:true});
});
test('quota failure does not erase an earlier valid version or claim that offline saving succeeded',async()=>{
  const cacheStorage=storage();const first=setup({cacheStorage,fetcher:async()=>Response.json({ok:true})});await first.store.load('simplified');cacheStorage.cache.put=async()=>{throw new DOMException('quota','QuotaExceededError');};
  const states=[],next=setup({value:{next:true},cacheStorage,fetcher:async()=>Response.json({next:true})});assert.deepEqual(await next.store.load('simplified',{onStatus:s=>states.push(s)}),{next:true});assert.equal(states.at(-1).persisted,false);assert.equal(cacheStorage.cache.rows.size,1);
});
test('concurrent requests, including separate tabs with Web Locks, share one download',async()=>{
  const cacheStorage=storage();let tail=Promise.resolve(),calls=0;const locks={request(name,fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
  const options={cacheStorage,locks,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json({ok:true});}},a=setup(options),b=setup(options);
  await Promise.all([a.store.load('simplified'),a.store.load('simplified'),b.store.load('simplified')]);assert.equal(calls,1);
});
test('a matching hash cannot bypass course structure validation',async()=>{
  const s=setup({value:{version:3,course:'simplified',items:[]},validate:undefined,fetcher:async()=>Response.json({version:3,course:'simplified',items:[]})});await assert.rejects(s.store.load('simplified'));assert.equal(s.cacheStorage.cache.rows.size,0);
});

test('a successfully validated new resource version coexists with the previous offline version',async()=>{
  const cacheStorage=storage(),old=setup({cacheStorage,fetcher:async()=>Response.json({ok:true})});await old.store.load('simplified');
  const next=setup({value:{newVersion:true},cacheStorage,fetcher:async()=>Response.json({newVersion:true})});await next.store.load('simplified');assert.equal(cacheStorage.cache.rows.size,2);
  assert.deepEqual(await (await cacheStorage.cache.match(old.store.key(old.info))).json(),{ok:true});assert.deepEqual(await (await cacheStorage.cache.match(next.store.key(next.info))).json(),{newVersion:true});
});
