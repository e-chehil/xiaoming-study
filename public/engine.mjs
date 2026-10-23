import { fsrs, createEmptyCard, Rating, State } from './vendor/fsrs.mjs';

export { Rating, State };
export const DEFAULT_SETTINGS = Object.freeze({ newPerDay: 20, retention: 0.9, keyboard: true, pinyin: true, theme: 'dark' });
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function cleanSettings(value = {}) {
  return {
    newPerDay: Math.max(1, Math.min(200, Math.round(Number(value.newPerDay) || 20))),
    retention: Math.max(0.8, Math.min(0.97, Number(value.retention) || 0.9)),
    keyboard: value.keyboard !== false,
    pinyin: value.pinyin !== false,
    theme: value.theme === 'light' ? 'light' : 'dark',
  };
}
export function scheduler(retention = 0.9) {
  return fsrs({ request_retention: retention, enable_fuzz: false, enable_short_term: true, maximum_interval: 36500 });
}
export function reviveCard(card, now = new Date()) {
  if (!card) return createEmptyCard(now);
  return { ...card, due: new Date(card.due), ...(card.last_review ? { last_review: new Date(card.last_review) } : {}) };
}
export function preview(card, now = new Date(), retention = 0.9) {
  return scheduler(retention).repeat(reviveCard(card, now), now);
}
export function applyRating(card, grade, now = new Date(), retention = 0.9) {
  if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(grade)) throw new Error('无效评分');
  const result = preview(card, now, retention)[grade];
  return JSON.parse(JSON.stringify(result));
}
const indices = new WeakMap();
export function itemIndex(items) {
  if (!indices.has(items)) indices.set(items, new Map(items.map(item => [item.id, item])));
  return indices.get(items);
}
export function isVerified(card) { return card?.verified === true; }
export const cardFor = (cards,item) => item ? cards[item.practiceAlias || item.id] || cards[item.id] : undefined;
const dependencyGraphs=new WeakMap();
export function createSelectionContext(items,cards,history=[]){
  if(!dependencyGraphs.has(items)){
    const reverse=new Map();
    for(const item of items)for(const id of item.dependencies||[]){if(!reverse.has(id))reverse.set(id,[]);reverse.get(id).push(item.id);}
    dependencyGraphs.set(items,reverse);
  }
  const reverse=dependencyGraphs.get(items),values=Object.values(cards),positions=new Map(values.map((card,i)=>[card.id,i]));
  const dueTimes=new Map(values.map(card=>[card.id,+new Date(card.due)])),ready=new Map(),seen=new Map();
  history.forEach((entry,i)=>seen.set(typeof entry==='number'?entry:entry.itemId,i));
  let firstNewPosition=0;
  return {items,cards,history,values,dueTimes,ready,seen,historyLength:history.length,lastNew:history.findLastIndex(entry=>entry?.wasNew),
    firstNew(){
      while(firstNewPosition<items.length){const item=items[firstNewPosition];if(item.code&&!item.practiceAlias&&!cards[item.id])return item;firstNewPosition++;}
      return null;
    },
    record(card,log){
      const position=positions.get(card.id),old=position===undefined?null:values[position];
      if(Boolean(old?.verified)!==Boolean(card.verified)){
        const queue=[card.id],visited=new Set();
        for(let i=0;i<queue.length;i++)for(const child of reverse.get(queue[i])||[]){
          if(!visited.has(child)){visited.add(child);ready.delete(child);queue.push(child);}
        }
      }
      if(position===undefined){positions.set(card.id,values.length);values.push(card);}else values[position]=card;
      dueTimes.set(card.id,+new Date(card.due));
      seen.set(log.itemId,history.length-1);this.historyLength=history.length;
      if(log.wasNew)this.lastNew=history.length-1;
    },
  };
}
function selectionContext(value,items,cards,history){
  return value?.items===items&&value.cards===cards&&(!history||(value.history===history&&value.historyLength===history.length))?value:null;
}
export function pickNext(items, cards, { now = new Date(), newLimit = 20, newToday = 0, reviewOnly = false, context = null } = {}) {
  context=selectionContext(context,items,cards);
  const values=context?.values||Object.values(cards),dueTime=card=>context?.dueTimes.get(card.id)??+new Date(card.due);
  const index = itemIndex(items), canIntroduce = !reviewOnly && newToday < newLimit;
  const selection = (item, foundation = false) => {
    item=index.get(item.practiceAlias)||item;
    return {item,isNew:!cards[item.id],foundation,early:Boolean(cards[item.id]&&dueTime(cards[item.id])>now)};
  };
  const waiting = item => {const card=cardFor(cards,item);return card?.holdUntilDue&&dueTime(card)>now;};
  function prerequisite(item, visiting = new Set()) {
    if (visiting.has(item.id)) throw new Error('学习表存在循环依赖');
    const seen = new Set(visiting).add(item.id);
    const required = (item.dependencies || []).map(id => index.get(id)).filter(Boolean);
    // Traverse every earlier dependency, including roots missing from a migrated v1 card.
    let blocked = null;const blockedDependencies=new Set();
    for (const dep of required) {
      const nested = prerequisite(dep, seen);
      if (nested?.blocked){blocked=nested;blockedDependencies.add(dep.id);}
      else if (nested) return nested;
    }
    const pending = required.filter(dep => !isVerified(cardFor(cards,dep)));
    pending.sort((a,b) => (cards[a.id]?.reps || 0) - (cards[b.id]?.reps || 0) || (a.order || a.id) - (b.order || b.id));
    for (const dep of pending) {
      if(blockedDependencies.has(dep.id))continue;
      if (waiting(dep)) { blocked = { blocked: true }; continue; }
      return selection(dep, true);
    }
    return blocked;
  }
  const available = result => result && !result.blocked && (result.isNew ? canIntroduce : true);
  const due = values.filter(card => index.get(card.id)?.code && !index.get(card.id).practiceAlias && dueTime(card) <= now);
  due.sort((a,b) => dueTime(a) - dueTime(b) || (index.get(a.id).order || a.id) - (index.get(b.id).order || b.id));
  for (const card of due) {
    const item = index.get(card.id), gate = prerequisite(item);
    if (gate) { if (available(gate)) return gate; continue; }
    return selection(item);
  }
  const firstNew = !reviewOnly ? context?context.firstNew():items.find(item => item.code && !item.practiceAlias && !cards[item.id]) : null;
  if (firstNew && canIntroduce) {
    const gate = prerequisite(firstNew);
    if (!gate) return selection(firstNew);
    if (available(gate)) return gate;
  }
  // Finish independent recall of introduced foundations even after reaching the new-item cap.
  const pending = values.filter(card => index.has(card.id) && !index.get(card.id).practiceAlias && !isVerified(card) && !waiting(index.get(card.id)));
  pending.sort((a,b) => a.reps - b.reps || (index.get(a.id).order || a.id) - (index.get(b.id).order || b.id));
  for (const card of pending) {
    const item = index.get(card.id), gate = prerequisite(item);
    if (gate) { if (available(gate)) return gate; continue; }
    if (!reviewOnly) return selection(item, true);
  }
  return null;
}
export function pickContinuous(items, cards, {now = new Date(), newLimit = 20, newToday = 0, reviewOnly = false, history = [], context = null} = {}) {
  context=selectionContext(context,items,cards,history);
  const index = itemIndex(items), ready = context?.ready||new Map(), seen = context?.seen||new Map();
  const dueTime=card=>context?.dueTimes.get(card.id)??+new Date(card.due);
  if(!context)history.forEach((entry, position) => seen.set(typeof entry === 'number' ? entry : entry.itemId, position));
  const age = item => seen.has(item.id) ? history.length - 1 - seen.get(item.id) : Infinity;
  const justDrilled = item => history.at(-1)?.itemId===item.id && history.at(-1)?.supplemental;
  const gap = item => ['initial','stroke'].includes(item.type) ? 3 : 8;
  const waiting = item => cards[item.id]?.holdUntilDue && dueTime(cards[item.id]) > now;
  function prerequisitesReady(item, visiting = new Set()) {
    if (ready.has(item.id)) return ready.get(item.id);
    if (visiting.has(item.id)) throw new Error('学习表存在循环依赖');
    visiting.add(item.id);
    const result = (item.dependencies || []).every(id => {
      const dependency = index.get(id);
      return dependency && isVerified(cardFor(cards,dependency)) && prerequisitesReady(dependency, visiting);
    });
    visiting.delete(item.id);
    ready.set(item.id, result);
    return result;
  }
  const select = (item, supplemental = false, guided = false) => ({
    item, isNew: !cards[item.id], foundation: Boolean(cards[item.id] && !isVerified(cards[item.id])),
    early: Boolean(cards[item.id] && new Date(cards[item.id].due) > now), supplemental, guided,
  });
  const known = (context?.values||Object.values(cards)).map(card => index.get(card.id)).filter(item => item?.code && !item.practiceAlias && prerequisitesReady(item));
  let dueNow=null,earliestDue=Infinity;
  for(const item of known){
    const time=dueTime(cards[item.id]);
    if(time<=now&&!justDrilled(item)&&(time<earliestDue||(time===earliestDue&&item.order<dueNow.order))){dueNow=item;earliestDue=time;}
  }
  if (dueNow) return select(dueNow);

  const scheduled = pickNext(items, cards, {now, newLimit, newToday, reviewOnly,context});
  if (scheduled && !scheduled.early && !justDrilled(scheduled.item)) return {...scheduled, supplemental:false, guided:false};
  if (scheduled && age(scheduled.item) >= gap(scheduled.item)) return {...scheduled, supplemental:true, guided:false};

  // Skip blocked content without changing the order or weakening its prerequisites.
  const firstFresh=context?.firstNew();
  const fresh = !reviewOnly ? context&&(!firstFresh||prerequisitesReady(firstFresh))?firstFresh:items.find(item => item.code && !item.practiceAlias && !cards[item.id] && prerequisitesReady(item)) : null;
  if (fresh && newToday < newLimit) return select(fresh);
  const lastNew = context?context.lastNew:history.findLastIndex(entry => entry?.wasNew);
  if (fresh && history.length - 1 - lastNew >= 5) return select(fresh);
  const compareDrills = (a,b) =>
    Number(isVerified(cards[a.id])) - Number(isVerified(cards[b.id])) ||
    (seen.get(a.id) ?? -1) - (seen.get(b.id) ?? -1) || a.order - b.order;
  let spaced=null,firstDrill=null,guided=null;
  for(const item of known){
    if(!guided||(seen.get(item.id)??-1)<(seen.get(guided.id)??-1)||((seen.get(item.id)??-1)===(seen.get(guided.id)??-1)&&item.order<guided.order))guided=item;
    if(waiting(item))continue;
    if(!firstDrill||compareDrills(item,firstDrill)<0)firstDrill=item;
    if(age(item)>=gap(item)&&(!spaced||compareDrills(item,spaced)<0))spaced=item;
  }
  if (spaced) return select(spaced, true);
  // The daily amount is a goal, so a small recent pool never forces a pause or immediate repetition.
  if (fresh) return select(fresh);
  if (firstDrill) return select(firstDrill, true);
  // An exhausted pool can still practise with the answer shown, preserving every FSRS due date.
  return guided ? select(guided, true, true) : null;
}

