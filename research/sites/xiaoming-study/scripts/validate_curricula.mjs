import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hydrateCourse,validateCourse,allLessons,practicePool} from '../dist/lesson-data.mjs';
import {encodingSteps} from '../dist/encoding.mjs';
const root=new URL('../',import.meta.url),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=async url=>JSON.parse((await readFile(url,'utf8')).replace(/^\uFEFF/,''));
const upstream=new URL('../../潇明码表/',root);
export async function validateCurricula(){
  const ajv=new Ajv({allErrors:true,strict:false});
  const fullSchema=ajv.compile(await load(new URL('dist/data/course.schema.json',root))),runtimeSchema=ajv.compile(await load(new URL('dist/data/runtime.schema.json',root)));
  const result={};
  let parameters=null;
  for(const course of ['simplified','traditional']){
    const directory=new URL(course==='traditional'?'dist/data/traditional/':'dist/data/',root);
    const bytes=await readFile(new URL('learning.json',directory)),data=hydrateCourse(JSON.parse(bytes));
    const metadata=await load(new URL('metadata.json',directory));
    const runtimeBytes=await readFile(new URL('learning-runtime.json',directory)),rawRuntime=JSON.parse(runtimeBytes);
    assert.ok(fullSchema(data),JSON.stringify(fullSchema.errors));assert.ok(runtimeSchema(rawRuntime),JSON.stringify(runtimeSchema.errors));
    const runtime=hydrateCourse(rawRuntime);
    validateCourse(data,{deep:true});validateCourse(runtime,{deep:true});
    assert.equal(hash(bytes),metadata.learningSha256);assert.equal(hash(runtimeBytes),metadata.runtime.sha256);
    assert.equal(bytes.length,metadata.learningBytes);assert.equal(runtimeBytes.length,metadata.runtime.bytes);
    assert.deepEqual(data.stats,metadata.stats);assert.deepEqual(data.curriculum,metadata.curriculum);
    const shape=item=>[item.id,item.type,item.text,item.order,item.code,item.baseId||null,item.baseCode||null,item.shortRule||null,item.commit||null,item.practiceAlias||null,item.dependencies,item.parts];
    const fullItems=allLessons(data),compactItems=allLessons(runtime);
    assert.equal(fullItems.length,compactItems.length);
    for(let i=0;i<fullItems.length;i++)assert.deepEqual(shape(fullItems[i]),shape(compactItems[i]),'runtime lesson '+i);

    const divisions=await load(new URL('chaifen.json',upstream));
    const rootText=(await readFile(new URL('zigen-xiaoming.csv',upstream),'utf8')).replace(/^\uFEFF/,'').trim();
    const officialRoots=new Map(rootText.split(/\r?\n/).slice(1).map(line=>{const [text,code,pinyin]=line.split(',');return [text,{code,pinyin}];}));
    for(const item of fullItems){
      if(item.type==='root'){assert.equal(item.code,officialRoots.get(item.text)?.code);assert.equal(item.pinyin,officialRoots.get(item.text)?.pinyin);}
      if(['initial','stroke','root'].includes(item.type))continue;
      for(const part of item.parts)assert.equal(part.division.join(''),divisions[part.char]?.[item.type==='variant'?'dt':'d']||'','official split '+item.text);
    }
    for(const file of ['chaifen.json','zigen-xiaoming.csv'])assert.equal(hash(await readFile(new URL(file,upstream))),metadata.inputs[file]);

    for(const [char,part] of Object.entries(data.glyphVariants||{})){
      assert.equal(part.division.join(''),divisions[char]?.dt,'official compatible split '+char);
      assert.ok(part.code.length>=3);
      for(let i=0;i<part.division.length;i++)assert.equal(part.rootCodes[i],officialRoots.get(part.division[i])?.code);
      assert.equal(encodingSteps({type:'char',code:part.code,parts:[part]}).map(step=>step.letter).join(''),part.code);
    }
    const weights=new Map();
    for(const item of data.items)if(item.code&&['char','word'].includes(item.type)){
      const id=item.practiceAlias||item.id,ranks=item.sourceFrequency?item.sourceFrequency.split('/').map(Number):item.frequency?[item.frequency]:[];
      weights.set(id,(weights.get(id)||0)+ranks.reduce((sum,rank)=>sum+1/rank,0));
    }
    let completion=0,mass=0,cost=0;
    for(const item of data.items)if(item.code&&!item.practiceAlias){completion++;const weight=weights.get(item.id)||0;mass+=weight;cost+=weight*completion;}
    assert.equal(completion,data.curriculum.optimization.selected.practiceUnits);
    assert.ok(Math.abs(cost/mass-data.curriculum.optimization.selected.weightedLessons)<1e-6,'delivered order differs from optimized report');

    const shortBytes=await readFile(new URL('upstream/output-simple-codes.txt',upstream));
    assert.equal(hash(shortBytes),data.teaching.shortSource.sha256);
    const assignments=new Set(shortBytes.toString('utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>{const [text,code]=line.split(/\s+/);return text+'\\t'+code;}));
    for(const item of data.transferItems)if(item.type==='short')assert.ok(assignments.has(item.text+'\\t'+item.code),'shortcut not in fixed official assignments');
    const counters={initial:0,stroke:0,root:0,char:0,word:0};
    for(const item of data.items)counters[item.type]++;
    assert.equal(counters.root,data.stats.roots);assert.equal(counters.char,data.stats.characters);assert.equal(counters.word,data.stats.words);
    assert.equal(data.items.filter(item=>!item.code).length,data.stats.unsupported);
    const source=await readFile(new URL(data.source.name,directory));assert.equal(hash(source),data.source.sha256);
    if(data.frequencySource){const raw=await readFile(new URL(data.frequencySource.name,directory));assert.equal(hash(raw),data.frequencySource.sha256);}
    const optimization=data.curriculum.optimization;
    assert.equal(data.curriculum.algorithm,'shared-full-prerequisite-dag-v1');
    assert.ok(optimization.selected.weightedLessons<=optimization.baseline.weightedLessons);
    if(parameters)assert.deepEqual(optimization.parameters,parameters);parameters=optimization.parameters;
    const combinedIndex=new Map(fullItems.map(item=>[item.id,item]));
    for(const track of ['short','variant']){
      const target=data.transferItems.filter(item=>item.type===track);
      assert.equal(target.length,data.transferStats[track]);
      const pool=practicePool(data,track),ids=new Set(pool.map(item=>item.id));
      for(const item of pool)assert.ok(item.dependencies.every(id=>ids.has(id)));
      for(const item of target){assert.equal(item.baseCode,combinedIndex.get(item.baseId).code);assert.notEqual(item.id,item.baseId);}
    }
    const manifest=await load(new URL('exports/manifest.json',directory));
    assert.equal(manifest.runtimeSha256,hash(bytes));
    for(const record of Object.values(manifest.files))assert.equal(hash(await readFile(new URL('exports/'+record.name,directory))),record.sha256);
    result[course]={coreItems:data.items.length,short:data.transferStats.short,variant:data.transferStats.variant,
      runtimeBytes:runtimeBytes.length,fullBytes:bytes.length,optimizedWeightedLessons:optimization.selected.weightedLessons};
  }
  execFileSync('python',[fileURLToPath(new URL('scripts/validate_font.py',root))],{stdio:'pipe'});
  return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await validateCurricula(),null,2));
