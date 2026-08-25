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
    inputs:     [query]
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

/* ── Retrieval ────────────────────────────────────────────────────────────── */

// Stop-words excluded from keyword term matching
const STOP_WORDS = new Set([
  'the','and','are','for','with','that','this','have','from','they',
  'what','which','show','tell','best','stories','story','examples',
  'using','used','use','how','did','does','been','were','was','can',
  'our','their','its','ibm','all','any','some','more','most','into'
]);

// Domain synonym expansions: a query term maps to additional search terms
const DOMAIN_SYNONYMS = {
  'aml':             ['financial crime','anti-money laundering','fraud','compliance'],
  'financial crime': ['aml','anti-money laundering','fraud','fincrime','compliance','banking'],
  'fraud':           ['financial crime','aml','compliance','banking'],
  'mainframe':       ['mainframe','zos','z/os','cobol','legacy modernization','modernization'],
  'moderniz':        ['modernization','legacy','migration','mainframe','cobol'],
  'supply chain':    ['supply chain','logistics','procurement','inventory','warehouse'],
  'public sector':   ['government','public sector','federal','municipal','agency','civic'],
  'government':      ['government','public sector','federal','municipal','agency'],
  'video':           ['video','youtube','watch','film'],
  'cost':            ['cost reduction','savings','efficiency','reduced','lower cost','roi'],
  'time to value':   ['fast deployment','quick','rapid','weeks','days','time to value'],
  'hr':              ['hiring','recruitment','recruiter','talent','workforce','human resources'],
  'hiring':          ['recruitment','recruiter','talent','workforce','hr','human resources'],
  'recruitment':     ['hiring','recruiter','talent','workforce','hr'],
  'agriculture':     ['agriculture','farming','farm','crop','irrigation','agtech'],
  'retail':          ['retail','e-commerce','ecommerce','store','shop','fashion'],
  'customer experience': ['customer experience','customer care','cx','satisfaction','engagement'],
  'data governance': ['data governance','data quality','data lakehouse','data mesh','governed'],
  'agentic':    ['agentic ai','ai agent','agents','orchestrate','multi-agent','autonomous'],
  'agent':      ['agentic ai','ai agent','orchestrate','multi-agent','autonomous','workflow'],
  'automation': ['automation','workflow','orchestrate','rpa','process automation','efficiency'],
  'emea':       ['europe','uk','germany','france','norway','spain','emea','middle east','africa']
};

// Domain boost predicates — matching stories get a ×1.3 score multiplier.
// These are soft boosts, NOT hard gates: a story that scores well on both
// vector and keyword legs still surfaces even if it narrowly misses the regex.
const DOMAIN_BOOSTS = [
  { test: (q) => /\bemea\b/i.test(q),    boost: (s) => (s.region||'').toUpperCase() === 'EMEA' },
  { test: (q) => /\bamer\b/i.test(q),    boost: (s) => (s.region||'').toUpperCase() === 'AMER' },
  { test: (q) => /\bapac\b/i.test(q),    boost: (s) => (s.region||'').toUpperCase() === 'APAC' },
  { test: (q) => /health(care)?|medical|pharma|clinical|hospital/i.test(q),
    boost: (s) => /health(care)?|medical|pharma|clinical|hospital/i.test(s.industry||'') },
  { test: (q) => /\b(bank|financ|aml|fraud|financial crime|fincrime|insurance|wealth|asset manag)\b/i.test(q),
    boost: (s) => /financ|bank|insurance|fintech|wealth|capital|investment/i.test(s.industry||'') },
  { test: (q) => /\b(mainframe|zos|z\/os|cobol|legacy modern)\b/i.test(q),
    boost: (s) => /mainframe|zos|cobol|moderniz/i.test([s.industry,s.title,s.description,(s.themes||[]).join(' ')].join(' ')) },
  { test: (q) => /\b(public sector|government|federal|municipal|civic|agency)\b/i.test(q),
    boost: (s) => /government|public sector|federal|municipal|civic/i.test(s.industry||'') },
  { test: (q) => /\b(supply chain|logistics|procurement|inventory)\b/i.test(q),
    boost: (s) => /supply chain|logistics|manufacturing|retail/i.test(s.industry||'') },
  { test: (q) => /\bvideo(s)?\b|\bwatch\b|\bfilm\b|\bclip\b/i.test(q),
    boost: (s) => Boolean(s.videoUrl||s.customerVideoUrl||s.videoEmbedUrl) },
  { test: (q) => /\b(hr|human resources?|hir(e|ing)|recruit(ment|er|ing)?|talent acquisition|workforce)\b/i.test(q),
    boost: (s) => /\b(hr|human resources?|recruit|talent|hiring|workforce)\b/i.test([s.industry,s.title,s.description,(s.themes||[]).join(' ')].join(' ')) },
  { test: (q) => /\b(agri(culture)?|farm(ing)?|crop|irrigation|agtech)\b/i.test(q),
    boost: (s) => /agri(culture)?|farm|crop|irrigation|agtech/i.test(s.industry||'') },
  { test: (q) => /\b(retail|e-?commerce|shop(ping)?|fashion|store)\b/i.test(q),
    boost: (s) => /retail|e-?commerce|fashion|store/i.test(s.industry||'') },
  { test: (q) => /\b(legal|law|contract(s)?|compli(ance)?|litigation)\b/i.test(q),
    boost: (s) => /legal|law|contract|compli(ance)?/i.test([s.industry,s.title,s.description,(s.themes||[]).join(' ')].join(' ')) },
];

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