export function evaluateAttempt(before, metrics, recentLogs = [], {now = new Date(), retention = 0.9, supplemental = false, guided = false} = {}) {
  const assessment = typingGrade({...metrics, revealed: Boolean(metrics.revealed || guided)}, before, recentLogs);
  const outcome = metrics.correct ? 'correct' : metrics.blank ? 'blank' : 'incorrect';
  const scheduleUpdated = !(before && supplemental && (guided || assessment.verified));
  if (!scheduleUpdated) {
    return {assessment, scheduleUpdated, card:{...before, verified:Boolean(before.verified || assessment.verified), lastOutcome:outcome, oneShot:true}};
  }
  const result = applyRating(before, assessment.grade, now, retention);
  return {assessment, scheduleUpdated, log:result.log, card:{
    ...result.card, verified:assessment.verified,
    cleanRecalls:assessment.verified && !metrics.backspaces ? (before?.cleanRecalls || 0) + 1 : 0,
    lastOutcome:outcome, oneShot:true,
    holdUntilDue:!metrics.correct || (!metrics.firstExposure && !assessment.verified),
  }};
}
export function typingGrade(metrics, card, recentLogs = []) {
  const { firstExposure = false, elapsedMs = 0, codeLength = 3, skill = 'core', mistakes = 0, backspaces = 0, hints = 0, revealed = false, pasted = false, correct = true, blank = false } = metrics;
  if (blank || !correct || mistakes > 0) return { grade: Rating.Again, verified: false, reason: blank ? '未能回忆，按间隔再次学习' : '本次编码未匹配', basis: 'failed' };
  if (firstExposure) return { grade: Rating.Again, verified: false, reason: '首次识别，接下来练习无提示回忆', basis: 'recognition' };
  if (revealed || hints > 0 || mistakes > 0 || pasted) return { grade: Rating.Again, verified: false, reason: revealed ? '查看过完整答案' : hints ? '使用过单码提示' : mistakes ? '本次有错码提交' : '使用粘贴输入', basis: 'assisted' };
  const samples=[];
  for(let i=recentLogs.length-1;i>=0&&samples.length<40;i--){
    const log=recentLogs[i];
    if((log.skill||'core')===skill&&log.automatic&&!log.supplemental&&!log.firstExposure&&!log.hinted&&!log.pasted&&!log.revealed&&!log.incorrectSubmissions&&!log.backspaces&&log.elapsedMs>=250&&log.elapsedMs<=60000&&log.codeLength>0)samples.push(log.elapsedMs/log.codeLength);
  }
  samples.sort((a,b)=>a-b);
  const median = samples.length >= 5 ? samples[Math.floor(samples.length / 2)] : 800;
  const pace = Math.min(2500, Math.max(250, median));
  const hardThreshold = 2000 + codeLength * pace * 1.6;
  const easyThreshold = 800 + codeLength * pace * 0.7;
  if (backspaces > 0 || elapsedMs > hardThreshold) return { grade: Rating.Hard, verified: true, reason: backspaces ? '独立完成，有回撤修改' : '独立完成，回忆用时较长', basis: 'effort', pace };
  if (card?.verified && card?.cleanRecalls >= 2 && elapsedMs <= easyThreshold) return { grade: Rating.Easy, verified: true, reason: '连续独立回忆，输入流畅', basis: 'fluent', pace };
  return { grade: Rating.Good, verified: true, reason: '独立正确完成', basis: 'recall', pace };
}
export function intervalLabel(due, now = new Date()) {
  const seconds = Math.max(1, Math.round((new Date(due) - now) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时`;
  const days = Math.round(seconds / 86400);
  return days < 365 ? `${days} 天` : `${(days / 365).toFixed(1)} 年`;
}
export function emptyDaily(date = dayKey()) {
  return { date, newCount: 0, reviews: 0, correct: 0, attempts: 0, seconds: 0 };
}
export function validateBackup(backup, items, datasetSha, course = 'simplified') {
  if(!backup||backup.app!=='xiaoming-study'||backup.version!==3)throw new Error('请选择本站导出的进度备份。');
  if(!['simplified','traditional'].includes(backup.course))throw new Error('备份中的课程信息无效。');
  if(backup.course!==course)throw new Error('这份备份不属于当前课程，请先切换简繁课程。');
  if(backup.lessonVersion!=='root-foundations-v5'||backup.datasetSha!==datasetSha)throw new Error('备份版本与当前课程不一致，无法恢复。');
  const index = itemIndex(items);
  if (!Array.isArray(backup.cards) || !Array.isArray(backup.logs) || !Array.isArray(backup.daily)) throw new Error('备份缺少进度数据。');
  const unique = new Set();
  for (const card of backup.cards) {
    if (!Number.isInteger(card.id) || !index.get(card.id)?.code || unique.has(card.id)) throw new Error('备份中存在重复或无效的学习项。');
    unique.add(card.id);
    if(card.answerCode!==undefined&&card.answerCode!==index.get(card.id).code)throw new Error('备份中的答案版本与当前课程不同。');
    if ((card.holdUntilDue !== undefined && typeof card.holdUntilDue !== 'boolean') || (card.oneShot !== undefined && typeof card.oneShot !== 'boolean') || (card.lastOutcome !== undefined && !['correct','incorrect','blank'].includes(card.lastOutcome))) throw new Error('备份中的提交状态无效。');
    if (!Number.isFinite(Date.parse(card.due)) || !Number.isFinite(Date.parse(card.last_review)) || ![1, 2, 3].includes(card.state)) throw new Error('备份中的记忆状态无效。');
    for (const field of ['stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses']) {
      if (!Number.isFinite(card[field]) || card[field] < 0) throw new Error('备份中的复习数据无效。');
    }
    if (card.reps < 1 || card.difficulty > 10 || card.stability <= 0 || (card.learning_steps !== undefined && (!Number.isInteger(card.learning_steps) || card.learning_steps < 0))) throw new Error('备份中的记忆参数越界。');
  }
  const logIds = new Set();
  for (const log of backup.logs) {
    if (!index.get(log.itemId)?.code || !Number.isInteger(log.key) || log.key < 1 || logIds.has(log.key) || ![1, 2, 3, 4].includes(log.grade) || !Number.isFinite(Date.parse(log.at))) throw new Error('备份中的复习记录无效。');
    for (const field of ['seconds', 'elapsedMs', 'codeLength', 'backspaces', 'hintCount', 'incorrectSubmissions']) {
      if (log[field] !== undefined && (!Number.isFinite(log[field]) || log[field] < 0)) throw new Error('备份中的输入指标无效。');
    }
    for (const field of ['automatic', 'firstExposure', 'firstTry', 'hinted', 'revealed', 'pasted', 'wasNew', 'earlyPractice', 'oneShot', 'correct', 'supplemental', 'guided', 'scheduleUpdated']) {
      if (log[field] !== undefined && typeof log[field] !== 'boolean') throw new Error('备份中的输入标记无效。');
    }
    if(log.skill!==undefined&&!['core','short','variant'].includes(log.skill))throw new Error('备份中的训练类型无效。');
    logIds.add(log.key);
  }
  const dates = new Set();
  for (const daily of backup.daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(daily.date) || !Number.isFinite(Date.parse(daily.date)) || dates.has(daily.date)) throw new Error('备份中的日期无效。');
    dates.add(daily.date);
    for (const field of ['newCount', 'reviews', 'correct', 'attempts', 'seconds']) if (!Number.isFinite(daily[field]) || daily[field] < 0) throw new Error('备份中的统计无效。');
  }
  return { ...backup, settings: cleanSettings(backup.settings) };
}
