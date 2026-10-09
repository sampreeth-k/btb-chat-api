// _test_prompt_injection.js
// Validates that buildMessages() injects proof clip lines for companies
// that have endorsements, and omits them for companies that don't.
// Run with: node _test_prompt_injection.js
'use strict';

const fs   = require('fs');
const path = require('path');

/* ── Build TOP_CLIP_BY_COMPANY (mirrors server.js) ─────────────────────── */
const STRENGTH_RANK = { platinum: 4, gold: 3, silver: 2, bronze: 1 };
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'endorsements.json'), 'utf8'));
const TOP_CLIP_BY_COMPANY = {};
for (const clip of raw) {
  const key = (clip.storyMatch || clip.customer || '').toLowerCase().trim();
  if (!key) continue;
  const score = clip.score != null ? clip.score
    : (STRENGTH_RANK[(clip.strength || clip.rating || '').toLowerCase()] || 0);
  const existing = TOP_CLIP_BY_COMPANY[key];
  if (!existing || score > existing._score) {
    TOP_CLIP_BY_COMPANY[key] = {
      quote:    clip.quoteExcerpt || clip.quote || '',
      speaker:  clip.speaker || '',
      role:     clip.role || '',
      strength: clip.strength || clip.rating || '',
      _score:   score,
    };
  }
}

/* ── Minimal makeCitKey (mirrors lib/citations.js) ──────────────────────── */
function makeCitKey(id) { return `S${id}`; }

/* ── buildMessages() (mirrors server.js) ────────────────────────────────── */
function buildMessages(query, topStories) {
  const storyCtx = topStories.map((s) => {
    const outcome     = (s.businessOutcome || '').slice(0, 300);
    const metrics     = (s.outcomes || []).slice(0, 6).map(m => `- ${m}`).join('\n');
    const products    = (s.products || []).slice(0, 4).join(', ');
    const videoUrl    = s.videoUrl || s.customerVideoUrl || s.videoEmbedUrl || '';
    const videoLine   = videoUrl ? `\nVideo: ${videoUrl}` : '';
    const metricsLine = metrics ? `\nMetrics:\n${metrics}` : '';
    const citeAs      = makeCitKey(s.id);
    const clip        = TOP_CLIP_BY_COMPANY[(s.company || '').toLowerCase().trim()];
    const clipLine    = (clip && clip.quote)
      ? `\nProof clip (${clip.strength}): "${clip.quote}"` +
        (clip.speaker ? ` — ${clip.speaker}${clip.role ? `, ${clip.role}` : ''}` : '')
      : '';
    return `CITE_AS=[${citeAs}] | ${s.company} | ${Array.isArray(s.industry) ? s.industry.join(', ') : (s.industry||'')} | ${s.region}\nProducts: ${products}\nOutcome: ${outcome}${metricsLine}${clipLine}${videoLine}`;
  }).join('\n---\n');
  return [
    { role: 'system', content: '<SYSTEM>' },
    { role: 'user',   content: `Story data:\n${storyCtx}\n\nQuestion: ${query}` }
  ];
}

/* ── Test cases ─────────────────────────────────────────────────────────── */
const STORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'stories.json'), 'utf8'));

const tests = [
  {
    label: 'CCG — Platinum clip should appear',
    company: 'Claims Connection Group',
    expectClip: true,
    expectStrength: 'Platinum',
    expectSpeaker: 'Mark Murphy',
  },
  {
    label: 'USTA — Gold clip should appear',
    company: 'US Open / USTA',
    expectClip: true,
    expectStrength: 'Gold',
  },
  {
    label: 'MyLua — Platinum clip should appear',
    company: 'MyLua',
    expectClip: true,
    expectStrength: 'Platinum',
    expectSpeaker: 'Dr. Michael Conward',
  },
  {
    label: 'Fogel Law Group — no clip (not in endorsements)',
    company: 'Fogel Law Group',
    expectClip: false,
  },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const story = STORIES.find(s => s.company === t.company);
  if (!story) {
    console.log(`SKIP  ${t.label} — story not found in stories.json`);
    continue;
  }

  const msgs = buildMessages('test query', [story]);
  const userContent = msgs[1].content;

  const hasClipLine = userContent.includes('\nProof clip (');

  let ok = true;
  const issues = [];

  if (t.expectClip && !hasClipLine) {
    ok = false; issues.push('Expected proof clip line — not found');
  }
  if (!t.expectClip && hasClipLine) {
    ok = false; issues.push('Did not expect proof clip line — but found one');
  }
  if (t.expectClip && t.expectStrength && !userContent.includes(`Proof clip (${t.expectStrength})`)) {
    ok = false; issues.push(`Expected strength "${t.expectStrength}" in clip line`);
  }
  if (t.expectClip && t.expectSpeaker && !userContent.includes(t.expectSpeaker)) {
    ok = false; issues.push(`Expected speaker "${t.expectSpeaker}" in clip line`);
  }

  if (ok) {
    console.log(`PASS  ${t.label}`);
    // Print the clip line for visibility
    const clipMatch = userContent.match(/\nProof clip \([^)]+\): "[^"]*"[^\n]*/);
    if (clipMatch) console.log(`      ${clipMatch[0].trim()}`);
    passed++;
  } else {
    console.log(`FAIL  ${t.label}`);
    issues.forEach(i => console.log(`      ✗ ${i}`));
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
