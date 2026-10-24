const status=document.querySelector('#loading-status');
const entry=new URL('./practice.mjs',import.meta.url),version=new URL(import.meta.url).searchParams.get('v');
if(version)entry.searchParams.set('v',version);
try{await import(entry.href);}
catch(error){console.error('Page initialization failed',error);if(status)status.textContent='页面未能打开，请检查网络后重新加载。';}
