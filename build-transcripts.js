#!/usr/bin/env node
/**
 * Beyond the Blueprints — Transcript corpus appender
 *
 * Usage:
 *   WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> \
 *   TRANSCRIPTS_DIR=<path-to-docx-folder> \
 *   node build-transcripts.js
 *
 * Optional env vars:
 *   WATSONX_URL      — default https://au-syd.ml.cloud.ibm.com
 *   EMBED_MODEL      — default ibm/slate-125m-english-rtrvr-v2
 *   OUT_FILE         — default corpus.json (APPENDED to, not replaced)
 *
 * What it does:
 *   1. Reads the 14 transcript .docx files from TRANSCRIPTS_DIR
 *   2. Strips TurboScribe preamble, speaker tags, and timestamps
 *   3. Splits each transcript into ~400-word overlapping chunks
 *   4. Embeds each chunk via watsonx.ai embeddings API
 *   5. Appends the new chunks to corpus.json (existing chunks untouched)
 *
 * Run once — subsequent runs will skip stories that already have
 * transcript chunks in corpus.json (source='transcript').
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

/* ── mammoth is a dev dependency — install if missing ───────────────────────── */
let mammoth;
try { mammoth = require('mammoth'); } catch {
  console.error('ERROR: mammoth not installed. Run: npm install mammoth');
  process.exit(1);
}

const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://au-syd.ml.cloud.ibm.com').replace(/\/$/, '');
const EMBED_MODEL   = process.env.EMBED_MODEL || 'ibm/slate-125m-english-rtrvr-v2';
const OUT_FILE      = process.env.OUT_FILE    || path.join(__dirname, 'corpus.json');
const STORIES_FILE  = path.join(__dirname, 'stories.json');
const TRANSCRIPTS_DIR = process.env.TRANSCRIPTS_DIR || '';

const CHUNK_WORDS   = 400;  // slightly smaller than article chunks — transcripts are dense
const CHUNK_OVERLAP = 60;
const EMBED_DELAY   = 700;  // ms between embedding calls (rate-limit headroom)

if (!WX_API_KEY || !WX_PROJECT_ID) {
  console.error('ERROR: WATSONX_API_KEY and WATSONX_PROJECT_ID must be set.');
  process.exit(1);
}
if (!TRANSCRIPTS_DIR || !fs.existsSync(TRANSCRIPTS_DIR)) {
  console.error('ERROR: TRANSCRIPTS_DIR must be set to the folder containing the .docx files.');
  process.exit(1);
}

/* ── storyId mapping: transcript filename (lowercased) → storyId ──────────── */
// Key: substring that uniquely identifies each transcript (case-insensitive)
const TRANSCRIPT_MAP = [
  { match: 'ai automation for it service management',           storyId: 8  },  // CrushBank
  { match: 'bud financial',                                     storyId: 11 },  // Bud Financial
  { match: 'gen ai travel assistant',                           storyId: 13 },  // Frontkom
  { match: 'maternal healthcare',                               storyId: 7  },  // MyLua Health
  { match: 'us open fan experience',                            storyId: 25 },  // USTA
  { match: 'real estate contract analysis',                     storyId: 3  },  // Edsvaard
  { match: 'iot & data analytics power global supply chains',   storyId: 32 },  // SupPlant
  { match: 'iot  data analytics power global supply chains',    storyId: 32 },  // SupPlant (& → space)
  { match: 'rag and ai automation transform secure document',   storyId: 12 },  // Bay Point Advisors
  { match: 'responsible ai is changing hiring',                 storyId: 23 },  // Knockri
  { match: 'knowledge graph data for llms',                     storyId: 10 },  // Wikimedia Deutschland
  { match: 'insurance claims processing',                       storyId: 27 },  // Claims Connection Group
  { match: 'scaling facilities operations',                     storyId: 6  },  // Mitie
  { match: 'legal ai search',                                   storyId: 9  },  // Shorthills AI
  { match: 'open insurance',                                    storyId: 5  },  // AXA Brazil
];

