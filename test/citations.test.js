/**
 * test/citations.test.js — deterministic unit tests for citation integrity
 *
 * Imports makeCitKey and resolveCitations from lib/citations.js — the same
 * module used by server.js. There is no copied implementation here.
 *
 * Run with: node test/citations.test.js
 * Zero-tolerance: any failure exits with code 1 (CI merge gate).
 */

'use strict';

const path = require('path');
const { makeCitKey, resolveCitations } = require(path.join(__dirname, '..', 'lib', 'citations'));

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── makeCitKey ────────────────────────────────────────────────────────────────

console.log('\n── makeCitKey ───────────────────────────────────────────────────\n');

assert('numeric id',     makeCitKey(25),    'CIT:story-25');
assert('string id',      makeCitKey('25'),  'CIT:story-25');
assert('id 1',           makeCitKey(1),     'CIT:story-1');
assert('id 47',          makeCitKey(47),    'CIT:story-47');

// ── Key uniqueness across all 47 stories ─────────────────────────────────────

console.log('\n── Key uniqueness across complete 47-story dataset ─────────────\n');

try {
  const stories = require(path.join(__dirname, '..', 'stories.json'));
  const keys    = stories.map(s => makeCitKey(s.id));
  const unique  = new Set(keys);
  assert('47 stories produce 47 unique CIT keys', unique.size, stories.length);

  // Detect and report any collision
  if (unique.size < stories.length) {
    const counts = {};
    keys.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
    Object.entries(counts)
      .filter(([, v]) => v > 1)
      .forEach(([k]) => console.error(`  COLLISION: ${k}`));
  }
} catch (e) {
  console.error('  ✗  stories.json unavailable — skipping uniqueness check:', e.message);
  failed++;
}

// ── Two stories with the same company name ────────────────────────────────────

console.log('\n── Same company, different story IDs (e.g. CrushBank) ──────────\n');

{
  const storyList = [
    { id: 30, company: 'CrushBank' },
    { id: 43, company: 'CrushBank' }
  ];
  const answer = 'CrushBank [CIT:story-30] is one. CrushBank [CIT:story-43] is another.';
  const { answer: resolved, reorderedStories } = resolveCitations(answer, storyList);

  assert('story-30 becomes [S1]',           resolved.includes('[S1]'),              true);
  assert('story-43 becomes [S2]',           resolved.includes('[S2]'),              true);
  assert('no CIT tokens remain',            resolved.includes('[CIT:'),             false);
  assert('sources[0] is story id 30',       reorderedStories[0].id,                30);
  assert('sources[1] is story id 43',       reorderedStories[1].id,                43);
  assert('both companies are CrushBank',    reorderedStories[0].company,           'CrushBank');
}

// ── Healthcare regression (original auditor bug) ──────────────────────────────

console.log('\n── Healthcare regression: MyLua/ViClinic ordering ───────────────\n');

{
  // topStories order: ViClinic first, MyLua second
  // LLM output: mentions MyLua first — old positional scheme would mislink
  const storyList = [
    { id: 1, company: 'ViClinic'    },
    { id: 2, company: 'MyLua Health' }
  ];
  const answer =
    'Healthcare AI is improving outcomes. ' +
    'MyLua Health [CIT:story-2] is shifting care from reactive to preventive. ' +
    'ViClinic [CIT:story-1] also demonstrates strong outcomes.';

  const { answer: resolved, reorderedStories } = resolveCitations(answer, storyList);

  assert('sources[0] = MyLua Health (first cited)',  reorderedStories[0].company, 'MyLua Health');
  assert('sources[1] = ViClinic (second cited)',      reorderedStories[1].company, 'ViClinic');
  assert('MyLua Health resolves to [S1]',             resolved.includes('MyLua Health [S1]'), true);
  assert('ViClinic resolves to [S2]',                 resolved.includes('ViClinic [S2]'),     true);
  assert('no raw CIT tokens remain',                  resolved.includes('[CIT:'),             false);
}

// ── LLM cites in retrieval order ─────────────────────────────────────────────

console.log('\n── LLM cites in retrieval order ─────────────────────────────────\n');

