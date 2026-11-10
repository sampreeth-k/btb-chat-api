'use strict';
const assert = require('assert');
const { correctKnownMetrics } = require('../lib/metrics');
const STORIES = require('../stories.json');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('metrics');

const DMV = new Set([47]);

test('California DMV "85% faster" becomes the correct 75% duration reduction', () => {
  const out = correctKnownMetrics('California DMV [S1] modernized its systems 85% faster, from 5 years to 15 months.', DMV);
  assert(!/85/.test(out), out);
  assert(/about 75% shorter/.test(out), out);
});

test('"reduced timelines by 85%" is corrected for the DMV story', () => {
  const out = correctKnownMetrics('California DMV reduced legacy modernization timelines by 85%.', DMV);
  assert(!/85/.test(out), out);
  assert(/about 75%/.test(out), out);
});

test('the arithmetic behind the correction: 5 years to 15 months is 75%', () => {
  assert.strictEqual((60 - 15) / 60, 0.75);
});

test('nothing changes when the DMV story is not part of the answer', () => {
  const t = 'Another customer cut processing time by 85%.';
  assert.strictEqual(correctKnownMetrics(t, new Set([59])), t);
});

test('85%+ test coverage and accuracy figures are left alone, even next to the DMV story', () => {
  const t = 'Blue Pearl generated modules with 85%+ test coverage.';
  assert.strictEqual(correctKnownMetrics(t, new Set([47, 59])), t);
  const u = 'Extraction accuracy reached 85% on the sample.';
  assert.strictEqual(correctKnownMetrics(u, new Set([47])), u);
});

test('empty input is returned unchanged', () => {
  assert.strictEqual(correctKnownMetrics('', DMV), '');
  assert.strictEqual(correctKnownMetrics(null, DMV), null);
});

test('California DMV story data no longer says "85% faster" or an 85% reduction', () => {
  const s = STORIES.find(x => x.id === 47);
  assert(s, 'story 47 exists');
  // The published blog title/URL/tags keep the headline; every descriptive field the model reads must not.
  const { title, articleUrl, url, storyUrl, blogUrl, tags, searchAliases, precisionSearchTerms, searchText, ...descriptive } = s;
  const text = JSON.stringify(descriptive);
  assert(!/85\s?%\s*(faster|reduc)|85 percent|reduced[^"]{0,40}by 85/i.test(text), text.match(/.{40}85.{40}/));
  assert(/75%|75 percent/.test(s.businessOutcome), s.businessOutcome);
  assert(/discovery/i.test(s.businessOutcome), s.businessOutcome);
});
console.log(`\n${passed} metrics tests passed`);
