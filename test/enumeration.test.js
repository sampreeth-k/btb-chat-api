'use strict';
const assert = require('assert');
const { detectProductEnumerationQuery } = require('../server.js');
const STORIES = require('../stories.json');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('enumeration');

const bob = detectProductEnumerationQuery('List all customers using IBM Bob');
const wxai = detectProductEnumerationQuery('How many watsonx.ai stories are there?');

test('IBM Bob list excludes the "IBM Bob" rollup as a customer', () => {
  assert(!bob.companies.some(g => /^IBM\b/i.test(g.company)));
  assert(bob.stories.every(s => s.story_type !== 'rollup / insight'));
});

test('Blue Pearl appears once as a customer but keeps both stories', () => {
  const bp = bob.companies.filter(g => g.company === 'Blue Pearl');
  assert.strictEqual(bp.length, 1);
  assert.deepStrictEqual(bp[0].stories.map(s => s.id).sort((a, b) => a - b), [17, 59]);
});

test('customer count and story count are reported separately and are consistent', () => {
  assert.strictEqual(bob.companies.length, new Set(bob.stories.map(s => s.company)).size);
  assert(bob.stories.length > bob.companies.length);
});

test('watsonx.ai list is not truncated to ten', () => {
  assert(wxai.stories.length > 10);
  assert.strictEqual(wxai.stories.length, STORIES.filter(s => s.story_type !== 'rollup / insight' &&
    /\bwatsonx\.ai\b/i.test([s.title, s.description, s.primaryProduct, s.primaryIBMProduct, (s.products || []).join(' '),
      (s.tags || []).join(' '), (s.searchAliases || []).join(' '), s.precisionSearchTerms || '', s.searchText || ''].join(' '))).length);
});

test('every story returned appears under exactly one customer group', () => {
  const grouped = wxai.companies.flatMap(g => g.stories.map(s => s.id));
  assert.deepStrictEqual(grouped.sort((a, b) => a - b), wxai.stories.map(s => s.id).sort((a, b) => a - b));
});

test('non-enumeration question returns null', () => {
  assert.strictEqual(detectProductEnumerationQuery('What was the delivery timeline?'), null);
});

console.log(`\n${passed} enumeration tests passed`);
