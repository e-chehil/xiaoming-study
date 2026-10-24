import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson} from '../public/request.mjs';
const fast={retryDelayMs:0,idleTimeoutMs:30,totalTimeoutMs:1000};
test('JSON requests use browser caching and decode split UTF-8 correctly',async()=>{
 const bytes=new TextEncoder().encode('{"字":"好"}');let options;
 const value=await requestJson('/course',{...fast,fetcher:async(url,init)=>{options=init;return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,3));c.enqueue(bytes.slice(3,8));c.enqueue(bytes.slice(8));c.close();}}));}});
 assert.deepEqual(value,{字:'好'});assert.equal(options.cache,'default');assert.ok(options.signal instanceof AbortSignal);
});
test('transient HTTP failures retry and bypass the failed cache entry',async()=>{
 const modes=[],retries=[];const value=await requestJson('/course',{...fast,onRetry:n=>retries.push(n),fetcher:async(url,init)=>{modes.push(init.cache);return modes.length===1?new Response('unavailable',{status:503}):Response.json({ready:true});}});
 assert.deepEqual(value,{ready:true});assert.deepEqual(modes,['default','reload']);assert.deepEqual(retries,[1]);
});
test('network failures retry but missing resources and invalid JSON fail directly',async()=>{
 let calls=0;assert.deepEqual(await requestJson('/course',{...fast,fetcher:async()=>{if(!calls++)throw new TypeError('network');return Response.json({ready:true});}}),{ready:true});assert.equal(calls,2);
 calls=0;await assert.rejects(requestJson('/missing',{...fast,fetcher:async()=>{calls++;return new Response('',{status:404});}}),e=>e.status===404);assert.equal(calls,1);
 calls=0;await assert.rejects(requestJson('/invalid',{...fast,fetcher:async()=>{calls++;return new Response('{');}}),SyntaxError);assert.equal(calls,1);
});
test('a request that never receives headers times out and stops after its retry budget',{timeout:2000},async()=>{
 const signals=[];await assert.rejects(requestJson('/stalled',{...fast,idleTimeoutMs:10,fetcher:async(url,init)=>{signals.push(init.signal);return new Promise(()=>{});}}),e=>e.name==='TimeoutError');assert.equal(signals.length,2);assert.ok(signals.every(s=>s.aborted));
});
test('a stalled body also times out and releases its stream',{timeout:2000},async()=>{
 let canceled=0;await assert.rejects(requestJson('/stalled-body',{...fast,idleTimeoutMs:10,attempts:1,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){canceled++;}}))}),e=>e.name==='TimeoutError');assert.equal(canceled,1);
});
test('active streaming resets the inactivity timer',{timeout:2000},async()=>{
 let timer,index=0;const chunks=['{"ready":', 'true', '}'];
 const result=await requestJson('/slow-active',{...fast,idleTimeoutMs:35,fetcher:async()=>new Response(new ReadableStream({start(c){timer=setInterval(()=>{c.enqueue(new TextEncoder().encode(chunks[index++]));if(index===chunks.length){clearInterval(timer);c.close();}},20);},cancel(){clearInterval(timer);}}))});
 assert.deepEqual(result,{ready:true});
});
