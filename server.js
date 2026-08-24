/**
 * Beyond the Blueprints — Chat API proxy
 *
 * Exposes:
 *   GET  /health        → liveness check
 *   POST /v1/chat       → retrieval + watsonx.ai synthesis
 *
 * Required env vars:
 *   WATSONX_API_KEY     — IBM Cloud IAM API key (do NOT embed in source)
 *   WATSONX_PROJECT_ID  — watsonx.ai project ID
 *
 * Optional env vars:
 *   PORT                — default 8080
 *   WATSONX_URL         — default https://us-south.ml.cloud.ibm.com
 *   WATSONX_MODEL       — default ibm/granite-3-8b-instruct
 *   ALLOWED_ORIGINS     — comma-separated allowed CORS origins
 */

'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');

/* ── Config ──────────────────────────────────────────────────────────────── */
const PORT          = parseInt(process.env.PORT || '8080', 10);
const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').replace(/\/$/, '');
const WX_MODEL      = process.env.WATSONX_MODEL || 'ibm/granite-3-8b-instruct';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

/* ── Story corpus ─────────────────────────────────────────────────────────── */
// Support both layouts:
//   Render:      server.js and stories.json in the same directory
//   Code Engine: server.js in backend/, stories.json one level up
const STORIES_PATH = fs.existsSync(path.join(__dirname, 'stories.json'))
  ? path.join(__dirname, 'stories.json')
  : path.join(__dirname, '..', 'stories.json');
let STORIES = [];

try {
  STORIES = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));
} catch (e) {
  console.error('[btb] Could not load stories.json:', e.message);
}

/* ── Retrieval ────────────────────────────────────────────────────────────── */

/**
 * Score a story against the query using simple term-frequency overlap.
 * Returns a number ≥ 0; higher = more relevant.
 */
function scoreStory(story, terms) {
  const text = [
    story.company, story.title, story.industry, story.region,
    story.description, story.businessChallenge, story.businessOutcome,
    (story.products  || []).join(' '),
    (story.themes    || []).join(' '),
    (story.tags      || []).join(' '),
    (story.outcomes  || []).join(' '),
    (story.proofPoints || []).join(' '),
    (story.searchText || ''),
    (story.precisionSearchTerms || '')
  ].join(' ').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const hits = (text.match(rx) || []).length;
    score += hits;
  }
  return score;
}

/**
 * Retrieve the top-k most relevant stories for a query.
 * Also applies hard filters for industry/region if detected.
 */
