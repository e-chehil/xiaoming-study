import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WANGMA,lookupWangma,referenceGlyphs,validateWangma} from '../public/wangma.mjs';
import {cleanSettings} from '../public/engine.mjs';

const data=JSON.parse(await readFile(new URL('../public/data/wangma.json',import.meta.url)));
test('the seven Wangma schemes preserve exact characters and numeric codes',()=>{
  validateWangma(data);
  assert.deepEqual(Object.keys(WANGMA).map(scheme=>lookupWangma(data,'行',scheme)),
    ['TFHH','TGSH','TGSH','33212','38112','32112','38112']);
  assert.equal(lookupWangma(data,'車','wubi86'),'LGHH');
  assert.equal(lookupWangma(data,'车','wubi86'),'LGNH');
  assert.equal(lookupWangma(data,'𠮷','wubi86'),null);
  assert.equal(lookupWangma(data,'白󠄀','wubi86'),null);
  assert.equal(cleanSettings({}).wangma,'');
  for(const scheme of Object.keys(WANGMA)) assert.equal(cleanSettings({wangma:scheme}).wangma,scheme);
  assert.equal(cleanSettings({wangma:'toString'}).wangma,'');
});
test('compare each written Han character, and use the examples of non-character lessons',()=>{
  assert.deepEqual(referenceGlyphs({type:'word',text:'人A人，白󠄀'}),['人','人','白󠄀']);
  assert.deepEqual(referenceGlyphs({type:'stroke',text:'撇',examples:[{text:'勹'},{text:'白'}]}),['勹','白']);
  assert.deepEqual(referenceGlyphs({type:'initial',text:'ㄅ',examples:[{text:'白'}]}),['白']);
});
