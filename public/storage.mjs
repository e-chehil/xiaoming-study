// Keep the persistent namespace stable for existing learning progress.
const DATABASE = 'xiaoming-study-dev-v5';
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const complete = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存已取消')); });
export class ProgressConflictError extends Error {
  constructor(){super('其他页面已更新学习进度');this.name='ProgressConflictError';}
}
// Compare and advance the revision inside the same transaction as every write.
// Atomic writes alone cannot protect callers holding an older in-memory snapshot.
async function changeProgress(db, stores, expectedRevision, change){
  const tx=db.transaction([...new Set([...stores,'meta'])],'readwrite'),done=complete(tx);
  try{
    const meta=tx.objectStore('meta'),revision=(await request(meta.get('revision')))??0;
    if(expectedRevision!==undefined&&expectedRevision!==revision)throw new ProgressConflictError();
    const value=await change(tx);
    meta.put(revision+1,'revision');
    await done;
    return {value,revision:revision+1};
  }catch(error){
    try{tx.abort();}catch{}
    await done.catch(()=>{});
    throw error;
  }
}
export async function openDatabase(course = 'simplified') {
  if (!['simplified','traditional'].includes(course)) throw new Error('未知学习课程');
  const req = indexedDB.open(course === 'traditional' ? DATABASE + '-traditional' : DATABASE, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('cards', { keyPath: 'id' });
    db.createObjectStore('logs', { keyPath: 'key', autoIncrement: true });
    db.createObjectStore('daily', { keyPath: 'date' });
    db.createObjectStore('meta');
  };
  return request(req);
}
export async function readProgress(db) {
  const tx = db.transaction(['cards', 'logs', 'daily', 'meta'], 'readonly');
  const [cards, logs, daily, settings, pendingCorrection, revision] = await Promise.all([
    request(tx.objectStore('cards').getAll()), request(tx.objectStore('logs').getAll()),
    request(tx.objectStore('daily').getAll()), request(tx.objectStore('meta').get('settings')),
    request(tx.objectStore('meta').get('pendingCorrection')),
    request(tx.objectStore('meta').get('revision')),
  ]);
  return { cards, logs, daily, settings, pendingCorrection, revision:revision??0 };
}
export async function saveReview(db, card, log, daily, pendingCorrection = null, expectedRevision) {
  const result=await changeProgress(db,['cards','logs','daily'],expectedRevision,async tx=>{
    if(await request(tx.objectStore('meta').get('pendingCorrection')))throw new ProgressConflictError();
    tx.objectStore('cards').put(card);
    const key=await request(tx.objectStore('logs').add(log));
    tx.objectStore('daily').put(daily);
    if(pendingCorrection){
      pendingCorrection.undo.logKey=key;
      tx.objectStore('meta').put(pendingCorrection,'pendingCorrection');
    }else tx.objectStore('meta').delete('pendingCorrection');
    return key;
  });
  return {key:result.value,revision:result.revision};
}
export async function undoReview(db, { id, card, logKey, daily }, expectedRevision) {
  const result=await changeProgress(db,['cards','logs','daily'],expectedRevision,tx=>{
    if(card)tx.objectStore('cards').put(card);else tx.objectStore('cards').delete(id);
    tx.objectStore('logs').delete(logKey);
    tx.objectStore('daily').put(daily);
    tx.objectStore('meta').delete('pendingCorrection');
  });
  return result.revision;
}
export async function clearCorrection(db, logKey, expectedRevision) {
  const result=await changeProgress(db,[],expectedRevision,async tx=>{
    const pending=await request(tx.objectStore('meta').get('pendingCorrection'));
    if(!Number.isInteger(logKey)||pending?.undo?.logKey!==logKey)throw new ProgressConflictError();
    tx.objectStore('meta').delete('pendingCorrection');
  });
  return result.revision;
}
export async function saveSettings(db, settings, expectedRevision) {
  const result=await changeProgress(db,[],expectedRevision,tx=>tx.objectStore('meta').put(settings,'settings'));
  return result.revision;
}
export async function replaceProgress(db, backup, expectedRevision) {
  const result=await changeProgress(db,['cards','logs','daily'],expectedRevision,tx=>{
    for(const store of ['cards','logs','daily','meta'])tx.objectStore(store).clear();
    for(const card of backup.cards)tx.objectStore('cards').put(card);
    for(const log of backup.logs)tx.objectStore('logs').put(log);
    for(const daily of backup.daily)tx.objectStore('daily').put(daily);
    tx.objectStore('meta').put(backup.settings,'settings');
  });
  return result.revision;
}
