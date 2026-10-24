class HttpError extends Error {
  constructor(status){super('资源暂时无法加载');this.name='HttpError';this.status=status;}
}
function retryable(error){return error?.name==='TimeoutError'||error?.name==='AbortError'||error instanceof TypeError||error?.status===408||error?.status===429||error?.status>=500;}
export async function requestJson(url,{attempts=2,idleTimeoutMs=15000,totalTimeoutMs=90000,retryDelayMs=600,onRetry,fetcher=globalThis.fetch}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    const controller=new AbortController();let idleTimer,totalTimer,reader;
    const timeoutError=new DOMException('资源加载超时','TimeoutError');
    const timeout=()=>controller.abort(timeoutError);
    const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(timeout,idleTimeoutMs);};
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(timeoutError),{once:true}));
    try{
      resetIdle();totalTimer=setTimeout(timeout,totalTimeoutMs);
      const response=await Promise.race([fetcher(url,{cache:attempt?'reload':'default',signal:controller.signal}),aborted]);
      if(!response.ok){await response.body?.cancel();throw new HttpError(response.status);}
      resetIdle();let text;
      if(response.body?.getReader){
        reader=response.body.getReader();const decoder=new TextDecoder(),chunks=[];
        for(;;){const result=await Promise.race([reader.read(),aborted]);if(result.done)break;resetIdle();chunks.push(decoder.decode(result.value,{stream:true}));}
        chunks.push(decoder.decode());text=chunks.join('');
      }else text=await Promise.race([response.text(),aborted]);
      return JSON.parse(text);
    }catch(error){
      if(attempt+1>=attempts||!retryable(error))throw error;
      onRetry?.(attempt+1);
    }finally{
      clearTimeout(idleTimer);clearTimeout(totalTimer);
      if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
      controller.abort();
    }
    await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
  }
}
