/**
 * _test_citations.js — deterministic unit tests for citation integrity
 *
 * Tests the makeCitKey + resolveCitations functions in isolation.
 * No network calls, no watsonx, no corpus required.
 * Run with: node _test_citations.js
 *
 * These are zero-tolerance tests — a single failure is a release blocker.
 */

'use strict';

// ── Copy the two functions under test from server.js ─────────────────────────
// (Keeping them inline avoids any require() path issues)

function makeCitKey(company) {
  return 'CIT:' + company.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

function resolveCitations(answer, storyList) {
  const keyToIdx = {};
  storyList.forEach((s, i) => { keyToIdx[makeCitKey(s.company)] = i; });

  const citationOrder = [];
  answer.replace(/\[CIT:[A-Za-z0-9]+\]/g, match => {
    const key = match.slice(1, -1);
    const idx = keyToIdx[key];
    if (idx !== undefined && !citationOrder.includes(idx)) citationOrder.push(idx);
  });
  storyList.forEach((_, i) => { if (!citationOrder.includes(i)) citationOrder.push(i); });

  const keyToSRef = {};
  citationOrder.forEach((origIdx, newPos) => {
    keyToSRef[makeCitKey(storyList[origIdx].company)] = newPos + 1;
  });

  const remapped = answer.replace(/\[CIT:[A-Za-z0-9]+\]/g, match => {
    const key = match.slice(1, -1);
    const n   = keyToSRef[key];
    return n ? `[S${n}]` : match;
  });

  const reorderedStories = citationOrder.map(i => storyList[i]);
  return { answer: remapped, reorderedStories };
}

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

function assertDeepEqual(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`     expected: ${e}`);
    console.error(`     actual:   ${a}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── makeCitKey ───────────────────────────────────────────────────\n');

assert('simple name',          makeCitKey('ViClinic'),        'CIT:ViClinic');
assert('name with spaces',     makeCitKey('MyLua Health'),    'CIT:MyLuaHealth');
assert('name with slash',      makeCitKey('US Open / USTA'),  'CIT:USOpenUSTA');
assert('long name truncated',  makeCitKey('California Department of Motor Vehicles'),
                                                              'CIT:CaliforniaDe');
assert('special chars stripped', makeCitKey('AXA Brazil!'),  'CIT:AXABrazil');

console.log('\n── resolveCitations: standard case ─────────────────────────────\n');

{
  // LLM writes MyLua first even though topStories[0]=ViClinic
  // This is the exact healthcare bug the auditor reported
  const topStories = [
    { company: 'ViClinic',    id: 1 },
    { company: 'MyLua Health', id: 2 }
  ];
  const answer = 'Healthcare AI is improving outcomes. MyLua Health [CIT:MyLuaHealth] is shifting care from reactive to preventive. ViClinic [CIT:ViClinic] also demonstrates strong outcomes.';

  const { answer: resolved, reorderedStories } = resolveCitations(answer, topStories);

  assert('answer contains [S1]',                resolved.includes('[S1]'), true);
  assert('answer contains [S2]',                resolved.includes('[S2]'), true);
  assert('no raw CIT tokens remain',            resolved.includes('[CIT:'), false);
  assert('sources[0] matches first-cited company', reorderedStories[0].company, 'MyLua Health');
  assert('sources[1] matches second-cited company', reorderedStories[1].company, 'ViClinic');
  assert('MyLua Health is [S1] in answer',      resolved.includes('MyLua Health [S1]'), true);
  assert('ViClinic is [S2] in answer',          resolved.includes('ViClinic [S2]'), true);
}

console.log('\n── resolveCitations: LLM cites in retrieval order ──────────────\n');

{
  const topStories = [
    { company: 'ViClinic',    id: 1 },
    { company: 'MyLua Health', id: 2 }
  ];
  const answer = 'ViClinic [CIT:ViClinic] cut diagnosis time. MyLua Health [CIT:MyLuaHealth] reduced readmissions.';

  const { answer: resolved, reorderedStories } = resolveCitations(answer, topStories);

  assert('sources[0] = ViClinic when cited first', reorderedStories[0].company, 'ViClinic');
  assert('sources[1] = MyLua Health',              reorderedStories[1].company, 'MyLua Health');
  assert('ViClinic is [S1]',  resolved.includes('ViClinic [S1]'), true);
  assert('MyLua is [S2]',     resolved.includes('MyLua Health [S2]'), true);
}

console.log('\n── resolveCitations: uncited story appended to sources ──────────\n');

{
  const topStories = [
    { company: 'ViClinic',    id: 1 },
    { company: 'MyLua Health', id: 2 },
    { company: 'Acme Corp',    id: 3 }
  ];
  const answer = 'ViClinic [CIT:ViClinic] has strong outcomes.'; // only cites one

  const { reorderedStories } = resolveCitations(answer, topStories);

  assert('uncited story still in sources', reorderedStories.length, 3);
  assert('cited story first',              reorderedStories[0].company, 'ViClinic');
}

console.log('\n── resolveCitations: unknown CIT token left as-is ──────────────\n');

{
  const topStories = [{ company: 'ViClinic', id: 1 }];
  const answer = 'ViClinic [CIT:ViClinic] is great. [CIT:Unknown] is mystery.';

  const { answer: resolved } = resolveCitations(answer, topStories);

  assert('[S1] inserted for known company',  resolved.includes('[S1]'),          true);
  assert('unknown token left as-is',         resolved.includes('[CIT:Unknown]'), true);
}

console.log('\n── resolveCitations: company name with special chars ────────────\n');

{
  const topStories = [
    { company: 'US Open / USTA', id: 1 },
    { company: 'AXA Brazil',      id: 2 }
  ];
  const answer = 'US Open / USTA [CIT:USOpenUSTA] runs IBM SlamTracker. AXA Brazil [CIT:AXABrazil] scales APIs.';

  const { answer: resolved, reorderedStories } = resolveCitations(answer, topStories);

  assert('USTA resolves to [S1]',      resolved.includes('[S1]'),                    true);
  assert('AXA resolves to [S2]',       resolved.includes('[S2]'),                    true);
  assert('sources[0] = USTA',          reorderedStories[0].company, 'US Open / USTA');
  assert('sources[1] = AXA Brazil',    reorderedStories[1].company, 'AXA Brazil');
}

console.log('\n── resolveCitations: each key used at most once ─────────────────\n');

{
  const topStories = [{ company: 'ViClinic', id: 1 }];
  const answer = 'ViClinic [CIT:ViClinic] is great. ViClinic [CIT:ViClinic] again.';

  const { answer: resolved } = resolveCitations(answer, topStories);

  const matches = (resolved.match(/\[S1\]/g) || []).length;
  assert('duplicate CIT token still renders both [S1] refs', matches, 2);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed  |  ${failed} failed`);
if (failed > 0) {
  console.error('\nCITATION TEST FAILURES — this is a release blocker.\n');
  process.exit(1);
} else {
  console.log('\nAll citation tests passed.\n');
}
