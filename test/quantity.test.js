'use strict';
const assert = require('assert');
const { quantityBonus, countedNouns, QUANTITY_BONUS } = require('../lib/quantity');
const CORPUS = require('../corpus.json');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('quantity');

const Q = 'How many developers did Blue Pearl need for the BookiePrice project?';

test('finds the counted noun after "how many"', () => {
  assert.deepStrictEqual(countedNouns(Q), ['developer']);
  assert.deepStrictEqual(countedNouns('How many senior developers were on the project?'), ['senior', 'developer']);
  assert.deepStrictEqual(countedNouns('What was the timeline?'), []);
});

test('a passage stating a number before the noun gets the bonus', () => {
  assert.strictEqual(quantityBonus(Q, 'we needed 14 senior developers to modernize it'), QUANTITY_BONUS);
  assert.strictEqual(quantityBonus(Q, 'scoped at nine months with 14 developers'), QUANTITY_BONUS);
});

test('a passage that only discusses developers gets no bonus', () => {
  assert.strictEqual(quantityBonus(Q, 'developers used Bob to assess the legacy ASP.NET code'), 0);
  assert.strictEqual(quantityBonus('What was the timeline?', 'we needed 14 senior developers'), 0);
});

test('Blue Pearl transcript chunk with "14 senior developers" is the only BookiePrice chunk that earns the bonus', () => {
  const hits = CORPUS.filter(c => c.storyId === 59 && quantityBonus(Q, c.text) > 0);
  assert(hits.length >= 1, 'at least one chunk');
  assert(hits.every(c => /14 (senior )?developers/i.test(c.text)), hits.map(c => c.chunkIndex).join());
});

console.log(`\n${passed} quantity tests passed`);
