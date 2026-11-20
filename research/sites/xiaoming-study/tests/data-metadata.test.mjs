import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for(const course of ['simplified','traditional']){
  const directory=new URL(course==='traditional'?'../dist/data/traditional/':'../dist/data/',import.meta.url);
  const data=JSON.parse(await readFile(new URL('learning.json',directory),'utf8'));
  const metadata=JSON.parse(await readFile(new URL('metadata.json',directory),'utf8'));
  test(`${course}: coverage statistics describe the selected course, including shared foundations`,()=>{
    const index=new Map(data.items.map(item=>[item.id,item]));
    const roots=data.items.filter(item=>item.type==='root');
    const uses=new Map(roots.map(root=>[root.text,new Set()]));
    for(const item of data.items)if(['char','word'].includes(item.type)){
      for(const part of item.parts)for(const root of part.division)uses.get(root).add(item.id);
    }
    const weight=id=>{const item=index.get(id);if(!item.code)return 0;const ranks=item.sourceFrequency?item.sourceFrequency.split('/').map(Number):item.frequency?[item.frequency]:[];return ranks.reduce((sum,rank)=>sum+1/rank,0);};
    const verify=(item,ids)=>{
      assert.equal(item.coverageCount,ids.size,`${item.text}: active coverage`);
      const expected=[...ids].reduce((sum,id)=>sum+weight(id),0);
      assert.ok(Math.abs(item.coverageScore-expected)<1e-8,`${item.text}: active weighted coverage`);
      const first=[...ids].map(id=>index.get(id)).filter(item=>item.type==='char').sort((a,b)=>a.order-b.order)[0];
      assert.equal(item.firstNeededSourceId,first?.sourceId??null,`${item.text}: first active character`);
    };
    for(const root of roots)verify(root,uses.get(root.text));
    for(const lesson of data.items.filter(item=>['initial','stroke'].includes(item.type))){
      const affected=roots.filter(root=>lesson.type==='initial'?root.mapping.initial===lesson.initial:root.mapping.strokeKey===lesson.strokeKey);
      assert.equal(lesson.rootCount,affected.length);
      verify(lesson,new Set(affected.flatMap(root=>[...uses.get(root.text)])));
    }
    assert.equal(data.curriculum.tableColumns.order,`课程实际位置（连续 1..${data.items.length}）`);
    assert.deepEqual(metadata.curriculum,data.curriculum);
  });
}
