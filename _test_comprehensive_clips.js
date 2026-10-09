// _test_comprehensive_clips.js
// Comprehensive test of proof-clip injection + LLM quote usage.
//
// Modes:
//   node _test_comprehensive_clips.js local   — prompt injection only (no API)
//   node _test_comprehensive_clips.js live    — hit live deployed API
//   node _test_comprehensive_clips.js local live — both
//
// Default (no args) = local only
'use strict';

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');

const MODE_LOCAL = process.argv.includes('local') || !process.argv.includes('live');
const MODE_LIVE  = process.argv.includes('live');
const LIVE_URL   = 'https://btb-chat-api.onrender.com/v1/chat';

/* ── Replicate server-side endorsement index ──────────────────────────── */
const STRENGTH_RANK = { platinum: 4, gold: 3, silver: 2, bronze: 1 };
const rawEndorsements = JSON.parse(fs.readFileSync(path.join(__dirname, 'endorsements.json'), 'utf8'));
const TOP_CLIP_BY_COMPANY = {};
for (const clip of rawEndorsements) {
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
const STORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'stories.json'), 'utf8'));

/* ── Replicate buildMessages() ────────────────────────────────────────── */
function makeCitKey(id) { return `S${id}`; }
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
    { role: 'system', content: 'SYSTEM' },
    { role: 'user',   content: `Story data:\n${storyCtx}\n\nQuestion: ${query}` }
  ];
}

/* ── Test definitions ─────────────────────────────────────────────────── */
// Each test:
//   company         : must match stories.json company exactly
//   prompt          : the user query
//   promptType      : label for reporting
//   expectClipIn    : string that MUST appear in the prompt context
//   expectLLMQuote  : fragment of the clip quote the LLM SHOULD surface (live only)
const TESTS = [
  // ── Direct quote asks ───────────────────────────────────────────────
  {
    company: 'Claims Connection Group',
    promptType: 'Direct quote ask',
    prompt: 'Do you have a customer quote from Claims Connection Group about Lexxari?',
    expectClipIn: 'I\'m uploading that policy into Lexxari',
    expectLLMQuote: 'minute',
  },
  {
    company: 'US Open / USTA',
    promptType: 'Direct quote ask',
    prompt: 'What did the USTA say about fan engagement at the US Open?',
    expectClipIn: '14 million uniques',
    expectLLMQuote: '14 million',
  },
  {
    company: 'Knockri',
    promptType: 'Direct quote ask',
    prompt: 'Any customer quotes from Knockri about AI and hiring?',
    expectClipIn: 'We really wanted to build our models',
    expectLLMQuote: 'models',
  },
  {
    company: 'MyLua',  // NOT in stories.json — should get no clip
    promptType: 'Direct quote ask (no story match)',
    prompt: 'What did MyLua say about helping mothers?',
    expectClipIn: null,  // story not in server-side data — skip injection check
    expectLLMQuote: null,
  },

  // ── Topic / outcome based ───────────────────────────────────────────
  {
    company: 'Mitie',
    promptType: 'Topic-based',
    prompt: 'Show me EMEA facility management stories with IBM Maximo',
    expectClipIn: 'It\u2019s a solution that we can trust',
    expectLLMQuote: 'trust',
  },
  {
    company: 'AXA Brazil',
    promptType: 'Topic-based',
    prompt: 'Insurance companies using IBM integration at scale in AMER',
    expectClipIn: '40 million transactions',
    expectLLMQuote: 'transactions',
  },
  {
    company: 'FlexiVan',
    promptType: 'Topic-based',
    prompt: 'Stories about IBM webMethods for logistics or container shipping',
    expectClipIn: 'security, observability as part of the product',
    expectLLMQuote: 'security',
  },
  {
    company: 'Wikimedia Deutschland',
    promptType: 'Topic-based',
    prompt: 'Open source or nonprofit organisations improving database performance with IBM',
    expectClipIn: '30 times faster performance',
    expectLLMQuote: '30 times',
  },

  // ── Product-based ───────────────────────────────────────────────────
  {
    company: 'CrushBank',
    promptType: 'Product-based',
    prompt: 'What customers are using IBM watsonx.data and watsonx.ai together?',
    expectClipIn: 'That\u2019s the other thing that we love about the IBM technology',
    expectLLMQuote: 'IBM technology',
  },
  {
    company: 'Edsvaard',
    promptType: 'Product-based',
    prompt: 'Customer stories using IBM watsonx.data for document intelligence',
    expectClipIn: 'we can integrate… process in place… no ETL',
    expectLLMQuote: 'ETL',
  },
  {
    company: 'Shorthills AI',
    promptType: 'Product-based',
    prompt: 'AI partners building on IBM watsonx.data for search and RAG',
    expectClipIn: 'choosing the IBM watsonx.data platform',
    expectLLMQuote: 'watsonx',
  },
  {
    company: 'Bud Financial',
    promptType: 'Product-based',
    prompt: 'Fintech companies using Astra DB or Cassandra on IBM watsonx.data',
    expectClipIn: 'We got it to the enterprise grade when we moved… to Astra',
    expectLLMQuote: 'enterprise',
  },

  // ── Persona / seller-style asks ─────────────────────────────────────
  {
    company: 'Knockri',
    promptType: 'Persona (HR buyer)',
    prompt: 'I\'m talking to an HR director. Any stories about AI-powered hiring or recruitment?',
    expectClipIn: 'We really wanted to build our models',
    expectLLMQuote: null,
  },
  {
    company: 'Claims Connection Group',
    promptType: 'Persona (insurance exec)',
    prompt: 'I\'m pitching to an insurance executive. What\'s your best AI story?',
    expectClipIn: 'I\'m uploading that policy into Lexxari',
    expectLLMQuote: null,
  },
  {
    company: 'US Open / USTA',
    promptType: 'Persona (sports/media exec)',
    prompt: 'Need a story for a sports or media company about AI improving fan experience',
    expectClipIn: '14 million uniques',
    expectLLMQuote: null,
  },

  // ── Superlative / comparison ────────────────────────────────────────
  {
    company: 'CrushBank',
    promptType: 'Superlative',
    prompt: 'Which story has the most impressive AI productivity gain?',
    expectClipIn: 'That\u2019s the other thing that we love about the IBM technology',
    expectLLMQuote: null,
  },
  {
    company: 'Mitie',
    promptType: 'Superlative',
    prompt: 'Best example of a large-scale enterprise IBM Maximo deployment?',
    expectClipIn: 'It\u2019s a solution that we can trust',
    expectLLMQuote: 'trust',
  },

  // ── Vague / broad ───────────────────────────────────────────────────
  {
    company: 'Claims Connection Group',
    promptType: 'Vague / broad',
    prompt: 'Show me stories with strong customer proof',
    expectClipIn: 'I\'m uploading that policy into Lexxari',
    expectLLMQuote: null,
  },
  {
    company: 'Wikimedia Deutschland',
    promptType: 'Vague / broad',
    prompt: 'Any stories about database or performance improvements?',
    expectClipIn: '30 times faster performance',
    expectLLMQuote: null,
  },
];

