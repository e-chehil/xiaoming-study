void import('./offline-client.mjs').then(module=>module.prepareOffline()).catch(()=>{document.documentElement.dataset.offline='unavailable';document.dispatchEvent(new Event('xiaoming-offline-state'));});
const status=document.querySelector('#loading-status');
const entry=new URL('./practice.mjs',import.meta.url),version=new URL(import.meta.url).searchParams.get('v');
if(version)entry.searchParams.set('v',version);
import(entry.href).catch(error=>{console.error('Page initialization failed',error);if(status)status.textContent='页面未能打开，请检查网络后重新加载。';});
