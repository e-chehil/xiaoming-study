import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {Cedict,markedPinyin,readingKey,REFERENCE} from '../public/cedict.mjs';

const data=JSON.parse(await readFile(new URL('../public/data/cedict/dictionary.json',import.meta.url),'utf8'));
const dictionary=new Cedict(data);
const matching=(text,pinyin,course='simplified')=>dictionary.match({text,pinyin,type:[...text].length===1?'char':'word'},course);

test('the complete pinned dictionary is present with original entry fields and license',()=>{
  assert.equal(data.entries.length,data.source.entries);assert.ok(data.entries.length>120000);
  assert.match(data.source.archiveSha256,/^[a-f0-9]{64}$/);assert.match(data.source.textSha256,/^[a-f0-9]{64}$/);
  for(const entry of data.entries){assert.equal(entry.length,5);assert.ok(entry.slice(0,3).every(Boolean));assert.ok(entry[3].length);assert.ok([1,2].includes(entry[4]));}
  assert.equal(data.source.license,'CC BY-SA 4.0');
});

test('the build parser accepts mixed v1/v2 and refuses malformed or truncated input',()=>{
  execFileSync('python',['-c',String.raw`from scripts.prepare_cedict import parse
m,e=parse('#! entries=2\n中國 中国 [Zhong1 guo2] /China/\n學習 学习 [[xue2xi2]] /to learn; to study/')
assert e[0][4]==1 and e[1][4]==2 and e[1][2]=='xue2xi2'
for bad in ['#! entries=2\n字 字 [zi4] /character/', 'bad record']:
    try: parse(bad)
    except ValueError: pass
    else: raise AssertionError('invalid dictionary accepted')`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
});

test('numbered, joined, accented and neutral-tone readings agree without conflating ü with u',()=>{
  assert.equal(markedPinyin('xue2xi2'),'xuéxí');
  assert.equal(markedPinyin('nu:3 er2'),'nǚ ér');
  assert.equal(markedPinyin('ma5'),'ma');assert.equal(markedPinyin('shang4hai3'),'shànghǎi');
  assert.equal(markedPinyin('m3'),'m̌');assert.equal(markedPinyin('n4'),'ǹ');
  assert.equal(readingKey('xué xí'),readingKey('xue2xi2'));
  assert.notEqual(readingKey('nǚ',{tones:false}),readingKey('nǔ',{tones:false}));
  assert.notEqual(readingKey('hǎo'),readingKey('hào'));
});

test('polyphones, surnames and merged simplified forms choose the relevant sense',()=>{
  const row=matching('行','háng'),walk=matching('行','xíng');
  assert.notEqual(row.primary,walk.primary);assert.equal(row.match,'exact');
  assert.match(dictionary.summary(row.primary),/trade|profession|row/);
  assert.match(dictionary.summary(walk.primary),/walk|go|travel/);
  assert.match(dictionary.summary(matching('王','wáng').primary),/king/);
  assert.doesNotMatch(dictionary.summary(matching('王','wáng').primary),/^surname/);
  assert.match(dictionary.summary(matching('发','fà').primary),/hair/);
  assert.match(dictionary.summary(matching('髮','fà','traditional').primary),/hair/);
  assert.equal(matching('髮','fà','simplified').primary,null);
  assert.equal(matching('銀行','yínháng','traditional').match,'exact');
  assert.equal(matching('銀行','yínxíng','traditional').match,'other');
  assert.equal(matching('銀行','yínhàng','traditional').match,'toneless');
  assert.equal(dictionary.match({text:'石',pinyin:'shí',type:'root'}).primary,null);
});

test('reference-only headwords expand into actual meanings and case-sensitive references stay distinct',()=>{
  const result=matching('麟','lín');
  assert.match(dictionary.summary(result.primary),/qilin/);
  assert.ok(dictionary.references(result.primary).length);
  const match=[...'王[wang2]'.matchAll(new RegExp(REFERENCE))][0];
  assert.match(dictionary.summary(dictionary.reference(match)),/king/);
  const cyclic=new Cedict({version:1,source:{entries:2},entries:[['甲','甲','jia3',['variant of 乙[yi3]'],1],['乙','乙','yi3',['variant of 甲[jia3]'],1]]});
  assert.ok(cyclic.summary(0).length<100);
  assert.deepEqual(cyclic.related(0),[1]);
});

test('offline lookup searches the full dictionary in either script, English and pinyin',()=>{
  for(const query of ['银行','銀行','bank','yin2hang2']){
    const result=dictionary.search(query,'traditional',{limit:dictionary.source.entries});
    assert.ok(result.ids.some(id=>dictionary.entries[id][0]==='銀行'),query);
    assert.equal(new Set(result.ids).size,result.ids.length);
  }
  assert.deepEqual(dictionary.search('  '),{ids:[],total:0});
});
