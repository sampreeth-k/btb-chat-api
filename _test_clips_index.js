// Quick local test: verify endorsement index builds correctly and
// that buildMessages() injects clip lines for stories that have them.
'use strict';

const fs   = require('fs');
const path = require('path');

/* ── Replicate the index build from server.js ─────────────────────────── */
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

const companies = Object.keys(TOP_CLIP_BY_COMPANY);
console.log(`\n=== Endorsement index: ${raw.length} clips -> ${companies.length} companies ===\n`);
for (const company of companies.sort()) {
  const c = TOP_CLIP_BY_COMPANY[company];
  console.log(`${company}  (${c.strength}, score=${c._score})`);
  console.log(`  "${c.quote.slice(0, 90)}${c.quote.length > 90 ? '...' : ''}"`);
  console.log(`  — ${c.speaker || '(no speaker)'}${c.role ? ', ' + c.role : ''}`);
  console.log('');
}

/* ── Replicate buildMessages() for a few sample stories ──────────────── */
const STORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'stories.json'), 'utf8'));

// Pick stories that should / should not have clips
const TARGET_COMPANIES = [
  'Claims Connection Group', 'Mitie', 'CrushBank', 'Baypoint Advisors',
  'MyLua', 'US Open / USTA', 'AXA Brazil', 'Fogel Law Group'
];

const samples = STORIES.filter(s => TARGET_COMPANIES.includes(s.company)).slice(0, 8);

console.log('\n=== Prompt context blocks for sample stories ===\n');
for (const s of samples) {
  const outcome     = (s.businessOutcome || '').slice(0, 300);
  const metrics     = (s.outcomes || []).slice(0, 3).map(m => `- ${m}`).join('\n');
  const products    = (s.products || []).slice(0, 4).join(', ');
  const metricsLine = metrics ? `\nMetrics:\n${metrics}` : '';
  const clip        = TOP_CLIP_BY_COMPANY[(s.company || '').toLowerCase().trim()];
  const clipLine    = (clip && clip.quote)
    ? `\nProof clip (${clip.strength}): "${clip.quote}"` +
      (clip.speaker ? ` — ${clip.speaker}${clip.role ? `, ${clip.role}` : ''}` : '')
    : '';

  const block = `CITE_AS=[S?] | ${s.company} | ${Array.isArray(s.industry) ? s.industry.join(', ') : (s.industry || '')} | ${s.region}
Products: ${products}
Outcome: ${outcome}${metricsLine}${clipLine}`;

  console.log(block);
  console.log('---');
}
