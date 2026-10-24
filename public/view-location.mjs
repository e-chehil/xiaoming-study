const views=new Set(['practice','library','roots','stats','settings','help','dictionary','menu']);
const types=new Set(['all','initial','stroke','root','char','word','short','variant']);
const states=new Set(['all','new','learned','unsupported']);
export function readLocation(href){
  const p=new URL(href).searchParams,course=['simplified','traditional'].includes(p.get('course'))?p.get('course'):null;
  return {view:views.has(p.get('view'))?p.get('view'):'practice',course,search:(p.get('q')||'').slice(0,500),filter:types.has(p.get('type'))?p.get('type'):'all',stateFilter:states.has(p.get('state'))?p.get('state'):'all',page:Math.max(1,Math.min(100000,Number.parseInt(p.get('page'),10)||1))};
}
export function viewURL(href,{view,course,search='',filter='all',stateFilter='all',page=1}){
  const url=new URL(href);for(const key of ['view','course','q','type','state','page'])url.searchParams.delete(key);
  url.searchParams.set('course',course);if(view!=='practice')url.searchParams.set('view',view);
  if(view==='library'){if(search)url.searchParams.set('q',search);if(filter!=='all')url.searchParams.set('type',filter);if(stateFilter!=='all')url.searchParams.set('state',stateFilter);if(page>1)url.searchParams.set('page',String(page));}
  return url.href;
}
