import {RESOURCES,resourceSources} from './resource-catalog.mjs';
import {hydrateCourse} from './lesson-data.mjs';
export const scopePrefix=base=>'xiaoming-study:'+new URL('./',base).href+':';
export async function validateResource(data,record){
  if(record.id==='dictionary'){
    if(data?.version!==1||!Array.isArray(data.entries)||data.entries.length!==data.source?.entries||!data.entries.length)throw new Error('词典结构无效');
    for(const row of data.entries)if(!Array.isArray(row)||row.length!==5||row.slice(0,3).some(v=>typeof v!=='string')||!Array.isArray(row[3])||row[3].some(v=>typeof v!=='string')||!Number.isSafeInteger(row[4]))throw new Error('词典条目无效');
  }else{if(data?.course!==record.id)throw new Error('课程不匹配');hydrateCourse(data);}
  return data;
}
export function createResourceStore({base=new URL('./',import.meta.url),records=RESOURCES,cacheStorage=globalThis.caches,fetcher=globalThis.fetch,crypto=globalThis.crypto,locks=globalThis.navigator?.locks,validate=validateResource,sources=record=>resourceSources(record,base),headerTimeoutMs=6500,idleTimeoutMs=15000,totalTimeoutMs=180000}={}){
  const cacheName=scopePrefix(base)+'resources-v1',pending=new Map();
  const key=record=>new URL('__resources__/'+record.id+'/'+record.sha256+'.json',base).href;
  async function verified(bytes,record){
    if(bytes.byteLength!==record.bytes)throw new Error('资源大小不符');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==record.sha256)throw new Error('资源校验失败');
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));await validate(data,record);return data;
  }
  async function download(url,record,onStatus){
    const controller=new AbortController();let timer,total,reader;
    const timeoutError=new DOMException('资源加载超时','TimeoutError');
    const stop=()=>controller.abort();
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(timeoutError),{once:true}));
    const tick=ms=>{clearTimeout(timer);timer=setTimeout(stop,ms);};
    try{
      tick(headerTimeoutMs);total=setTimeout(stop,totalTimeoutMs);
      const response=await Promise.race([fetcher(url,{signal:controller.signal,cache:'default',credentials:'omit'}),aborted]);
      if(!response.ok||!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw new Error('资源响应无效');}
      tick(idleTimeoutMs);const chunks=[];let received=0;
      if(response.body?.getReader){
        reader=response.body.getReader();
        for(;;){const result=await Promise.race([reader.read(),aborted]);if(result.done)break;tick(idleTimeoutMs);received+=result.value.byteLength;if(received>record.bytes)throw new Error('资源大小超限');chunks.push(result.value);onStatus?.({phase:'downloading',received,total:record.bytes});}
      }else{const bytes=new Uint8Array(await Promise.race([response.arrayBuffer(),aborted]));received=bytes.length;chunks.push(bytes);}
      const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      onStatus?.({phase:'verifying',received,total:record.bytes});
      return {bytes,data:await verified(bytes,record)};
    }finally{
      clearTimeout(timer);clearTimeout(total);controller.abort();
      if(reader)void reader.cancel().catch(()=>{}).finally(()=>{try{reader.releaseLock();}catch{}});
    }
  }
  async function install(record,onStatus){
    let cache;
    try{cache=await cacheStorage?.open(cacheName);}catch{}
    onStatus?.({phase:'checking'});
    if(cache){
      try{const response=await cache.match(key(record));if(response){const data=await verified(await response.arrayBuffer(),record);onStatus?.({phase:'ready',cached:true,persisted:true});return data;}}
      catch{await cache.delete(key(record)).catch(()=>{});}
    }
    const candidates=sources(record);let error;
    for(let i=0;i<candidates.length;i++){
      onStatus?.({phase:i?'switching':'connecting',attempt:i+1});
      try{
        const result=await download(candidates[i],record,onStatus);let persisted=false;
        if(cache)try{await cache.put(key(record),new Response(result.bytes,{headers:{'Content-Type':'application/json','X-Xiaoming-SHA256':record.sha256}}));persisted=true;}catch{}
        onStatus?.({phase:'ready',cached:false,persisted});return result.data;
      }catch(cause){error=cause;}
    }
    throw new Error('所有来源暂时无法读取资源',{cause:error});
  }
  function load(id,{onStatus}={}){
    const record=records[id];if(!record)return Promise.reject(new Error('未知资源'));
    if(!pending.has(id)){
      const run=()=>install(record,onStatus),name=cacheName+':'+id+':'+record.sha256;
      const promise=(locks?.request?locks.request(name,run):run()).finally(()=>pending.delete(id));pending.set(id,promise);
    }
    return pending.get(id);
  }
  async function hasInstalled(id){try{const cache=await cacheStorage.open(cacheName);return (await cache.keys()).some(request=>new URL(request.url).pathname.includes('/__resources__/'+id+'/'));}catch{return false;}}
  return {load,hasInstalled,cacheName,key};
}
export const resourceStore=createResourceStore();