function retrieveTopK(query, k) {
  const q     = query.toLowerCase();
  const terms = q.split(/\s+/).filter(t => t.length > 2);

  // Hard filters
  const regionFilter  = /\bemea\b/.test(q) ? 'EMEA'
                      : /\bamer\b/.test(q) ? 'AMER'
                      : /\bapac\b/.test(q) ? 'APAC'
                      : null;

  // Healthcare-specific: only stories where industry mentions healthcare/pharma/medical/health
  const healthcareQuery = /health(care)?|medical|pharma|clinical|hospital/i.test(query);
  const industryFilter  = healthcareQuery
    ? (s) => /health(care)?|medical|pharma|clinical|hospital/i.test(s.industry || '')
    : null;

  let candidates = STORIES.filter(s => {
    if (regionFilter && (s.region || '').toUpperCase() !== regionFilter) return false;
    if (industryFilter && !industryFilter(s)) return false;
    return true;
  });

  const scored = candidates.map(s => ({ story: s, score: scoreStory(s, terms) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).filter(s => s.score > 0).map(s => s.story);
}

/* ── Prompt builder ───────────────────────────────────────────────────────── */

function buildPrompt(query, topStories) {
  const storyCtx = topStories.map((s, i) => {
    const outcome  = (s.businessOutcome || (s.outcomes || []).join(' ') || '').slice(0, 300);
    const products = (s.products || []).slice(0, 4).join(', ');
    return `[S${i + 1}] ${s.company} (${s.industry}, ${s.region})\n` +
           `Products: ${products}\n` +
           `Challenge: ${(s.businessChallenge || s.description || '').slice(0, 220)}\n` +
           `Outcome: ${outcome}`;
  }).join('\n\n');

  return `You are the Beyond the Blueprints Explorer, an expert assistant for IBM customer stories.

The following customer stories are relevant to the question. Use ONLY these stories as your source.

${storyCtx}

User question: ${query}

Instructions:
- Write a direct, concise narrative answer (2–5 sentences, under 250 words).
- Cite each story with the tag [S1], [S2], etc. placed inline after each claim.
- Do not display search-result cards. Do not suggest visiting ChatGPT.
- Name specific companies and specific quantified outcomes where available.
- If no stories match, say so honestly in one sentence.
- Do not invent facts not present in the story summaries above.

Answer:`;
}

/* ── watsonx.ai call ─────────────────────────────────────────────────────── */

function callWatsonx(prompt) {
  return new Promise((resolve, reject) => {
    if (!WX_API_KEY || !WX_PROJECT_ID) {
      return reject(new Error('WATSONX_API_KEY / WATSONX_PROJECT_ID not configured'));
    }

    const body = JSON.stringify({
      model_id: WX_MODEL,
      input: prompt,
      parameters: {
        decoding_method: 'greedy',
        max_new_tokens: 500,
        min_new_tokens: 20,
        stop_sequences: [],
        repetition_penalty: 1.1
      },
      project_id: WX_PROJECT_ID
    });

    const endpoint = new url.URL(WX_URL + '/ml/v1/text/generation?version=2023-05-29');

    const options = {
      hostname: endpoint.hostname,
      path:     endpoint.pathname + endpoint.search,
      method:   'POST',
      headers:  {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${WX_API_KEY}`
      }
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          if (d.results && d.results[0] && d.results[0].generated_text) {
            resolve(d.results[0].generated_text.trim());
          } else {
            reject(new Error('Unexpected watsonx response: ' + raw.slice(0, 200)));
          }
        } catch (e) {
          reject(new Error('Invalid JSON from watsonx: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */

function corsHeaders(reqOrigin) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age':       '86400'
  };
}

function send(res, status, body, extra) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':   typeof body === 'string' ? 'text/plain' : 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extra
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/* ── Request router ───────────────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors   = corsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', cors);
  }

  // Health
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, {
      status:             'ok',
      story_count:        STORIES.length,
      watsonx_configured: Boolean(WX_API_KEY && WX_PROJECT_ID)
    }, cors);
  }

  // Chat
  if (req.method === 'POST' && req.url === '/v1/chat') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return send(res, 400, { error: 'Invalid request body' }, cors); }

    const query = (body.query || body.message || '').trim();
    if (!query) {
      return send(res, 400, { error: 'query is required' }, cors);
    }

    const topK   = Math.min(Math.max(parseInt(body.top_k || '5', 10), 1), 10);
    const topStories = retrieveTopK(query, topK);

    let answer;
    try {
      const prompt = buildPrompt(query, topStories);
      answer = await callWatsonx(prompt);
    } catch (err) {
      console.error('[btb] watsonx error:', err.message);
      // Graceful degradation: return plain narrative from local data
      if (topStories.length) {
        answer = topStories.map((s, i) =>
          `[S${i + 1}] ${s.company} (${s.industry}): ${(s.businessOutcome || s.description || '').slice(0, 200)}`
        ).join('\n');
      } else {
        answer = 'No stories matched that query in the library.';
      }
    }

    const sources = topStories.map((s, i) => ({
      ref:      `S${i + 1}`,
      company:  s.company,
      industry: s.industry,
      region:   s.region,
      url:      s.articleUrl || s.url || ''
    }));

    return send(res, 200, {
      answer,
      sources,
      answer_mode:     WX_API_KEY ? 'watsonx_grounded' : 'local_fallback',
      retrieval_mode:  'hybrid',
      story_count:     STORIES.length
    }, cors);
  }

  // 404
  send(res, 404, { error: 'Not found' }, cors);
});

server.listen(PORT, () => {
  console.log(`[btb] Chat API listening on :${PORT}`);
  console.log(`[btb] Stories loaded: ${STORIES.length}`);
  console.log(`[btb] watsonx configured: ${Boolean(WX_API_KEY && WX_PROJECT_ID)}`);
});
