#!/usr/bin/env node
/**
 * Beyond the Blueprints — RAG corpus builder
 *
 * Usage:
 *   WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> node build-corpus.js
 *
 * Optional env vars:
 *   WATSONX_URL   — default https://au-syd.ml.cloud.ibm.com
 *   EMBED_MODEL   — default ibm/slate-125m-english-rtrvr-v2
 *   OUT_FILE      — default corpus.json
 *
 * What it does:
 *   1. Reads every articleUrl from stories.json
 *   2. Fetches the full blog HTML and strips it to plain text
 *   3. Splits each article into ~500-word overlapping chunks
 *   4. Embeds each chunk via watsonx.ai embeddings API
 *   5. Writes corpus.json — array of { storyId, company, chunkIndex, text, embedding }
 *
 * corpus.json is committed to the repo and loaded by server.js at startup.
 * No external vector DB needed — cosine search over ~500 chunks is instant in memory.
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://au-syd.ml.cloud.ibm.com').replace(/\/$/, '');
const EMBED_MODEL   = process.env.EMBED_MODEL || 'ibm/slate-125m-english-rtrvr-v2';
const OUT_FILE      = process.env.OUT_FILE    || path.join(__dirname, 'corpus.json');
const STORIES_FILE  = path.join(__dirname, 'stories.json');

const CHUNK_WORDS   = 500;   // target words per chunk
const CHUNK_OVERLAP = 80;    // overlap words between consecutive chunks
const EMBED_BATCH   = 10;    // chunks per embedding API call (API max is 25)
const FETCH_DELAY   = 400;   // ms between article fetches (be polite)
const EMBED_DELAY   = 600;   // ms between embedding API calls

if (!WX_API_KEY || !WX_PROJECT_ID) {
  console.error('ERROR: WATSONX_API_KEY and WATSONX_PROJECT_ID must be set.');
  process.exit(1);
}

/* ── IAM token ─────────────────────────────────────────────────────────────── */
async function getIamToken() {
  const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(WX_API_KEY)}`;
  const raw = await httpPost('iam.cloud.ibm.com', '/identity/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded'
  });
  const d = JSON.parse(raw);
  if (!d.access_token) throw new Error('IAM token error: ' + raw.slice(0, 300));
  return d.access_token;
}

/* ── Generic HTTP helpers ───────────────────────────────────────────────────── */
function httpGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed   = new url.URL(targetUrl);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const options  = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'User-Agent': 'BtB-CorpusBuilder/1.0', 'Accept': 'text/html,application/xhtml+xml' }
    };
    const req = lib.request(options, res => {
      // Follow redirects (up to 3)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        resolve(httpGet(next));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout: ' + targetUrl)); });
    req.end();
  });
}

function httpPost(hostname, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
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

/* ── HTML → plain text ──────────────────────────────────────────────────────── */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ── Chunker ────────────────────────────────────────────────────────────────── */
function chunkText(text, chunkWords, overlapWords) {
  const words  = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start    = 0;
  while (start < words.length) {
    const end   = Math.min(start + chunkWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 100) chunks.push(chunk); // skip tiny tail chunks
    if (end >= words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

/* ── watsonx.ai embeddings ──────────────────────────────────────────────────── */
async function embedBatch(texts, iamToken) {
  const body = JSON.stringify({
    model_id: EMBED_MODEL,
    project_id: WX_PROJECT_ID,
    inputs: texts.map(t => ({ text: t }))
  });
  const raw = await httpPost(
    new url.URL(WX_URL).hostname,
    `/ml/v1/text/embeddings?version=2024-03-14`,
    body,
    {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${iamToken}`
    }
  );
  const d = JSON.parse(raw);
  if (!d.results) throw new Error('Embed error: ' + raw.slice(0, 400));
  return d.results.map(r => r.embedding);
}

/* ── Main ───────────────────────────────────────────────────────────────────── */
async function main() {
  console.log('Loading stories.json…');
  const stories = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'));
  console.log(`  ${stories.length} stories found.`);

  console.log('\nObtaining IAM token…');
  const iamToken = await getIamToken();
  console.log('  Token obtained.');

  const allChunks = []; // { storyId, company, title, chunkIndex, text }

  // ── Step 1: Crawl and chunk all articles ──────────────────────────────────
  console.log('\n── Step 1: Crawling articles ──────────────────────────────────');
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const artUrl = story.articleUrl;
    if (!artUrl) {
      console.log(`  [${i + 1}/${stories.length}] SKIP (no articleUrl): ${story.company}`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${stories.length}] ${story.company} … `);
    try {
      const { status, body } = await httpGet(artUrl);
      if (status !== 200) {
        console.log(`HTTP ${status} — skipped`);
        continue;
      }
      const text   = htmlToText(body);
      const chunks = chunkText(text, CHUNK_WORDS, CHUNK_OVERLAP);
      chunks.forEach((chunk, ci) => {
        allChunks.push({
          storyId:    story.id,
          company:    story.company,
          title:      story.title,
          industry:   story.industry  || '',
          region:     story.region    || '',
          articleUrl: artUrl,
          chunkIndex: ci,
          text:       chunk,
          embedding:  null  // filled in Step 2
        });
      });
      console.log(`${chunks.length} chunks`);
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
    }
    await sleep(FETCH_DELAY);
  }

  console.log(`\n  Total chunks to embed: ${allChunks.length}`);

  // ── Step 2: Embed all chunks ───────────────────────────────────────────────
  console.log('\n── Step 2: Embedding chunks ───────────────────────────────────');
  let embedded = 0;
  for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
    const batch = allChunks.slice(i, i + EMBED_BATCH);
    process.stdout.write(`  Embedding chunks ${i + 1}–${i + batch.length} of ${allChunks.length} … `);
    try {
      const embeddings = await embedBatch(batch.map(c => c.text), iamToken);
      embeddings.forEach((emb, j) => { allChunks[i + j].embedding = emb; });
      console.log('ok');
    } catch (err) {
      console.log(`ERROR — ${err.message} — retrying once…`);
      await sleep(2000);
      try {
        const embeddings = await embedBatch(batch.map(c => c.text), iamToken);
        embeddings.forEach((emb, j) => { allChunks[i + j].embedding = emb; });
        console.log('  Retry ok');
      } catch (err2) {
        console.log(`  Retry failed — ${err2.message} — these chunks will be skipped`);
      }
    }
    embedded += batch.length;
    await sleep(EMBED_DELAY);
  }

  // Remove any chunks that failed to embed
  const corpus = allChunks.filter(c => c.embedding !== null);
  console.log(`\n  ${corpus.length} chunks successfully embedded (${allChunks.length - corpus.length} failed).`);

  // ── Step 3: Write corpus.json ──────────────────────────────────────────────
  console.log(`\n── Step 3: Writing ${OUT_FILE} …`);
  fs.writeFileSync(OUT_FILE, JSON.stringify(corpus, null, 2), 'utf8');
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`  Done. ${corpus.length} chunks, ${sizeMB} MB.`);
  console.log('\n✅ Corpus build complete. Commit corpus.json and redeploy to Render.');
}

main().catch(err => { console.error('\nFATAL:', err); process.exit(1); });