function scoreStory(story, terms) {
  const hasVideoTag = (story.videoUrl || story.customerVideoUrl || story.videoEmbedUrl)
    ? 'video watch film youtube customer video' : '';
  const textLow = [
    story.company, story.title, story.region,
    story.description, story.businessChallenge,
    (story.products || []).join(' '),
    (story.searchText || ''),
    hasVideoTag
  ].join(' ').toLowerCase();
  const textHigh = [
    story.industry,
    story.businessOutcome,
    (story.themes      || []).join(' '),
    (story.tags        || []).join(' '),
    (story.outcomes    || []).join(' '),
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
 * Unified hybrid retrieval.
 *
 * Algorithm:
 *   1. Vector leg  — embed query, score every corpus chunk, take best chunk
 *      score per story, normalise 0→1 across all stories.
 *   2. Keyword leg — TF-IDF overlap with synonym expansion, normalise 0→1.
 *   3. Combined    — 0.6 × vectorNorm + 0.4 × keywordNorm.
 *   4. Domain boost — stories matching region/industry get ×1.3 on combined.
 *   5. Relative threshold — keep only stories scoring ≥ 70% of the top score.
 *      Self-calibrates for every query: tight for specific queries, wider for
 *      broad ones. No magic constant to tune.
 *   6. Cap at k results, return matching corpus chunks for RAG context.
 *
 * Falls back to keyword-only when CORPUS is empty (e.g. cold start without
 * corpus.json) so the endpoint never goes dark.
 */
async function retrieveHybrid(query, k) {
  const q        = query.toLowerCase();
  const rawTerms = q.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
  const terms    = expandTerms(rawTerms, q);

  // Build a storyId → story map once
  const storyMap = {};
  STORIES.forEach(s => { storyMap[s.id] = s; });

  // ── Keyword leg ───────────────────────────────────────────────────────────
  const kwRaw = {};
  STORIES.forEach(s => { kwRaw[s.id] = scoreStory(s, terms); });
  // Use a reducer instead of spread to avoid NaN from sparse numeric keys
  const kwMax = STORIES.reduce((m, s) => Math.max(m, kwRaw[s.id] || 0), 1);
  const kwNorm = {};
  STORIES.forEach(s => { kwNorm[s.id] = (kwRaw[s.id] || 0) / kwMax; });

  // ── Vector leg (async) ────────────────────────────────────────────────────
  let vecNorm = null;
  let queryVec = null;
  if (CORPUS.length > 0) {
    queryVec = await embedQuery(query); // embedded once, reused below
    // Best chunk score per story — use a plain object with string keys
    const vecRaw = {};
    for (const chunk of CORPUS) {
      const key = String(chunk.storyId);
      const sim = cosineSimilarity(queryVec, chunk.embedding);
      if (vecRaw[key] === undefined || sim > vecRaw[key]) {
        vecRaw[key] = sim;
      }
    }
    // Reduce over STORIES to avoid sparse-key NaN from Math.max spread
    const vecMax = STORIES.reduce((m, s) => Math.max(m, vecRaw[String(s.id)] || 0), 1e-10);
    vecNorm = {};
    STORIES.forEach(s => { vecNorm[s.id] = (vecRaw[String(s.id)] || 0) / vecMax; });
  }

  // ── Combine ───────────────────────────────────────────────────────────────
  const ALPHA = vecNorm ? 0.6 : 0.0; // pure keyword if no corpus
  const activeBoosts = DOMAIN_BOOSTS.filter(b => b.test(query));

  const combined = STORIES.map(s => {
    const vec = vecNorm ? vecNorm[s.id] || 0 : 0;
    const kw  = kwNorm[s.id] || 0;
    let score = ALPHA * vec + (1 - ALPHA) * kw;
    // Apply domain boosts as a multiplier (soft — doesn't exclude anything)
    if (activeBoosts.some(b => b.boost(s))) score *= 1.3;
    return { story: s, score };
  });
  combined.sort((a, b) => b.score - a.score);

  // ── Relative threshold ────────────────────────────────────────────────────
  // Keep stories scoring ≥ 70% of the best score. Self-calibrates: a tight
  // query produces a high top score and a narrow band; a broad query produces
  // a lower top score and a naturally wider band — no manual tuning needed.
  const topScore = combined[0] ? combined[0].score : 0;
  const threshold = topScore * 0.70;
  // Also require at least a minimal absolute signal so zero-match queries
  // still return nothing rather than the least-bad story.
  const MIN_ABSOLUTE = 0.05;

  const topStories = combined
    .filter(({ score }) => score >= threshold && score >= MIN_ABSOLUTE)
    .slice(0, k)
    .map(({ story }) => story);

  if (topStories.length === 0) return { chunks: [], stories: [] };

  // ── Pull matching corpus chunks for RAG context ───────────────────────────
  let topChunks = [];
  if (CORPUS.length > 0 && vecNorm && queryVec) {
    const allowedIds = new Set(topStories.map(s => s.id));
    const chunkScored = CORPUS
      .filter(c => allowedIds.has(c.storyId))
      .map(c => ({ chunk: c, score: cosineSimilarity(queryVec, c.embedding) }));
    chunkScored.sort((a, b) => b.score - a.score);
    // Max 2 chunks per story
    const chunkCounts = {};
    for (const { chunk, score } of chunkScored) {
      chunkCounts[chunk.storyId] = (chunkCounts[chunk.storyId] || 0) + 1;
      if (chunkCounts[chunk.storyId] <= 2) topChunks.push({ chunk, score });
    }
  }

  return { chunks: topChunks, stories: topStories };
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
      corpus_chunks:      CORPUS.length,
      retrieval_mode:     CORPUS.length > 0 ? 'rag_vector' : 'keyword',
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

  // Debug retrieval — embeds a query and returns raw chunk scores (no LLM call)
  if (req.method === 'GET' && req.url.startsWith('/debug-retrieval')) {
    const parsedUrl = new url.URL(req.url, 'http://localhost');
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    if (!q) return send(res, 400, { error: 'q param required' }, cors);
    if (CORPUS.length === 0) return send(res, 503, { error: 'corpus not loaded' }, cors);
    try {
      const queryVec = await embedQuery(q);
      const scored = CORPUS.map(chunk => ({
        storyId: chunk.storyId,
        company: chunk.company,
        score:   parseFloat(cosineSimilarity(queryVec, chunk.embedding).toFixed(4))
      }));
      scored.sort((a, b) => b.score - a.score);
      return send(res, 200, { query: q, top20: scored.slice(0, 20) }, cors);
    } catch (e) {
      return send(res, 500, { error: e.message }, cors);
    }
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

    const topK = Math.min(Math.max(parseInt(body.top_k || '3', 10), 1), 10);

    // ── Hybrid retrieval (vector + keyword combined) ───────────────────────
    let topStories, topChunks, retrievalMode;
    try {
      const result  = await retrieveHybrid(query, topK);
      topChunks     = result.chunks;
      topStories    = result.stories;
      retrievalMode = CORPUS.length > 0 ? 'hybrid' : 'keyword';
    } catch (err) {
      console.error('[btb] retrieveHybrid failed:', err.stack || err.message);
      topStories    = [];
      topChunks     = [];
      retrievalMode = 'error';
      // Surface the error in the response so it's diagnosable without log access
      return send(res, 200, {
        answer:         "I ran into a retrieval error — please try again in a moment.",
        sources:        [],
        answer_mode:    'retrieval_error',
        retrieval_mode: 'error',
        retrieval_error: err.message,
        story_count:    STORIES.length
      }, cors);
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
      // The LLM sometimes echoes the seed prefix back — strip it if present
      const seedLower = seed.toLowerCase();
      const genLower  = generated.toLowerCase();
      const cleanGenerated = genLower.startsWith(seedLower)
        ? generated.slice(seed.length).replace(/^\s+/, '')
        : generated;
      answer      = seed + ' ' + cleanGenerated;
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
