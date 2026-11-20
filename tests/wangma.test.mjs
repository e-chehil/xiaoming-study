import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WANGMA,lookupWangma,lookupWangmaSplit,referenceGlyphs,validateWangma} from '../public/wangma.mjs';
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

test('the illustrated table covers the archive and keeps the original split for each scheme',()=>{
  assert.deepEqual(Object.keys(data.roots).sort(),Object.keys(data.characters).sort());
  let references=0;
  const used=new Set();
  for(const [glyph,row] of Object.entries(data.roots)){
    assert.equal(row.length,data.columns.length,glyph);
    for(const [i,split] of row.entries()){
      if(data.columns[i]==='numeric6_first4_last1'){
        assert.equal(typeof split,'string',glyph);
        assert.ok(split.length,glyph);
      }else{
        assert.ok(Array.isArray(split)&&split.length,glyph);
        references+=split.length;
        for(const id of split){
          assert.ok(Number.isInteger(id)&&id>=0&&id<data.images.length,glyph);
          used.add(id);
        }
      }
    }
  }
  assert.equal(references,427838);
  assert.equal(used.size,data.images.length);
  for(const image of data.images){
    assert.match(image.src,/^data:image\/png;base64,iVBORw0KGgo/);
    assert.ok([15,16].includes(image.width)&&image.height===16);
  }
});

test('lookup preserves repeated components, source stroke groups and missing exact forms',()=>{
  const parts=lookupWangmaSplit(data,'晶','wubi86');
  assert.equal(parts.length,4);
  assert.equal(parts[0],parts[1]);
  assert.equal(parts[0],parts[2]);
  assert.notEqual(parts[0],parts[3]);
  assert.equal(lookupWangmaSplit(data,'晶','numeric6_first4_last1'),'日日日');
  assert.equal(lookupWangmaSplit(data,'行','numeric6_first4_last1'),'丿丿丨一丨');
  assert.equal(lookupWangmaSplit(data,'白󠄀','wubi86'),null);
  assert.equal(lookupWangmaSplit(data,'𠮷','wubi86'),null);
  assert.equal(lookupWangmaSplit(data,'行','toString'),null);
});