{
  const storyList = [
    { id: 1, company: 'ViClinic'    },
    { id: 2, company: 'MyLua Health' }
  ];
  const answer = 'ViClinic [CIT:story-1] cut times. MyLua Health [CIT:story-2] reduced readmissions.';
  const { answer: resolved, reorderedStories } = resolveCitations(answer, storyList);

  assert('sources[0] = ViClinic',             reorderedStories[0].company, 'ViClinic');
  assert('sources[1] = MyLua Health',         reorderedStories[1].company, 'MyLua Health');
  assert('ViClinic is [S1]',                  resolved.includes('ViClinic [S1]'), true);
}

// ── Missing citation tokens in the answer ─────────────────────────────────────

console.log('\n── Missing citation tokens ──────────────────────────────────────\n');

{
  // LLM forgets to place any token
  const storyList = [
    { id: 25, company: 'US Open / USTA' },
    { id: 5,  company: 'AXA Brazil'     }
  ];
  const answer = 'US Open / USTA had great outcomes. AXA Brazil scaled APIs.'; // no tokens

  const { answer: resolved, reorderedStories } = resolveCitations(answer, storyList);

  assert('answer unchanged when no tokens present', resolved, answer);
  assert('all stories still in sources',            reorderedStories.length, 2);
}

// ── Unknown / malformed tokens sanitized ─────────────────────────────────────

console.log('\n── Unknown and malformed tokens sanitized ───────────────────────\n');

{
  const storyList = [{ id: 1, company: 'ViClinic' }];

  // Unknown story ID — should be stripped, not shown to user
  const answer1 = 'ViClinic [CIT:story-1] is great. Unknown [CIT:story-999] is mystery.';
  const { answer: resolved1 } = resolveCitations(answer1, storyList);
  assert('known token replaced with [S1]',      resolved1.includes('[S1]'),           true);
  assert('unknown token stripped (empty string)',resolved1.includes('[CIT:story-999]'), false);
  assert('unknown token not shown to user',      resolved1.includes('CIT:'),           false);

  // Completely malformed format — regex won't match, left verbatim
  const answer2 = 'ViClinic [CIT:story-1] good. [S1] manual ref. [CITE:bad].';
  const { answer: resolved2 } = resolveCitations(answer2, storyList);
  assert('[S1] manual ref preserved verbatim',   resolved2.includes('[S1] manual ref'), true);
  assert('[CITE:bad] not matched by regex',       resolved2.includes('[CITE:bad]'),     true);
}

// ── Only some retrieved stories are cited ────────────────────────────────────

console.log('\n── Partially-cited answer: uncited story appended to sources ────\n');

{
  const storyList = [
    { id: 10, company: 'Acme'  },
    { id: 11, company: 'Beta'  },
    { id: 12, company: 'Gamma' }
  ];
  const answer = 'Acme [CIT:story-10] excels. Gamma [CIT:story-12] also shows results.';
  const { answer: resolved, reorderedStories } = resolveCitations(answer, storyList);

  assert('total sources = 3',              reorderedStories.length, 3);
  assert('sources[0] = Acme (1st cited)',  reorderedStories[0].company, 'Acme');
  assert('sources[1] = Gamma (2nd cited)', reorderedStories[1].company, 'Gamma');
  assert('sources[2] = Beta (uncited)',    reorderedStories[2].company, 'Beta');
  assert('Acme is [S1] in answer',         resolved.includes('Acme [S1]'),  true);
  assert('Gamma is [S2] in answer',        resolved.includes('Gamma [S2]'), true);
}

// ── Duplicate token usage ─────────────────────────────────────────────────────

console.log('\n── Duplicate token in answer ────────────────────────────────────\n');

{
  const storyList = [{ id: 5, company: 'AXA Brazil' }];
  const answer = 'AXA Brazil [CIT:story-5] scaled APIs. AXA Brazil [CIT:story-5] again.';
  const { answer: resolved } = resolveCitations(answer, storyList);

  const count = (resolved.match(/\[S1\]/g) || []).length;
  assert('both [CIT:story-5] tokens replaced with [S1]', count, 2);
  assert('no CIT tokens remain', resolved.includes('[CIT:'), false);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed  |  ${failed} failed`);
if (failed > 0) {
  console.error('\nCITATION TEST FAILURES — release blocker.\n');
  process.exit(1);
} else {
  console.log('\nAll citation tests passed.\n');
}
