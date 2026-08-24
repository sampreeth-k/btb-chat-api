/**
 * Beyond the Blueprints — Chat API proxy
 *
 * Exposes:
 *   GET  /health        → liveness check
 *   GET  /debug-auth    → tests IAM token exchange and watsonx connectivity (no key revealed)
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
 *
 * Auth: exchanges the API key for an IAM bearer token (cached, refreshed 5 min before expiry).
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

/* ── IAM token cache ─────────────────────────────────────────────────────── */
let _iamToken = null;
let _iamExpiry = 0;

function getIamToken() {
  // Return cached token if it has more than 5 minutes left
  if (_iamToken && Date.now() < _iamExpiry - 300000) {
    return Promise.resolve(_iamToken);
  }
  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(WX_API_KEY)}`;
    const options = {
      hostname: 'iam.cloud.ibm.com',
      path:     '/identity/token',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          if (d.access_token) {
            _iamToken  = d.access_token;
            _iamExpiry = Date.now() + (d.expires_in || 3600) * 1000;
            resolve(_iamToken);
          } else {
            reject(new Error('IAM_ERROR:' + raw.slice(0, 400)));
          }
        } catch (e) {
          reject(new Error('IAM_JSON_PARSE:' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', e => reject(new Error('IAM_CONNECT:' + e.message)));
    req.write(body);
    req.end();
  });
}

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

function buildMessages(query, topStories) {
  const storyCtx = topStories.map((s, i) => {
    const outcome  = (s.businessOutcome || (s.outcomes || []).join(' ') || '').slice(0, 300);
    const products = (s.products || []).slice(0, 4).join(', ');
    return `REF=${i + 1} | ${s.company} | ${s.industry} | ${s.region}\nProducts: ${products}\nOutcome: ${outcome}`;
  }).join('\n---\n');

  const companySeed = topStories.length
    ? topStories.map((s, i) => `${s.company} [S${i + 1}]`).join(' and ') + ' both'
    : 'The stories';

  return [
    {
      role: 'system',
      content:
        'You are an IBM customer story analyst. ' +
        'When given story data and a question, write a single flowing paragraph (3-5 sentences, under 200 words) that directly answers the question. ' +
        'Cite each story by placing [S1], [S2] etc. immediately after the relevant claim. ' +
        'Do NOT list or bullet. Do NOT echo the source data. Write only the answer paragraph.'
    },
    {
      role: 'user',
      content:
        `Story data:\n${storyCtx}\n\n` +
        `Question: ${query}`
    },
    {
      role: 'assistant',
      content: companySeed + ' demonstrate'
    }
  ];
}

/* ── watsonx.ai call (chat completions endpoint) ─────────────────────────── */

async function callWatsonx(messages) {
  if (!WX_API_KEY || !WX_PROJECT_ID) {
    throw new Error('WATSONX_API_KEY / WATSONX_PROJECT_ID not configured');
  }

  const iamToken = await getIamToken();

  const body = JSON.stringify({
    model_id: WX_MODEL,
    messages,
    parameters: { max_new_tokens: 400, temperature: 0.3 },
    project_id: WX_PROJECT_ID
  });

  return new Promise((resolve, reject) => {
    const endpoint = new url.URL(WX_URL + '/ml/v1/text/chat?version=2023-05-29');
    const options = {
      hostname: endpoint.hostname,
      path:     endpoint.pathname + endpoint.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization':  `Bearer ${iamToken}`
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          const text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
          if (text) {
            resolve(text.trim());
          } else {
            reject(new Error('WX_RESPONSE:' + raw.slice(0, 400)));
          }
        } catch (e) {
          reject(new Error('WX_JSON_PARSE:' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', e => reject(new Error('WX_CONNECT:' + e.message)));
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
      watsonx_configured: Boolean(WX_API_KEY && WX_PROJECT_ID),
      model:              WX_MODEL,
      wx_url:             WX_URL
    }, cors);
  }

  // Debug auth — tests IAM + a minimal watsonx ping without revealing the key
  if (req.method === 'GET' && req.url === '/debug-auth') {
    const result = {
      key_set:       Boolean(WX_API_KEY),
      key_prefix:    WX_API_KEY ? WX_API_KEY.slice(0, 6) + '…' : '(none)',
      project_set:   Boolean(WX_PROJECT_ID),
      project_prefix: WX_PROJECT_ID ? WX_PROJECT_ID.slice(0, 8) + '…' : '(none)',
      wx_url:        WX_URL,
      model:         WX_MODEL
    };
    try {
      const tok = await getIamToken();
      result.iam_ok = true;
      result.token_prefix = tok.slice(0, 20) + '…';
    } catch (e) {
      result.iam_ok = false;
      result.iam_error = e.message;
    }

    if (result.iam_ok) {
      // Quick ping: try a minimal chat request with 1 token
      try {
        const tok = await getIamToken();
        const pingBody = JSON.stringify({
          model_id: WX_MODEL,
          messages: [
            { role: 'user', content: 'Say OK' }
          ],
          parameters: { max_new_tokens: 5 },
          project_id: WX_PROJECT_ID
        });
        await new Promise((resolve, reject) => {
          const endpoint = new url.URL(WX_URL + '/ml/v1/text/chat?version=2023-05-29');
          const opts = {
            hostname: endpoint.hostname,
            path:     endpoint.pathname + endpoint.search,
            method:   'POST',
            headers:  {
              'Content-Type':   'application/json',
              'Content-Length': Buffer.byteLength(pingBody),
              'Authorization':  `Bearer ${tok}`
            }
          };
          const r = https.request(opts, resp => {
            let raw = '';
            resp.on('data', c => { raw += c; });
            resp.on('end', () => {
              try {
                const d = JSON.parse(raw);
                if (d.choices && d.choices[0]) {
                  result.wx_ping_ok = true;
                  result.wx_ping_reply = (d.choices[0].message || {}).content || '(empty)';
                } else {
                  result.wx_ping_ok = false;
                  result.wx_ping_error = raw.slice(0, 400);
                }
              } catch (e) {
                result.wx_ping_ok = false;
                result.wx_ping_error = 'JSON parse: ' + raw.slice(0, 200);
              }
              resolve();
            });
          });
          r.on('error', e => { result.wx_ping_ok = false; result.wx_ping_error = 'connect: ' + e.message; resolve(); });
          r.write(pingBody);
          r.end();
        });
      } catch (e) {
        result.wx_ping_ok = false;
        result.wx_ping_error = e.message;
      }
    }

    return send(res, 200, result, cors);
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

    const topK       = Math.min(Math.max(parseInt(body.top_k || '5', 10), 1), 10);
    const topStories = retrieveTopK(query, topK);

    let answer;
    let usedWatsonx = false;
    let wxError     = null;

    try {
      const messages  = buildMessages(query, topStories);
      // The last message is the seeded assistant prefix — extract it separately
      const seed      = messages[messages.length - 1].content;
      const generated = await callWatsonx(messages);
      // generated already continues from the seed because of the seeded assistant turn;
      // prepend the seed so the answer reads as a full sentence.
      answer      = seed + ' ' + generated;
      usedWatsonx = true;
    } catch (err) {
      wxError = err.message;
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

    const resp = {
      answer,
      sources,
      answer_mode:    usedWatsonx ? 'watsonx_grounded' : 'local_fallback',
      retrieval_mode: 'hybrid',
      story_count:    STORIES.length
    };
    if (wxError) resp.wx_error = wxError;

    return send(res, 200, resp, cors);
  }

  // 404
  send(res, 404, { error: 'Not found' }, cors);
});

server.listen(PORT, () => {
  console.log(`[btb] Chat API listening on :${PORT}`);
  console.log(`[btb] Stories loaded: ${STORIES.length}`);
  console.log(`[btb] watsonx configured: ${Boolean(WX_API_KEY && WX_PROJECT_ID)}`);
  console.log(`[btb] Model: ${WX_MODEL}`);
  console.log(`[btb] URL: ${WX_URL}`);
});