/* ── Helpers ──────────────────────────────────────────────────────────── */
function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { reject(new Error('Bad JSON: ' + buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

let passed = 0, failed = 0, skipped = 0;
const results = [];

/* ── LOCAL injection tests ────────────────────────────────────────────── */
async function runLocal() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('LOCAL INJECTION TESTS (no API)');
  console.log('══════════════════════════════════════════════════\n');

  for (const t of TESTS) {
    const story = STORIES.find(s => s.company === t.company);
    if (!story) {
      console.log(`SKIP  [${t.promptType}] ${t.company} — not in stories.json`);
      skipped++;
      results.push({ company: t.company, promptType: t.promptType, localResult: 'SKIP', liveResult: null });
      continue;
    }
    if (!t.expectClipIn) {
      console.log(`SKIP  [${t.promptType}] ${t.company} — no clip expected (skip injection check)`);
      skipped++;
      results.push({ company: t.company, promptType: t.promptType, localResult: 'SKIP', liveResult: null });
      continue;
    }

    const msgs = buildMessages(t.prompt, [story]);
    const ctx  = msgs[1].content;
    const hasClip = ctx.includes('Proof clip (');
    const hasExpected = t.expectClipIn ? ctx.includes(t.expectClipIn) : true;

    const ok = hasClip && hasExpected;
    const label = ok ? 'PASS' : 'FAIL';
    if (ok) passed++; else failed++;

    const clipMatch = ctx.match(/Proof clip \([^)]+\): "[^"]*"(?:[^\n]*)*/);
    console.log(`${label}  [${t.promptType}] ${t.company}`);
    if (clipMatch) console.log(`      ${clipMatch[0].trim().slice(0, 110)}`);
    if (!hasClip)     console.log(`      ✗ No "Proof clip" line found in context`);
    if (!hasExpected) console.log(`      ✗ Expected fragment not found: "${t.expectClipIn.slice(0, 50)}"`);

    results.push({ company: t.company, promptType: t.promptType, localResult: label, liveResult: null });
  }
}

/* ── LIVE API tests ───────────────────────────────────────────────────── */
async function runLive() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('LIVE API TESTS (deployed API — pre-deploy code)');
  console.log('══════════════════════════════════════════════════\n');

  for (const t of TESTS) {
    if (!t.expectLLMQuote) {
      // Only test cases where we have a specific quote fragment to look for
      const existing = results.find(r => r.company === t.company && r.promptType === t.promptType);
      if (existing) existing.liveResult = 'SKIP (no quote assertion)';
      continue;
    }

    process.stdout.write(`      [${t.promptType}] ${t.company} — querying... `);
    try {
      const resp = await postJson(LIVE_URL, { query: t.prompt, top_k: 4 });
      const answer = (resp.body.answer || '').toLowerCase();
      const mode   = resp.body.answer_mode || '?';
      const hasQuote = answer.includes(t.expectLLMQuote.toLowerCase());
      const label = hasQuote ? 'PASS' : 'FAIL';
      if (hasQuote) passed++; else failed++;

      console.log(label + ` [${mode}]`);
      console.log(`      Prompt: "${t.prompt.slice(0, 70)}"`);
      console.log(`      Answer: "${(resp.body.answer || '').slice(0, 160)}"`);
      if (!hasQuote) console.log(`      ✗ Expected "${t.expectLLMQuote}" in answer`);
      console.log('');

      const existing = results.find(r => r.company === t.company && r.promptType === t.promptType);
      if (existing) existing.liveResult = label + ` [${mode}]`;
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      const existing = results.find(r => r.company === t.company && r.promptType === t.promptType);
      if (existing) existing.liveResult = 'ERROR: ' + e.message;
      failed++;
    }
  }
}

/* ── Main ─────────────────────────────────────────────────────────────── */
(async () => {
  console.log(`\nEndorsements indexed: ${Object.keys(TOP_CLIP_BY_COMPANY).length} companies`);
  console.log(`Stories loaded: ${STORIES.length}`);
  console.log(`Tests defined: ${TESTS.length}`);

  if (MODE_LOCAL) await runLocal();
  if (MODE_LIVE)  await runLive();

  console.log('\n══════════════════════════════════════════════════');
  console.log(`SUMMARY: ${passed} passed  |  ${failed} failed  |  ${skipped} skipped`);
  console.log('══════════════════════════════════════════════════\n');
  if (failed > 0) process.exit(1);
})();
