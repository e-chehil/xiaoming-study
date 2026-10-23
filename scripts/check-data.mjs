import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {hydrateCourse,validateCourse,allLessons,practicePool} from '../public/lesson-data.mjs';
import {encodingSteps} from '../public/encoding.mjs';
const root=new URL('../public/',import.meta.url);
const read=path=>readFile(new URL(path,root));
const json=async path=>JSON.parse(await read(path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function table(bytes,name){
  if(bytes.toString('ascii',0,4)==='wOFF'){
    for(let i=0;i<bytes.readUInt16BE(12);i++){
      const at=44+i*20;if(bytes.toString('ascii',at,at+4)!==name)continue;
      const start=bytes.readUInt32BE(at+4),size=bytes.readUInt32BE(at+8),length=bytes.readUInt32BE(at+12),body=bytes.subarray(start,start+size);
      return size<length?inflateSync(body):body;
    }
  }else for(let i=0;i<bytes.readUInt16BE(4);i++){
    const at=12+i*16;if(bytes.toString('ascii',at,at+4)===name)return bytes.subarray(bytes.readUInt32BE(at+8),bytes.readUInt32BE(at+8)+bytes.readUInt32BE(at+12));
  }
  throw new Error('Missing font table: '+name);
}
function fontCovers(bytes){
  const cmap=table(bytes,'cmap'),offsets=new Set(Array.from({length:cmap.readUInt16BE(2)},(_,i)=>cmap.readUInt32BE(8+i*8)));
  return char=>{
    const cp=char.codePointAt(0);
    for(const off of offsets){
      const format=cmap.readUInt16BE(off);
      if(format===12){for(let i=0;i<cmap.readUInt32BE(off+12);i++){const at=off+16+i*12,start=cmap.readUInt32BE(at),end=cmap.readUInt32BE(at+4);if(cp>=start&&cp<=end&&cmap.readUInt32BE(at+8)+cp-start)return true;}}
      if(format===4&&cp<=65535){
        const count=cmap.readUInt16BE(off+6)/2,ends=off+14,starts=ends+count*2+2,deltas=starts+count*2,ranges=deltas+count*2;
        for(let i=0;i<count;i++){
          if(cp<cmap.readUInt16BE(starts+i*2)||cp>cmap.readUInt16BE(ends+i*2))continue;
          const range=cmap.readUInt16BE(ranges+i*2),glyph=range?cmap.readUInt16BE(ranges+i*2+range+2*(cp-cmap.readUInt16BE(starts+i*2))):cp;
          if(glyph&&(glyph+cmap.readUInt16BE(deltas+i*2))%65536)return true;
        }
      }
    }
    return false;
  };
}
export async function checkData(){
  const manifest=await json('data/manifest.json'),validate=new Ajv({allErrors:true,strict:false}).compile(await json('data/runtime.schema.json'));
  const sourceRanks=JSON.parse(await readFile(new URL('../data/curriculum-ranks.json',import.meta.url),'utf8'));
  const courses={},pua=new Set(),regional=new Set(),traditional=new Set();let parameters;
  for(const course of ['simplified','traditional']){
    const record=manifest.courses[course],bytes=await read('data/'+record.file),raw=JSON.parse(bytes);
    assert.equal(sha(bytes),record.sha256);assert.equal(bytes.length,record.bytes);assert.ok(validate(raw),JSON.stringify(validate.errors));
    const data=hydrateCourse(raw);validateCourse(data,{deep:true});assert.deepEqual(data.stats,record.stats);assert.deepEqual(data.transferStats,record.transferStats);
    assert.equal(data.curriculum.algorithm,'shared-full-prerequisite-dag-v1');
    const optimization=data.curriculum.optimization;
    assert.ok(optimization.selected.weightedLessons<=optimization.baseline.weightedLessons);
    if(parameters)assert.deepEqual(optimization.parameters,parameters);parameters=optimization.parameters;
    const ranksById=new Map(sourceRanks[course]);
    assert.equal(ranksById.size,sourceRanks[course].length);
    const weights=new Map();for(const item of data.items)if(item.code&&['char','word'].includes(item.type)){
      const ranks=ranksById.get(item.id)||[],id=item.practiceAlias||item.id;
      weights.set(id,(weights.get(id)||0)+ranks.reduce((sum,rank)=>sum+1/rank,0));
    }
    let cost=0,mass=0,position=0;
    for(const item of data.items)if(item.code&&!item.practiceAlias){position++;const weight=weights.get(item.id)||0;cost+=weight*position;mass+=weight;}
    assert.ok(Math.abs(cost/mass-optimization.selected.weightedLessons)<1e-6);assert.equal(position,optimization.selected.practiceUnits);
    for(const track of ['core','short','variant']){const pool=practicePool(data,track),ids=new Set(pool.map(i=>i.id));for(const item of pool)assert.ok(item.dependencies.every(id=>ids.has(id)));}
    for(const item of allLessons(data))for(const part of item.parts)for(const char of part.division.join(''))if(char.codePointAt(0)>=0xf400&&char.codePointAt(0)<=0xf8ff)pua.add(char);
    for(const [char,part]of Object.entries(data.glyphVariants)){regional.add(char);if(course==='traditional')traditional.add(char);assert.equal(encodingSteps({type:'char',code:part.code,parts:[part]}).map(s=>s.letter).join(''),part.code);}
    courses[course]={items:data.items.length,...data.transferStats};
  }
  const dictionaryBytes=await read('data/'+manifest.dictionary.file);assert.equal(sha(dictionaryBytes),manifest.dictionary.sha256);
  const dictionary=JSON.parse(dictionaryBytes),metadata=await json('data/cedict/metadata.json');assert.equal(dictionary.entries.length,metadata.entries);assert.deepEqual(dictionary.source,metadata);assert.equal(metadata.license,'CC BY-SA 4.0');
  const regionalMeta=await json('fonts/taiwan-font.json'),regionalBytes=await read('fonts/'+regionalMeta.file);assert.equal(sha(regionalBytes),regionalMeta.sha256);
  const covers=fontCovers(regionalBytes),missing=new Set([...regional].filter(c=>!covers(c)));
  assert.deepEqual([...missing].sort(),regionalMeta.fallbackCharacters.slice().sort());assert.ok([...traditional].every(c=>covers(c)));
  assert.ok([...pua].every(fontCovers(await read('fonts/Yuniversus.woff'))),'A private-use root glyph is missing');
  const result={courses,dictionaryEntries:metadata.entries,privateUseRoots:pua.size,regionalGlyphs:regional.size,regionalFallbacks:missing.size};
  console.log('Data verified: '+JSON.stringify(result));return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await checkData();
