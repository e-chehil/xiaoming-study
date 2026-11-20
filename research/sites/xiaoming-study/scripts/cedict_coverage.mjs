import {readFile,writeFile} from 'node:fs/promises';
import {Cedict} from '../dist/cedict.mjs';
const root=new URL('../',import.meta.url);
const dictionary=new Cedict(JSON.parse(await readFile(new URL('dist/data/cedict/dictionary.json',root),'utf8')));
const report={source:dictionary.source,courses:{},policy:'Exact headword in the selected script; reading-aware ranking. No automatic character-by-character translation or cross-script replacement. All dictionary entries remain searchable.'};
for(const [course,path]of [['simplified','data/learning.json'],['traditional','data/traditional/learning.json']]){
  const data=JSON.parse(await readFile(new URL('dist/'+path,root),'utf8'));
  const count={sourceSha256:data.source.sha256,total:0,matched:0,missing:0,exact:0,toneless:0,other:0,unread:0,characters:{total:0,matched:0},words:{total:0,matched:0}};
  const unmatched=[];
  for(const item of data.items.filter(item=>['char','word'].includes(item.type))){
    count.total++;const group=count[item.type==='char'?'characters':'words'];group.total++;
    const result=dictionary.match(item,course);
    if(result.primary===null){count.missing++;unmatched.push({id:item.id,text:item.text,pinyin:item.displayPinyin||item.pinyin});}
    else{count.matched++;group.matched++;count[result.match]++;}
  }
  count.coverage=Number((count.matched/count.total*100).toFixed(2));report.courses[course]=count;
  await writeFile(new URL('dist/data/cedict/missing-'+course+'.json',root),JSON.stringify(unmatched));
}
await writeFile(new URL('dist/data/cedict/coverage.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.courses,null,2));
