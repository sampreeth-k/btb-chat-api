'use strict';
const assert = require('assert');
const { detectTopicQuery, formatTopicAnswer, topicStories } = require('../lib/topics');
const { makeCitKey, resolveCitations } = require('../lib/citations');
const raw = require('../stories.json');
const STORIES = Array.isArray(raw) ? raw : raw.stories;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('topics');

const Q = 'Can you share the link of the customer stories that talk about multi-model and multi-cloud product capabilities';
const companies = r => topicStories(r).map(s => s.company);

test('compound multi-model + multi-cloud link request is handled', () => {
  const r = detectTopicQuery(Q, STORIES);
  assert(r && r.topics.length === 2);
  const c = companies(r);
  ['Athena Intelligence', 'Lumenore', 'Aligne AI'].forEach(n => assert(c.includes(n), n + ' missing'));
});

test('multi-cloud overview article is listed as an overview, not a customer', () => {
  const r = detectTopicQuery('Share the links to customer stories about multi-cloud', STORIES);
  const cloud = r.topics[0];
  assert(cloud.overviews.some(h => /Hybrid and multicloud AI/.test(h.story.title)));
  assert(cloud.customers.every(h => (h.story.story_type || '') !== 'rollup / insight'));
});

test('stories matched only via hidden searchText are not listed', () => {
  const r = detectTopicQuery('Share the links to customer stories about multi-cloud', STORIES);
  assert(!companies(r).includes('AXA Brazil'));
});

test('answer cites every listed story and resolves to sources', () => {
  const r = detectTopicQuery(Q, STORIES);
  const res = resolveCitations(formatTopicAnswer(r, makeCitKey), topicStories(r));
  assert(!/CIT:/.test(res.answer));
  assert.strictEqual(res.reorderedStories.length, topicStories(r).length);
  assert(/No single customer story above is listed under both topics/.test(res.answer));
});

test('company-named and non-list questions fall through to normal retrieval', () => {
  assert.strictEqual(detectTopicQuery('Which Athena Intelligence stories mention multi-cloud?', STORIES), null);
  assert.strictEqual(detectTopicQuery('Tell me about multi-cloud', STORIES), null);
  assert.strictEqual(detectTopicQuery('List all customers using IBM Bob', STORIES), null);
});

console.log(passed + ' passed');
