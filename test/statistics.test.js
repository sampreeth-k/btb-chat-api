'use strict';
const assert = require('assert');
const { detectStatisticsQuery } = require('../server.js');
const { pointScore, rankProofPoints } = require('../lib/statistics');
const STORIES = require('../stories.json');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('statistics');

const Q = 'What are the most impressive single statistics across the entire story library?';

test('library-wide statistics question triggers the scan', () => {
  const m = detectStatisticsQuery(Q);
  assert(m && m.length > 30);
  assert(m.every(s => s.story_type !== 'rollup / insight'));
});

test('company-specific and unrelated questions do not trigger the scan', () => {
  assert.strictEqual(detectStatisticsQuery('What are the most impressive Blue Pearl statistics?'), null);
  assert.strictEqual(detectStatisticsQuery('List all customers using IBM Bob'), null);
});

test('pointScore ranks larger outcomes higher and ignores baselines', () => {
  assert(pointScore('Supported traffic spikes up to 5,000%') > pointScore('Reduced development time by 90%'));
  assert(pointScore('Reduced development time by 90%') > pointScore('Reduced inquiries by 37%'));
  assert.strictEqual(pointScore('~95% of web services already using REST'), 0);
  assert.strictEqual(pointScore('Completed the upgrade in two days'), 0);
});

test('rankProofPoints is deterministic, one entry per company, sorted descending', () => {
  const stories = detectStatisticsQuery(Q);
  const a = rankProofPoints(stories, 10);
  const b = rankProofPoints(stories, 10);
  assert.deepStrictEqual(a.map(r => r.story.id), b.map(r => r.story.id));
  assert.strictEqual(new Set(a.map(r => r.story.company)).size, a.length);
  for (let i = 1; i < a.length; i++) assert(a[i - 1].score >= a[i].score);
});

test('top results include known headline statistics', () => {
  const top = rankProofPoints(detectStatisticsQuery(Q), 12).map(r => r.story.company);
  ['US Open / USTA', 'Wikimedia Deutschland', 'Novacomp'].forEach(c => assert(top.includes(c), c + ' missing from top 12'));
});

test('no proof point contains garbled (mojibake) characters', () => {
  const bad = /\u00E2\u20AC|\u00C3[\u0080-\u00BF\u2014\u2013\u2018\u2019\u201C\u201D\u2022\u2026]/;
  const garbled = STORIES.filter(s => (s.proofPoints || []).some(p => bad.test(p)));
  assert.deepStrictEqual(garbled.map(s => s.company), []);
});

console.log(passed + ' passed');
