'use strict';
const assert = require('assert');
const path = require('path');
const { buildClipIndex, pickClip } = require('../lib/proofclips');
const STORIES = require('../stories.json');
const RAW = require('../endorsements.json');

const index = buildClipIndex(RAW, STORIES);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const ids = id => (index.get(id) || []).map(c => c.id);

console.log('proofclips');

test('every clip belongs to exactly one story', () => {
  const seen = new Map();
  for (const [sid, list] of index) for (const c of list) {
    assert(!seen.has(c.id), `${c.id} attached to ${seen.get(c.id)} and ${sid}`);
    seen.set(c.id, sid);
  }
});

test('no multi-story company shares a clip between its stories', () => {
  const byCompany = {};
  for (const s of STORIES) (byCompany[s.company.toLowerCase()] = byCompany[s.company.toLowerCase()] || []).push(s.id);
  for (const [co, sids] of Object.entries(byCompany)) {
    if (sids.length < 2) continue;
    const all = sids.flatMap(ids);
    assert.strictEqual(new Set(all).size, all.length, `${co} shares clips`);
  }
});

test('Migrato Bob clips attach only to the Bob migration story (43), not the hybrid-cloud story (40)', () => {
  assert(ids(43).length === 4);
  assert.strictEqual(ids(40).length, 0);
  assert.strictEqual(pickClip(index, 40, 'hybrid architecture', null), null);
});

test('Blue Pearl clips attach to story 59 only; Java modernization story (17) gets none', () => {
  assert(ids(59).length === 4);
  assert.strictEqual(ids(17).length, 0);
});

test('CrushBank Bob clips go to story 30 and the service-management clips to story 8', () => {
  assert.deepStrictEqual(ids(30).sort(), ['crushbank-bob-data-ai', 'crushbank-bob-weeks-to-days']);
  assert(ids(8).every(i => !i.startsWith('crushbank-bob')));
});

test('single-story companies keep their clips', () => {
  const usta = STORIES.find(s => /US Open/i.test(s.company));
  assert(ids(usta.id).length >= 1);
});

test('clips whose company has no story are dropped, not misattached', () => {
  const all = [...index.values()].flat().map(c => c.id);
  assert(!all.some(i => i.startsWith('mylua') || i.startsWith('baypoint')) ||
    STORIES.some(s => /mylua|baypoint/i.test(s.company)));
});

test('timeline question picks the BookiePrice timeline clip for story 59', () => {
  const c = pickClip(index, 59, 'How long did the modernization take, nine months to six weeks timeline?', null);
  assert.strictEqual(c.id, 'bluepearl-bob-nine-months-to-six-weeks');
});

test('investment-reporting scope never gets the BookiePrice clip', () => {
  const scope = { project: { key: 'bluepearl-investment-reporting' } };
  const c = pickClip(index, 59, 'What was the delivery timeline? (investment reporting project)', scope);
  assert(c && c.id !== 'bluepearl-bob-nine-months-to-six-weeks');
});

test('BookiePrice scope may use the BookiePrice clip', () => {
  const scope = { project: { key: 'bluepearl-bookieprice' } };
  const c = pickClip(index, 59, 'What was the delivery timeline for BookiePrice?', scope);
  assert.strictEqual(c.id, 'bluepearl-bob-nine-months-to-six-weeks');
});

test('standalone investment-reporting question (no scope) does not get the BookiePrice clip', () => {
  const c = pickClip(index, 59, 'What was the delivery timeline for the Blue Pearl investment reporting project?', null);
  assert(c && c.id !== 'bluepearl-bob-nine-months-to-six-weeks');
});

test('unknown story returns null', () => {
  assert.strictEqual(pickClip(index, 99999, 'anything', null), null);
});

console.log(`\n${passed} proofclips tests passed`);
