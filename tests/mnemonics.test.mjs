import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodingSteps} from '../public/encoding.mjs';
import {exposesMnemonic} from '../public/answer-exposure.mjs';
import {mnemonicFor} from '../public/mnemonics.mjs';
import {mnemonicMarkup} from '../public/teaching.mjs';

const data = JSON.parse(readFileSync(new URL('../public/data/learning-runtime.json', import.meta.url), 'utf8'));
const roots = new Map(data.items.filter(item => item.type === 'root').map(item => [item.text, item]));
const step = (role, letter, root) => ({role, letter, root});

test('all nineteen scenes keep the original mnemonic glyphs on their correct keys', () => {
  const inVerse = new Set();
  for (const key of new Set([...roots.values()].map(root => root.code[0]))) {
    const card = mnemonicFor(step('a', key));
    assert.ok(card.scene && card.cue && card.story && card.note);
    for (const shape of card.verse.replace(/[，。、“”]/gu, '')) {
      assert.equal(roots.get(shape)?.code[0], key, shape);
      inVerse.add(shape);
    }
    for (const [shape] of card.forms) assert.equal(roots.get(shape)?.code[0], key);
  }
  assert.equal(inVerse.size, 179);
  assert.match(mnemonicFor(step('a', 'b')).verse, /瓜皿冊/);
});

test('six shared rhymes match every actual initial and first-stroke lesson, including zero', () => {
  for (const item of data.items.filter(i => ['initial', 'stroke'].includes(i.type))) {
    const card = mnemonicFor(encodingSteps(item)[0]);
    if (item.type === 'initial') assert.ok(card.initials.includes(item.initial));
    else assert.equal(card.stroke, item.text);
    assert.equal([...card.rhyme].length, card.initials.length);
  }
  assert.equal(mnemonicFor(step('s', 'd')).initials, '0hy');
  assert.equal(mnemonicFor(step('b', 'j')).verse, '鸡尾一撇，赖皮抢肉屑。');
  assert.equal(mnemonicFor(step('key', 'd')), undefined);
  assert.equal(mnemonicFor(step('commit', '_')), undefined);
});

test('a shared letter highlights the right reading or stroke, including silent roots', () => {
  const eye = roots.get('目'), dot = roots.get('丶');
  const render = (item, i) => mnemonicMarkup(item, step('asb'[i], item.code[i], item.text), roots);
  assert.match(render(eye, 1), /<mark>帽<\/mark>/);
  assert.match(render(eye, 2), /<mark>竖<\/mark>/);
  assert.match(render(dot, 1), /<mark>点<\/mark>/);
  assert.doesNotMatch(render(dot, 1), /<mark>剁<\/mark>/);
});

test('consulting a shared scene marks only material the learner has actually seen', () => {
  const part = data.partsByCharacter['他'];
  const target = {type: 'char', code: part.code, parts: [part]};
  assert.equal(exposesMnemonic(target, {role: 'a', letter: 'w', full: false}), false);
  assert.equal(exposesMnemonic(target, {role: 'a', letter: 'w', full: true}), true);
  assert.equal(exposesMnemonic(target, {role: 'a', letter: 'v', full: true}), false);
  const zero = data.items.find(i => i.type === 'initial' && i.initial === '0');
  assert.equal(exposesMnemonic(zero, {role: 'b', letter: 'd', full: true}), true);
  assert.equal(exposesMnemonic(zero, {role: 'b', letter: 'e', full: true}), false);
});
