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

/* ── RAG vector corpus (optional — built by build-corpus.js) ──────────────── */
const CORPUS_PATH = fs.existsSync(path.join(__dirname, 'corpus.json'))
  ? path.join(__dirname, 'corpus.json')
  : null;
let CORPUS = [];   // array of { storyId, company, title, chunkIndex, text, embedding }

if (CORPUS_PATH) {
  try {
    CORPUS = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
    console.log(`[btb] RAG corpus loaded: ${CORPUS.length} chunks from full blog text.`);
  } catch (e) {
    console.error('[btb] Could not load corpus.json — falling back to keyword search:', e.message);
  }
} else {
  console.log('[btb] No corpus.json found — using keyword search only.');
}

/* ── Vector helpers ───────────────────────────────────────────────────────── */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

async function embedQuery(query) {
  const iamToken = await getIamToken();
  const EMBED_MODEL = process.env.EMBED_MODEL || 'ibm/slate-125m-english-rtrvr-v2';
  const body = JSON.stringify({
    model_id:   EMBED_MODEL,
    project_id: WX_PROJECT_ID,
    inputs:     [{ text: query }]
  });
  return new Promise((resolve, reject) => {
    const endpoint = new url.URL(WX_URL + '/ml/v1/text/embeddings?version=2024-03-14');
    const options  = {
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
          if (d.results && d.results[0]) resolve(d.results[0].embedding);
          else reject(new Error('Embed error: ' + raw.slice(0, 300)));
        } catch (e) { reject(new Error('Embed JSON parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * RAG retrieval: embed the query, score all corpus chunks by cosine similarity,
 * deduplicate to top-K unique stories, return { chunks, stories }.
 */
async function retrieveByVector(query, k) {
  const queryVec = await embedQuery(query);

  // Score every chunk
  const scored = CORPUS.map(chunk => ({
    chunk,
    score: cosineSimilarity(queryVec, chunk.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);

  // Collect top chunks, deduplicating by storyId (max 2 chunks per story)
  const chunkCounts = {};
  const topChunks   = [];
  const seenStories = new Set();

  for (const { chunk, score } of scored) {
    if (topChunks.length >= k * 3) break; // gather enough for dedup
    const key = chunk.storyId;
    chunkCounts[key] = (chunkCounts[key] || 0) + 1;
    if (chunkCounts[key] <= 2) {
      topChunks.push({ chunk, score });
      seenStories.add(key);
    }
    if (seenStories.size >= k) break;
  }

  // Map back to story metadata from STORIES array for source cards
  const storyMap = {};
  STORIES.forEach(s => { storyMap[s.id] = s; });

  const stories = [...seenStories]
    .map(id => storyMap[id])
    .filter(Boolean);

  return { chunks: topChunks, stories };
}

/* ── Retrieval ────────────────────────────────────────────────────────────── */

// Stop-words excluded from TF-IDF term matching
const STOP_WORDS = new Set([
  'the','and','are','for','with','that','this','have','from','they',
  'what','which','show','tell','best','stories','story','examples',
  'using','used','use','how','did','does','been','were','was','can',
  'our','their','its','ibm','all','any','some','more','most','into'
]);

// Domain synonym expansions: a query term maps to additional search terms
const DOMAIN_SYNONYMS = {
  'aml':         ['financial crime','anti-money laundering','fraud','compliance'],
  'financial crime': ['aml','anti-money laundering','fraud','fincrime','compliance','banking'],
  'fraud':       ['financial crime','aml','compliance','banking'],
  'mainframe':   ['mainframe','zos','z/os','cobol','legacy modernization','modernization'],
  'moderniz':    ['modernization','legacy','migration','mainframe','cobol'],
  'supply chain':['supply chain','logistics','procurement','inventory','warehouse'],
  'public sector':['government','public sector','federal','municipal','agency','civic'],
  'government':  ['government','public sector','federal','municipal','agency'],
  'video':       ['video','youtube','watch','film'],
  'cost':        ['cost reduction','savings','efficiency','reduced','lower cost','roi'],
  'time to value':['fast deployment','quick','rapid','weeks','days','time to value'],
  'hr':          ['hiring','recruitment','recruiter','talent','workforce','human resources'],
  'hiring':      ['recruitment','recruiter','talent','workforce','hr','human resources'],
  'recruitment': ['hiring','recruiter','talent','workforce','hr'],
  'agriculture': ['agriculture','farming','farm','crop','irrigation','agtech'],
  'retail':      ['retail','e-commerce','ecommerce','store','shop','fashion'],
  'customer experience': ['customer experience','customer care','cx','satisfaction','engagement'],
  'data governance': ['data governance','data quality','data lakehouse','data mesh','governed']
};

/**
 * Expand query terms using domain synonyms.
 * Returns the original terms plus any synonym expansions.
 */
function expandTerms(terms, rawQuery) {
  const expanded = new Set(terms);
  const q = rawQuery.toLowerCase();
  for (const [trigger, synonyms] of Object.entries(DOMAIN_SYNONYMS)) {
    if (q.includes(trigger)) {
      synonyms.forEach(s => s.split(' ').forEach(w => { if (w.length > 2) expanded.add(w); }));
    }
  }
  return [...expanded];
}

/**
 * Score a story against query terms using weighted TF overlap.
 * High-signal fields (industry, themes, outcomes) get a 2× weight boost.
 */
function scoreStory(story, terms) {
  // Synthesize a virtual "has video" tag so video queries can match
  const hasVideoTag = (story.videoUrl || story.customerVideoUrl || story.videoEmbedUrl)
    ? 'video watch film youtube customer video'
    : '';

  // Low-weight fields (1×)
  const textLow = [
    story.company, story.title, story.region,
    story.description, story.businessChallenge,
    (story.products || []).join(' '),
    (story.searchText || ''),
    hasVideoTag
  ].join(' ').toLowerCase();

  // High-weight fields (3×) — more domain-specific
  const textHigh = [
    story.industry,
    story.businessOutcome,
    (story.themes    || []).join(' '),
    (story.tags      || []).join(' '),
    (story.outcomes  || []).join(' '),
    (story.proofPoints || []).join(' '),
    (story.precisionSearchTerms || '')
  ].join(' ').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (!term || STOP_WORDS.has(term)) continue;
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    score += ((textLow.match(rx)  || []).length) * 1;
    score += ((textHigh.match(rx) || []).length) * 3;
  }
  return score;
}

/**
 * Retrieve the top-k most relevant stories for a query.
 * Applies hard industry/region filters and a minimum score threshold
 * so low-relevance stories never reach the LLM.
 */
function retrieveTopK(query, k) {
  const q     = query.toLowerCase();
  const rawTerms = q.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
  const terms    = expandTerms(rawTerms, q);

  // ── Hard region filter ───────────────────────────────────────────────────
  const regionFilter = /\bemea\b/.test(q) ? 'EMEA'
                     : /\bamer\b/.test(q) ? 'AMER'
                     : /\bapac\b/.test(q) ? 'APAC'
                     : null;

  // ── Hard industry / content filters ──────────────────────────────────────
  // Healthcare: industry must START with healthcare/pharma/medical/health
  const healthcareQuery = /health(care)?|medical|pharma|clinical|hospital/i.test(query);
  const financeQuery    = /\b(bank|financ|aml|fraud|financial crime|anti.money|fincrime|insurance|wealth|asset manag)\b/i.test(query);
  const mainframeQuery  = /\b(mainframe|zos|z\/os|cobol|legacy modern)\b/i.test(query);
  const publicQuery     = /\b(public sector|government|federal|municipal|civic|agency)\b/i.test(query);
  const supplyQuery     = /\b(supply chain|logistics|procurement|inventory)\b/i.test(query);
  const videoQuery      = /\bvideo(s)?\b|\bwatch\b|\bfilm\b|\bclip\b/i.test(query);
  const hrQuery         = /\b(hr|human resources?|hir(e|ing)|recruit(ment|er|ing)?|talent acquisition|workforce)\b/i.test(query);
  const agriQuery       = /\b(agri(culture)?|farm(ing)?|crop|irrigation|agtech)\b/i.test(query);
  const retailQuery     = /\b(retail|e-?commerce|shop(ping)?|fashion|store)\b/i.test(query);
  const legalQuery      = /\b(legal|law|contract(s)?|compli(ance)?|litigation)\b/i.test(query);

  const industryFilter =
    healthcareQuery ? (s) => /^(health(care)?|medical|pharma|clinical|hospital)/i.test((s.industry || '').trim())
  : financeQuery    ? (s) => /financ|bank|insurance|fintech|wealth|capital|investment/i.test(s.industry || '')
  : mainframeQuery  ? (s) => /mainframe|zos|cobol|moderniz/i.test([s.industry, s.title, s.description, (s.themes||[]).join(' ')].join(' '))
  : publicQuery     ? (s) => /government|public sector|federal|municipal|civic/i.test(s.industry || '')
  : supplyQuery     ? (s) => /supply chain|logistics|manufacturing|retail/i.test(s.industry || '')
  : videoQuery      ? (s) => Boolean(s.videoUrl || s.customerVideoUrl || s.videoEmbedUrl)
  : hrQuery         ? (s) => /\b(hr|human resources?|recruit|talent|hiring|workforce)\b/i.test([s.industry, s.title, s.description, (s.themes||[]).join(' ')].join(' '))
  : agriQuery       ? (s) => /agri(culture)?|farm|crop|irrigation|agtech/i.test(s.industry || '')
  : retailQuery     ? (s) => /retail|e-?commerce|fashion|store/i.test(s.industry || '')
  : legalQuery      ? (s) => /legal|law|contract|compli(ance)?/i.test([s.industry, s.title, s.description, (s.themes||[]).join(' ')].join(' '))
  : null;

  let candidates = STORIES.filter(s => {
    if (regionFilter && (s.region || '').toUpperCase() !== regionFilter) return false;
    if (industryFilter && !industryFilter(s)) return false;
    return true;
  });

  const scored = candidates.map(s => ({ story: s, score: scoreStory(s, terms) }));
  scored.sort((a, b) => b.score - a.score);

  // Minimum score threshold: story must score at least 2 to be included.
  // This prevents low-relevance stories being passed to the LLM when the
  // query topic doesn't appear in the corpus.
  const MIN_SCORE = 2;
  return scored.slice(0, k).filter(s => s.score >= MIN_SCORE).map(s => s.story);
}

/* ── Prompt builder ───────────────────────────────────────────────────────── */

function buildMessages(query, topStories) {
  const storyCtx = topStories.map((s, i) => {
    const outcome   = (s.businessOutcome || '').slice(0, 300);
    const metrics   = (s.outcomes || []).slice(0, 6).map(m => `- ${m}`).join('\n');
    const products  = (s.products || []).slice(0, 4).join(', ');
    const videoUrl  = s.videoUrl || s.customerVideoUrl || s.videoEmbedUrl || '';
    const videoLine = videoUrl ? `\nVideo: ${videoUrl}` : '';
    const metricsLine = metrics ? `\nMetrics:\n${metrics}` : '';
    return `REF=${i + 1} | ${s.company} | ${s.industry} | ${s.region}\nProducts: ${products}\nOutcome: ${outcome}${metricsLine}${videoLine}`;
  }).join('\n---\n');

  // Build a natural-sounding seed: "A [S1] and B [S2]" for 2 stories,
  // "A [S1], B [S2], and C [S3]" for 3+, plain "The stories" for 0.
  let companySeed;
  if (!topStories.length) {
    companySeed = 'The stories';
  } else if (topStories.length === 1) {
    companySeed = `${topStories[0].company} [S1]`;
  } else if (topStories.length === 2) {
    companySeed = `${topStories[0].company} [S1] and ${topStories[1].company} [S2]`;
  } else {
    const parts = topStories.slice(0, -1).map((s, i) => `${s.company} [S${i + 1}]`).join(', ');
    const last  = topStories[topStories.length - 1];
    companySeed = `${parts}, and ${last.company} [S${topStories.length}]`;
  }

  return [
    {
      role: 'system',
      content:
        'You are an IBM customer story analyst. ' +
        'Answer ONLY using the story data provided — every story given to you is relevant. ' +
        'Write a single flowing paragraph (3-5 sentences, under 200 words) that directly answers the question. ' +
        'Cite each story immediately after the relevant claim using [S1], [S2] etc. ' +
        'Do NOT list or bullet-point. Do NOT invent details not in the story data. ' +
        'Do NOT qualify, rank, or comment on how relevant individual stories are to the question. ' +
        'Do NOT add concluding meta-commentary — end on a concrete outcome or insight. ' +
        'Write only the answer paragraph, nothing else.'
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

/* ── RAG prompt builder (uses full blog chunks instead of JSON fields) ─────── */
function buildRagMessages(query, topChunks, companySeed) {
  // Combine the most relevant chunk text per story into context blocks
  const seenStory = {};
  const contextBlocks = [];
  for (const { chunk } of topChunks) {
    if (!seenStory[chunk.storyId]) {
      seenStory[chunk.storyId] = [];
      contextBlocks.push({ id: chunk.storyId, company: chunk.company, title: chunk.title, texts: [] });
    }
    seenStory[chunk.storyId].push(chunk.text);
  }
  // Merge texts back
  const storyCtx = contextBlocks.map((b, i) => {
    b.texts = seenStory[b.id];
    return `REF=${i + 1} | ${b.company}\nTitle: ${b.title}\n---\n${b.texts.join('\n\n').slice(0, 1800)}`;
  }).join('\n\n════════════════════\n\n');

  return [
    {
      role: 'system',
      content:
        'You are an IBM customer story analyst. ' +
        'Answer ONLY using the story excerpts provided — every excerpt given to you is relevant. ' +
        'Write a single flowing paragraph (3-5 sentences, under 220 words) that directly answers the question. ' +
        'Cite each story immediately after the relevant claim using [S1], [S2] etc. ' +
        'Include specific numbers, percentages or metrics from the excerpts whenever they are present. ' +
        'Do NOT list or bullet-point. Do NOT invent details not in the excerpts. ' +
        'Do NOT qualify, rank, or comment on how relevant individual stories are to the question. ' +
        'Do NOT add concluding meta-commentary — end on a concrete outcome or insight. ' +
        'Write only the answer paragraph, nothing else.'
    },
    {
      role: 'user',
      content: `Story excerpts from full IBM blog posts:\n\n${storyCtx}\n\nQuestion: ${query}`
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

    const topK = Math.min(Math.max(parseInt(body.top_k || '5', 10), 1), 10);

    // ── Retrieval: use RAG (vector) if corpus is loaded, else keyword ─────────
    let topStories, topChunks, retrievalMode;

    if (CORPUS.length > 0) {
      try {
        const ragResult = await retrieveByVector(query, topK);
        topChunks    = ragResult.chunks;
        topStories   = ragResult.stories;
        retrievalMode = 'rag_vector';
      } catch (err) {
        console.warn('[btb] Vector retrieval failed, falling back to keyword:', err.message);
        topStories    = retrieveTopK(query, topK);
        topChunks     = null;
        retrievalMode = 'keyword_fallback';
      }
    } else {
      topStories    = retrieveTopK(query, topK);
      topChunks     = null;
      retrievalMode = 'keyword';
    }

    // Short-circuit: no stories passed the relevance threshold
    if (!topStories.length) {
      return send(res, 200, {
        answer:         "I couldn't find IBM customer stories in the library that specifically cover that topic. Try rephrasing — for example, ask about an industry (healthcare, financial services), a product (watsonx.data, watsonx Orchestrate), or a theme (agentic AI, cost reduction, modernisation).",
        sources:        [],
        answer_mode:    'no_match',
        retrieval_mode: retrievalMode,
        story_count:    STORIES.length
      }, cors);
    }

    // Build company seed for assistant prefix
    let companySeed;
    if (!topStories.length) {
      companySeed = 'The stories';
    } else if (topStories.length === 1) {
      companySeed = `${topStories[0].company} [S1]`;
    } else if (topStories.length === 2) {
      companySeed = `${topStories[0].company} [S1] and ${topStories[1].company} [S2]`;
    } else {
      const parts = topStories.slice(0, -1).map((s, i) => `${s.company} [S${i + 1}]`).join(', ');
      const last  = topStories[topStories.length - 1];
      companySeed = `${parts}, and ${last.company} [S${topStories.length}]`;
    }

    let answer;
    let usedWatsonx = false;
    let wxError     = null;

    try {
      // Use RAG prompt if we have chunks, otherwise fall back to JSON-fields prompt
      const messages = topChunks
        ? buildRagMessages(query, topChunks, companySeed)
        : buildMessages(query, topStories);
      const seed      = messages[messages.length - 1].content;
      const generated = await callWatsonx(messages);
      answer      = seed + ' ' + generated;
      usedWatsonx = true;
    } catch (err) {
      wxError = err.message;
      console.error('[btb] watsonx error:', err.message);
      answer = topStories.map((s, i) =>
        `[S${i + 1}] ${s.company} (${s.industry}): ${(s.businessOutcome || s.description || '').slice(0, 200)}`
      ).join('\n');
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
      retrieval_mode: retrievalMode,
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
  console.log(`[btb] RAG corpus: ${CORPUS.length > 0 ? CORPUS.length + ' chunks' : 'not loaded (keyword mode)'}`);
  console.log(`[btb] watsonx configured: ${Boolean(WX_API_KEY && WX_PROJECT_ID)}`);
  console.log(`[btb] Model: ${WX_MODEL}`);
  console.log(`[btb] URL: ${WX_URL}`);
});
