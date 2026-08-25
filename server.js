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
const { makeCitKey, resolveCitations } = require('./lib/citations');

/* ── Config ──────────────────────────────────────────────────────────────── */
const PORT          = parseInt(process.env.PORT || '8080', 10);
const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').replace(/\/$/, '');
// Default to the current production model. granite-3-8b-instruct was deprecated
// Nov 2025 — if the env var is absent a cold redeploy would regress to a
// deprecated model. Default to llama-3-3-70b-instruct to match the live service.
const WX_MODEL      = process.env.WATSONX_MODEL || 'meta-llama/llama-3-3-70b-instruct';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
// Git commit SHA — injected at build/deploy time via GIT_COMMIT env var.
// Surfaced in /health so the running image can be matched to its source commit.
const GIT_COMMIT    = process.env.GIT_COMMIT || 'unknown';

/* ── Abuse-prevention constants ──────────────────────────────────────────── */
// Max request-body size (bytes). Prevents memory exhaustion from oversized payloads.
const MAX_BODY_BYTES  = 8 * 1024;   // 8 KB — well above any legitimate query
// Max query length (characters). Limits token cost and prompt-injection surface.
const MAX_QUERY_CHARS = 500;
// Upstream request timeout (ms) — applied to IAM exchange, embedding, and
// watsonx chat. Prevents any outbound call hanging indefinitely.
const WX_TIMEOUT_MS   = 30_000;
// In-process rate limit: max requests per IP per fixed one-minute window.
// KNOWN LIMITATIONS (acceptable for single-instance demo; not production-grade):
//   - Fixed window (not sliding): up to 2× burst allowed at window boundary.
//   - In-process only: resets on restart/redeploy, not shared across instances.
//   - Relies on x-forwarded-for header which can be spoofed on unmanaged infra.
//   - _rateCounts map grows unbounded; old entries are only expired on next hit.
// For production scale, use Render's gateway rate-limiting or a CDN WAF rule.
const RATE_LIMIT_RPM  = 30;
const _rateCounts     = {};         // { ip: { count, windowStart } }

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
    // Timeout on IAM exchange — prevents hung token refresh blocking all requests
    req.setTimeout(WX_TIMEOUT_MS, () => { req.destroy(); reject(new Error('IAM_TIMEOUT')); });
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
      let bytes = 0;
      res.on('data', c => {
        bytes += c.length;
        // Guard against unexpectedly large embedding responses
        if (bytes > 2 * 1024 * 1024) { req.destroy(); return reject(new Error('EMBED_RESPONSE_TOO_LARGE')); }
        raw += c;
      });
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          if (d.results && d.results[0]) resolve(d.results[0].embedding);
          else reject(new Error('Embed error: ' + raw.slice(0, 300)));
        } catch (e) { reject(new Error('Embed JSON parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    // Timeout on embedding request — every RAG query embeds; a hung call
    // would leave the entire chat request hanging indefinitely without this.
    req.setTimeout(WX_TIMEOUT_MS, () => { req.destroy(); reject(new Error('EMBED_TIMEOUT')); });
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

// Notable-brand story IDs — boosted when a query asks for well-known or
// recognizable brand names. These are household / government names that should
// surface ahead of lesser-known startups for "famous brand" type queries.
const NOTABLE_BRAND_IDS = new Set([
  25,  // US Open / USTA
  47,  // California DMV
   5,  // AXA Brazil
  // Add more ids here as the corpus grows
]);

// Domain boost predicates — matching stories get a ×1.3 score multiplier.
// These are soft boosts, NOT hard gates: a story that scores well on both
// vector and keyword legs still surfaces even if it narrowly misses the regex.
const DOMAIN_BOOSTS = [
  // ── Region boosts: acronym OR country name ─────────────────────────────
  { test: (q) => /\bemea\b|(?:^|\s)(europe|uk|germany|france|norway|spain|netherlands|sweden|south africa|ireland|israel|italy|portugal)\b/i.test(q),
    boost: (s) => (s.region||'').toUpperCase() === 'EMEA' },
  { test: (q) => /\bamer\b|(?:^|\s)(united states|usa|us\b|canada|brazil|mexico|latin america|peru|argentina|colombia)\b/i.test(q),
    boost: (s) => (s.region||'').toUpperCase() === 'AMER' },
  { test: (q) => /\bapac\b|(?:^|\s)(australia|india|japan|singapore|china|new zealand|hong kong|south korea)\b/i.test(q),
    boost: (s) => (s.region||'').toUpperCase() === 'APAC' },
  // ── Well-known / notable brands ────────────────────────────────────────
  { test: (q) => /well.?known|famous|recogni(s|z)able|major brand|household name|global brand|iconic/i.test(q),
    boost: (s) => NOTABLE_BRAND_IDS.has(s.id) },
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

  // Separate region boosts from industry boosts so region only amplifies when
  // no industry signal is present — prevents EMEA boost pulling a venue story
  // into a financial services result set.
  const REGION_BOOST_TESTS = [/\bemea\b/i, /\bamer\b/i, /\bapac\b/i];
  const industryBoostsActive = DOMAIN_BOOSTS
    .filter(b => !REGION_BOOST_TESTS.some(rx => rx.test(b.test.toString())))
    .some(b => b.test(query));
  const activeBoosts = DOMAIN_BOOSTS.filter(b => {
    const isRegionBoost = REGION_BOOST_TESTS.some(rx => rx.test(b.test.toString()));
    // Suppress region boost when an industry boost is already active
    if (isRegionBoost && industryBoostsActive) return false;
    return b.test(query);
  });

  const combined = STORIES.map(s => {
    const vec = vecNorm ? vecNorm[s.id] || 0 : 0;
    const kw  = kwNorm[s.id] || 0;
    let score = ALPHA * vec + (1 - ALPHA) * kw;
    // Domain boost: matching region/industry gets ×1.3
    if (activeBoosts.some(b => b.boost(s))) score *= 1.3;
    // Platform overview penalty: IBM-branded articles (product blogs, not
    // customer stories) are down-weighted so real customer proof points win.
    if (/^IBM\s/i.test(s.company || '')) score *= 0.5;
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

  // Deduplicate by story id — the same story can score in both legs and appear
  // twice. Keep only the first (highest-scored) occurrence before slicing.
  const seenIds = new Set();
  const topStories = combined
    .filter(({ score }) => score >= threshold && score >= MIN_ABSOLUTE)
    .filter(({ story }) => {
      if (seenIds.has(story.id)) return false;
      seenIds.add(story.id);
      return true;
    })
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

/* ── Shared system prompt ─────────────────────────────────────────────────── */
// Citation instruction: LLM must use the CITE_AS=[CIT:story-N] token shown
// in each story header. The server resolves these to [S1],[S2] by
// first-appearance order, keyed on the immutable story ID, not company name.
// This prevents both positional mis-assignment and same-company collisions.
const SYSTEM_PROMPT =
  'You are an IBM customer story analyst briefing a colleague. ' +
  'Answer ONLY using the story data provided. ' +
  'Write a single flowing paragraph (3-5 sentences, under 220 words) that directly and naturally answers the question. ' +
  'Open with a sentence that directly addresses the question — do NOT start with "These stories", "The stories", or any meta-phrase. ' +
  'Each story has a CITE_AS token shown in its header. When you first mention a company, place its CITE_AS token immediately after the company name. Use each token at most once. ' +
  'Include specific numbers, percentages, or metrics whenever they are present in the data. ' +
  'Do NOT list or bullet-point. Do NOT invent details not in the story data. ' +
  'Do NOT repeat a company name or citation token you have already used. ' +
  'Do NOT qualify or comment on how relevant individual stories are. ' +
  'Do NOT write sentences like "while this story does not directly illustrate X" or "this example may not perfectly match" or any similar phrase that evaluates story fit — every story in the data was selected as relevant, so treat it that way. ' +
  'Do NOT add a concluding meta-sentence — end on a concrete outcome or insight. ' +
  'Write only the answer paragraph, nothing else.';

/* ── Prompt builder (JSON fields path) ───────────────────────────────────── */
function buildMessages(query, topStories) {
  const storyCtx = topStories.map((s) => {
    const outcome     = (s.businessOutcome || '').slice(0, 300);
    const metrics     = (s.outcomes || []).slice(0, 6).map(m => `- ${m}`).join('\n');
    const products    = (s.products || []).slice(0, 4).join(', ');
    const videoUrl    = s.videoUrl || s.customerVideoUrl || s.videoEmbedUrl || '';
    const videoLine   = videoUrl ? `\nVideo: ${videoUrl}` : '';
    const metricsLine = metrics ? `\nMetrics:\n${metrics}` : '';
    const citeAs      = makeCitKey(s.id);
    return `CITE_AS=[${citeAs}] | ${s.company} | ${s.industry} | ${s.region}\nProducts: ${products}\nOutcome: ${outcome}${metricsLine}${videoLine}`;
  }).join('\n---\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: `Story data:\n${storyCtx}\n\nQuestion: ${query}` }
  ];
}

/* ── RAG prompt builder (full blog chunks) ───────────────────────────────── */
function buildRagMessages(query, topChunks) {
  const seenStory     = {};
  const contextBlocks = [];
  for (const { chunk } of topChunks) {
    if (!seenStory[chunk.storyId]) {
      seenStory[chunk.storyId] = [];
      contextBlocks.push({ id: chunk.storyId, company: chunk.company, title: chunk.title, texts: [] });
    }
    seenStory[chunk.storyId].push(chunk.text);
  }
  const storyCtx = contextBlocks.map((b) => {
    b.texts = seenStory[b.id];
    const citeAs = makeCitKey(b.id);
    return `CITE_AS=[${citeAs}] | ${b.company}\nTitle: ${b.title}\n---\n${b.texts.join('\n\n').slice(0, 1800)}`;
  }).join('\n\n════════════════════\n\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: `Story excerpts from full IBM blog posts:\n\n${storyCtx}\n\nQuestion: ${query}` }
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
    // Upstream timeout — prevents runaway cost from hung watsonx connections.
    req.setTimeout(WX_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('WX_TIMEOUT:request exceeded ' + WX_TIMEOUT_MS + 'ms'));
    });
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
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        return reject(new Error('Request body too large'));
      }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function checkRateLimit(ip) {
  const now    = Date.now();
  const window = 60_000;
  if (!_rateCounts[ip] || now - _rateCounts[ip].windowStart > window) {
    _rateCounts[ip] = { count: 1, windowStart: now };
    return false; // not limited
  }
  _rateCounts[ip].count++;
  return _rateCounts[ip].count > RATE_LIMIT_RPM;
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
      wx_url:             WX_URL,
      git_commit:         GIT_COMMIT
    }, cors);
  }

  // /debug-auth removed: exposed credential prefixes and could trigger live
  // watsonx requests from any unauthenticated caller. Returns 404 in production.
  if (req.method === 'GET' && req.url === '/debug-auth') {
    return send(res, 404, { error: 'Not found' }, cors);
  }

  // /debug-retrieval — removed from public production.
  // It triggered a paid watsonx embedding request on every call with no auth,
  // rate limiting, or query-length guard, exposing cost-abuse and internal
  // retrieval scores. Returns 404 to public callers.
  // To use locally: set DEBUG_RETRIEVAL_KEY env var and pass ?key=<value>.
  if (req.method === 'GET' && req.url.startsWith('/debug-retrieval')) {
    const debugKey = process.env.DEBUG_RETRIEVAL_KEY || '';
    const parsedUrl = new url.URL(req.url, 'http://localhost');
    if (!debugKey || parsedUrl.searchParams.get('key') !== debugKey) {
      return send(res, 404, { error: 'Not found' }, cors);
    }
    const q = parsedUrl.searchParams.get('q') || '';
    if (!q || q.length > MAX_QUERY_CHARS) return send(res, 400, { error: 'q param required (max 500 chars)' }, cors);
    if (CORPUS.length === 0) return send(res, 503, { error: 'corpus not loaded' }, cors);
    try {
      const queryVec = await embedQuery(q.trim());
      const scored = CORPUS.map(chunk => ({
        storyId: chunk.storyId,
        company: chunk.company,
        score:   parseFloat(cosineSimilarity(queryVec, chunk.embedding).toFixed(4))
      }));
      scored.sort((a, b) => b.score - a.score);
      return send(res, 200, { query: q, top20: scored.slice(0, 20) }, cors);
    } catch (e) {
      return send(res, 500, { error: 'retrieval error' }, cors);
    }
  }

  // Chat
  if (req.method === 'POST' && req.url === '/v1/chat') {
    // Per-IP rate limit
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (checkRateLimit(clientIp)) {
      return send(res, 429, { error: 'Too many requests — please wait a moment before trying again.' }, cors);
    }

    let body;
    try { body = await readBody(req); }
    catch (e) { return send(res, 400, { error: e.message }, cors); }

    const query = (body.query || body.message || '').trim();
    if (!query) {
      return send(res, 400, { error: 'query is required' }, cors);
    }
    if (query.length > MAX_QUERY_CHARS) {
      return send(res, 400, { error: `Query too long — maximum ${MAX_QUERY_CHARS} characters.` }, cors);
    }

    const topK = Math.min(Math.max(parseInt(body.top_k || '3', 10), 1), 10);

    // ── Hybrid retrieval (vector + keyword combined) ───────────────────────
    let topStories, topChunks, retrievalMode;
    try {
      const result  = await retrieveHybrid(query, topK);
      topChunks     = result.chunks;
      topStories    = result.stories;
      retrievalMode = CORPUS.length > 0 ? 'hybrid' : 'keyword';

      // hasVideo post-filter: when the query explicitly asks for video stories,
      // drop any story that has no video asset (videoUrl / customerVideoUrl /
      // videoEmbedUrl). This mirrors the frontend-only filter that was missing
      // on the server side and caused video queries to return non-video results.
      const videoQueryRe = /\b(video|videos|watch|film|clip)\b/i;
      if (videoQueryRe.test(query)) {
        const hasVideo = s =>
          Boolean(s.videoUrl || s.customerVideoUrl || s.videoEmbedUrl);
        topStories = topStories.filter(hasVideo);
        const videoStoryIds = new Set(topStories.map(s => s.id));
        topChunks  = topChunks.filter(({ chunk }) => videoStoryIds.has(chunk.storyId));
      }
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

    let answer;
    let usedWatsonx = false;
    let wxError     = null;

    try {
      const messages  = topChunks
        ? buildRagMessages(query, topChunks)
        : buildMessages(query, topStories);
      answer      = await callWatsonx(messages);
      usedWatsonx = true;
    } catch (err) {
      wxError = err.message;
      console.error('[btb] watsonx error:', err.message);
      answer = topStories.map((s, i) =>
        `[S${i + 1}] ${s.company} (${s.industry}): ${(s.businessOutcome || s.description || '').slice(0, 200)}`
      ).join('\n');
    }

    // ── Citation resolution: replace name-anchored [CIT:Key] tokens with [S1],[S2]… ──
    // The LLM writes [CIT:CompanyKey] tokens (from CITE_AS= in the prompt).
    // resolveCitations() maps them to sequential [Sn] in first-appearance order
    // and reorders topStories to match — so sources[0] is always [S1].
    const citResult = resolveCitations(answer, topStories);
    answer    = citResult.answer;
    const reorderedStories = citResult.reorderedStories;

    // ── Fix 1: strip spurious "IBM " prefix from known third-party product names ──
    // The LLM sometimes writes "IBM HashiCorp Terraform", "IBM Confluent", etc.
    // These are partner products, not IBM brands — remove the prefix.
    const THIRD_PARTY_NAMES = [
      'HashiCorp', 'Terraform', 'Confluent', 'Kafka', 'Salesforce',
      'SAP', 'Oracle', 'ServiceNow', 'Workday', 'Microsoft', 'Azure',
      'AWS', 'Google', 'VMware', 'Red Hat', 'Ansible', 'GitHub',
      'Databricks', 'Snowflake', 'MongoDB', 'PostgreSQL', 'MySQL',
      'Kubernetes', 'Docker', 'OpenShift',
      'Bob'  // CrushBank story mentions "Bob" (a product) — not an IBM brand
    ];
    const thirdPartyRe = new RegExp(
      `IBM\\s+(${THIRD_PARTY_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
      'g'
    );
    answer = answer.replace(thirdPartyRe, '$1');

    const sources = reorderedStories.map((s, i) => ({
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
