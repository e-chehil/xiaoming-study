import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LESSON_TYPES,STUDY_FILES} from '../dist/learning-schema.mjs';
import {displayCode} from '../dist/encoding.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

for(const course of ['simplified','traditional']){
  const directory=new URL(course==='traditional'?'../dist/data/traditional/':'../dist/data/',import.meta.url);
  const runtime=await readFile(new URL('learning.json',directory)),data=JSON.parse(runtime);
  const orderById=new Map(data.items.map(item=>[item.id,item.order]));
  const manifest=JSON.parse(await readFile(new URL('exports/manifest.json',directory),'utf8'));
  const files={};
  for(const key of ['path','words','roots']){
    const bytes=await readFile(new URL('exports/'+STUDY_FILES[course][key],directory));
    const [header,...lines]=bytes.toString('utf8').replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/);
    const fields=header.split('\t');
    files[key]={bytes,fields,rows:lines.map(line=>{const values=line.split('\t');return Object.fromEntries(fields.map((field,i)=>[field,values[i]||'']));})};
  }
  const h=course==='traditional'?{order:'學習序號',type:'類型',text:'內容',code:'練習編碼',full:'字根全碼',deps:'前置學習序號',word:'字詞',wc:'編碼',ordinal:'字詞序號',root:'字根',a:'大碼',s:'小碼',b:'補碼'}:{order:'学习序号',type:'类型',text:'内容',code:'练习编码',full:'字根全码',deps:'前置学习序号',word:'字词',wc:'编码',ordinal:'字词序号',root:'字根',a:'大码',s:'小码',b:'补码'};
  test(`${course}: downloads are versioned against the exact runtime and use clear localized column names`,()=>{
    assert.equal(manifest.runtimeSha256,hash(runtime));assert.equal(manifest.sourceSha256,data.source.sha256);
    assert.deepEqual(Object.keys(manifest.types),Object.keys(LESSON_TYPES));
    for(const key of ['path','words','roots']){
      assert.equal(hash(files[key].bytes),manifest.files[key].sha256);
      assert.equal(files[key].rows.length,manifest.files[key].rows);
      assert.ok(files[key].bytes.subarray(0,3).equals(Buffer.from([239,187,191])));
      assert.ok(files[key].fields.every(field=>!/[A-Za-z]/.test(field)));
      assert.equal(new Set(files[key].fields).size,files[key].fields.length);
    }
    assert.equal(files.path.rows.length,data.stats.total);
    assert.equal(files.words.rows.length,data.stats.characters+data.stats.words);
    assert.equal(files.roots.rows.length,397);
  });
  test(`${course}: learning path matches every lesson code and references visible earlier sequence numbers`,()=>{
    const rootRows=[];
    for(const [position,item]of data.items.entries()){
      const row=files.path.rows[position];assert.equal(Number(row[h.order]),position+1);
      assert.equal(row[h.type],manifest.types[item.type]);assert.equal(row[h.code],displayCode(item));
      if(['char','word','root'].includes(item.type))assert.equal(row[h.text],item.text);
      const deps=row[h.deps]?row[h.deps].split(' ').map(Number):[];
      const expected=item.dependencies.map(id=>orderById.get(id));
      assert.deepEqual(deps,expected);assert.ok(deps.every(number=>number<=position));
      if(item.type==='root'){assert.equal(row[h.full],displayCode(item,item.fullCode,true));assert.equal(row[h.code].length,3);rootRows.push(row);}
      else assert.equal(row[h.full],'');
    }
    assert.equal(rootRows.length,397);
  });
  test(`${course}: word list is exactly the current selection and root table has consistent A/S/B case`,()=>{
    const words=data.items.filter(item=>['char','word'].includes(item.type));
    files.words.rows.forEach((row,i)=>{assert.equal(row[h.word],words[i].text);assert.equal(Number(row[h.ordinal]),i+1);assert.equal(Number(row[h.order]),words[i].order);assert.equal(row[h.wc],displayCode(words[i]));});
    const roots=new Map(data.items.filter(item=>item.type==='root').map(item=>[item.text,item]));
    let previous='';
    for(const row of files.roots.rows){
      const item=roots.get(row[h.root]);assert.ok(item);
      assert.equal(row[h.a]+row[h.s]+row[h.b],item.fullCode[0].toUpperCase()+item.fullCode.slice(1));
      assert.ok(/^[A-Z]$/.test(row[h.a]));assert.ok(/^[a-z]$/.test(row[h.s]));assert.ok(/^[a-z]$/.test(row[h.b]));
      assert.ok(item.fullCode>=previous);previous=item.fullCode;
    }
    if(course==='traditional'){assert.ok(!files.words.rows.some(row=>row[h.word]==='一一一'));assert.ok(files.words.rows.some(row=>row[h.word]==='一一'));}
  });
}
