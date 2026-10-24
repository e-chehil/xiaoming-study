function state(value){document.documentElement.dataset.offline=value;document.dispatchEvent(new Event('xiaoming-offline-state'));}
export async function prepareOffline(){
  if(!('serviceWorker' in navigator)){state('unavailable');return;}
  state('preparing');
  try{
    const registration=await navigator.serviceWorker.register(new URL('./sw.mjs',import.meta.url),{type:'module',scope:new URL('./',import.meta.url).pathname,updateViaCache:'none'});
    void navigator.serviceWorker.ready.then(()=>state('ready'));
    const observe=worker=>worker?.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&registration.active)document.documentElement.dataset.update='ready';
      if(worker.state==='redundant'&&!registration.active)state('unavailable');
    });
    observe(registration.installing);registration.addEventListener('updatefound',()=>observe(registration.installing));
  }catch{state('unavailable');}
}