function resolveStoryId(filename) {
  const lower = filename.toLowerCase();
  for (const entry of TRANSCRIPT_MAP) {
    if (lower.includes(entry.match)) return entry.storyId;
  }
  return null;
}

/* ── DOCX → plain transcript text ──────────────────────────────────────────── */
async function extractTranscript(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });

  // Remove TurboScribe header line
  let text = value.replace(/Transcribed by TurboScribe[^\n]*/gi, '');

  // Remove YouTube/roses preamble block (everything before the first [Speaker N] tag)
  const firstSpeaker = text.search(/\[Speaker\s+\d+\]/i);
  if (firstSpeaker > 0) {
    text = text.slice(firstSpeaker);
  }

  // Strip speaker markers and timestamps: [Speaker N] (H:MM:SS - H:MM:SS)
  text = text.replace(/\[Speaker\s+\d+\]\s*\([^)]*\)/gi, ' ');

  // Strip leftover emoji / roses timestamp lines (lines starting with 👉 or ⭐ etc.)
  text = text.replace(/^[^\w\s]*(?:👉|⭐|🌹|✅)[^\n]*/gm, '');

  // Strip URLs
  text = text.replace(/https?:\/\/\S+/g, '');

  // Normalise unicode punctuation
  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2011]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

/* ── Chunker ────────────────────────────────────────────────────────────────── */
function chunkText(text, chunkWords, overlapWords) {
  const words  = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end   = Math.min(start + chunkWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 80) chunks.push(chunk);
    if (end >= words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

/* ── IAM token ─────────────────────────────────────────────────────────────── */
async function getIamToken() {
  const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(WX_API_KEY)}`;
  const raw  = await httpPost('iam.cloud.ibm.com', '/identity/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded'
  });
  const d = JSON.parse(raw);
  if (!d.access_token) throw new Error('IAM token error: ' + raw.slice(0, 300));
  return d.access_token;
}

/* ── HTTP helper ────────────────────────────────────────────────────────────── */
function httpPost(hostname, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const buf  = Buffer.from(body);
    const opts = {
      hostname, path: urlPath, method: 'POST',
      headers: { ...headers, 'Content-Length': buf.length }
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── IAM token with auto-refresh ────────────────────────────────────────────── */
// Returns a token getter function that refreshes the token automatically
async function makeTokenRefresher() {
  let token = await getIamToken();
  let fetchedAt = Date.now();
  return async function freshToken() {
    // Refresh if token is older than 45 minutes (IAM tokens last ~60 min)
    if (Date.now() - fetchedAt > 45 * 60 * 1000) {
      process.stdout.write('(refreshing IAM token) ');
      token = await getIamToken();
      fetchedAt = Date.now();
    }
    return token;
  };
}

/* ── watsonx.ai embeddings (with quota-backoff and token refresh) ────────────── */
async function embedSingle(text, getToken, retries = 6) {
  const safe = text.replace(/\\/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 2000);
  JSON.parse(JSON.stringify({ text: safe })); // validate JSON safety
  const body = JSON.stringify({
    model_id:   EMBED_MODEL,
    project_id: WX_PROJECT_ID,
    inputs:     [safe]
  });
  for (let attempt = 0; attempt <= retries; attempt++) {
    const iamToken = await getToken();
    const raw = await httpPost(
      new url.URL(WX_URL).hostname,
      `/ml/v1/text/embeddings?version=2024-03-14`,
      body,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${iamToken}` }
    );
    const d = JSON.parse(raw);
    if (d.results && d.results[0]) return d.results[0].embedding;
    const isQuota   = raw.includes('token_quota_reached');
    const isExpired = raw.includes('authentication_token_expired');
    if ((isQuota || isExpired) && attempt < retries) {
      const waitSec = isQuota ? 65 : 5; // quota needs ~1 min; expired token just needs refresh
      process.stdout.write(`${isExpired ? 'token-expired' : 'quota'} — waiting ${waitSec}s… `);
      await sleep(waitSec * 1000);
      continue;
    }
    throw new Error('Embed error: ' + raw.slice(0, 400));
  }
}

/* ── Main ───────────────────────────────────────────────────────────────────── */
async function main() {
  // Load existing corpus
  console.log(`Loading ${OUT_FILE}…`);
  const existingCorpus = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  console.log(`  ${existingCorpus.length} existing chunks.`);

  // Track which (storyId:chunkIndex) pairs are already embedded — skip those only
  const alreadyDone = new Set(
    existingCorpus
      .filter(c => c.source === 'transcript' && c.embedding !== null)
      .map(c => `${c.storyId}:${c.chunkIndex}`)
  );
  if (alreadyDone.size > 0) {
    console.log(`  Already embedded ${alreadyDone.size} transcript chunks — will skip those.`);
  }

  // Load stories for metadata lookup
  const stories    = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'));
  const storyIndex = Object.fromEntries(stories.map(s => [s.id, s]));

  // Find all .docx files except the quotes doc
  const docxFiles = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.endsWith('.docx') && !f.toLowerCase().includes('top 10 quotes'))
    .sort();

  console.log(`\nFound ${docxFiles.length} transcript .docx files in ${TRANSCRIPTS_DIR}`);

  // Build new chunks
  const newChunks = [];
  for (const filename of docxFiles) {
    const storyId = resolveStoryId(filename);
    if (!storyId) {
      console.log(`  SKIP (no mapping): ${filename}`);
      continue;
    }
    const story = storyIndex[storyId];
    if (!story) {
      console.log(`  SKIP (storyId=${storyId} not in stories.json): ${filename}`);
      continue;
    }

    process.stdout.write(`  storyId=${storyId} (${story.company}) … `);
    try {
      const filePath = path.join(TRANSCRIPTS_DIR, filename);
      const text     = await extractTranscript(filePath);
      const chunks   = chunkText(text, CHUNK_WORDS, CHUNK_OVERLAP);
      chunks.forEach((chunk, ci) => {
        if (alreadyDone.has(`${storyId}:${ci}`)) return; // already embedded, skip
        newChunks.push({
          storyId,
          company:    story.company,
          title:      story.title,
          industry:   story.industry  || '',
          region:     story.region    || '',
          articleUrl: story.articleUrl || '',
          source:     'transcript',
          chunkIndex: ci,
          text:       chunk,
          embedding:  null
        });
      });
      console.log(`${chunks.length} chunks`);
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
    }
  }

  if (newChunks.length === 0) {
    console.log('\nNo new chunks to embed. corpus.json unchanged.');
    return;
  }

  console.log(`\n  ${newChunks.length} new chunks to embed.`);

  // Embed
  console.log('\nObtaining IAM token…');
  const getToken = await makeTokenRefresher();
  console.log('  Token obtained.');

  let succeeded = 0, failed = 0;
  for (let i = 0; i < newChunks.length; i++) {
    const c = newChunks[i];
    process.stdout.write(`  [${i + 1}/${newChunks.length}] ${c.company} chunk ${c.chunkIndex} … `);
    try {
      c.embedding = await embedSingle(c.text, getToken);
      console.log('ok');
      succeeded++;
    } catch (err) {
      console.log(`SKIP — ${err.message.slice(0, 120)}`);
      failed++;
    }
    await sleep(EMBED_DELAY);
  }

  const embedded = newChunks.filter(c => c.embedding !== null);
  console.log(`\n  ${succeeded} embedded, ${failed} skipped.`);

  // Append to corpus and write
  const updatedCorpus = existingCorpus.concat(embedded);
  fs.writeFileSync(OUT_FILE, JSON.stringify(updatedCorpus, null, 2), 'utf8');
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ corpus.json updated: ${existingCorpus.length} → ${updatedCorpus.length} chunks (${sizeMB} MB).`);
  console.log('   Commit corpus.json and redeploy Render to activate transcript search.');
}

main().catch(err => { console.error('\nFATAL:', err); process.exit(1); });
