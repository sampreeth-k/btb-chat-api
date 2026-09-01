#!/usr/bin/env node
/**
 * append-new-stories.js
 * Appends corpus chunks for story IDs listed in NEW_IDS.
 * SAFE: reads existing corpus.json, skips storyIds already present, appends only new chunks.
 * Never overwrites existing chunks.
 *
 * Usage:
 *   WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> node append-new-stories.js
 *
 * Set NEW_IDS below to the story IDs you want to add.
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

// ── Configure which story IDs to append ───────────────────────────────────────
const NEW_IDS = [48, 49, 50];

const CHUNK_WORDS   = 500;
const CHUNK_OVERLAP = 80;
const FETCH_DELAY   = 400;
const EMBED_DELAY   = 700;

if (!WX_API_KEY || !WX_PROJECT_ID) {
  console.error('ERROR: WATSONX_API_KEY and WATSONX_PROJECT_ID must be set.');
  process.exit(1);
}

/* ── IAM token ────────────────────────────────────────────────────────────── */
async function getIamToken() {
  const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(WX_API_KEY)}`;
  const raw = await httpPost('iam.cloud.ibm.com', '/identity/token', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
  const d = JSON.parse(raw);
  if (!d.access_token) throw new Error('IAM token error: ' + raw.slice(0, 300));
  return d.access_token;
}

/* ── HTTP helpers ─────────────────────────────────────────────────────────── */
function httpGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed  = new url.URL(targetUrl);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET',
      headers: { 'User-Agent': 'BtB-CorpusBuilder/1.0', 'Accept': 'text/html,application/xhtml+xml' } };
    const req = lib.request(options, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        resolve(httpGet(next)); return;
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
    const buf  = Buffer.from(body);
    const opts = { hostname, path: urlPath, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } };
    const req  = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.write(buf); req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── HTML → plain text ───────────────────────────────────────────────────── */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ').trim();
}

function sanitize(text) {
  return text
    .replace(/\{[^{}]{0,500}\}/g, ' ').replace(/\[[^\[\]]{0,500}\]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ')
    .replace(/\\/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function chunkText(text, chunkWords, overlapWords) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = []; let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 100) chunks.push(chunk);
    if (end >= words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

/* ── Embed single chunk ──────────────────────────────────────────────────── */
async function embedSingle(text, iamToken) {
  const safe = sanitize(text).slice(0, 2000);
  JSON.parse(JSON.stringify({ text: safe })); // validate
  const body = JSON.stringify({ model_id: EMBED_MODEL, project_id: WX_PROJECT_ID, inputs: [safe] });
  const raw  = await httpPost(new url.URL(WX_URL).hostname, `/ml/v1/text/embeddings?version=2024-03-14`, body,
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${iamToken}` });
  const d = JSON.parse(raw);
  if (!d.results || !d.results[0]) throw new Error('Embed error: ' + raw.slice(0, 400));
  return d.results[0].embedding;
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  // Load existing corpus — NEVER overwrite it, only append
  console.log(`Loading existing ${OUT_FILE}…`);
  const existingCorpus = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  const alreadyDone    = new Set(existingCorpus.filter(c => !c.source).map(c => String(c.storyId)));
  console.log(`  ${existingCorpus.length} existing chunks.`);
  console.log(`  Article story IDs already in corpus: ${[...alreadyDone].sort((a,b)=>a-b).join(', ')}`);

  // Load stories — filter to only NEW_IDS not already in corpus
  const stories   = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'));
  const toProcess = stories.filter(s => NEW_IDS.includes(s.id) && !alreadyDone.has(String(s.id)));

  if (toProcess.length === 0) {
    console.log('\nAll requested story IDs already in corpus. Nothing to do.');
    return;
  }
  console.log(`\nWill embed articles for: ${toProcess.map(s => `${s.id} (${s.company})`).join(', ')}`);

  console.log('\nObtaining IAM token…');
  const iamToken = await getIamToken();
  console.log('  Token obtained.\n');

  const newChunks = [];

  // Step 1: Crawl
  for (const story of toProcess) {
    process.stdout.write(`  Crawling ${story.company} (id=${story.id}) … `);
    try {
      const { status, body } = await httpGet(story.articleUrl);
      if (status !== 200) { console.log(`HTTP ${status} — skipped`); continue; }
      const text   = sanitize(htmlToText(body));
      const chunks = chunkText(text, CHUNK_WORDS, CHUNK_OVERLAP);
      chunks.forEach((chunk, ci) => {
        newChunks.push({ storyId: story.id, company: story.company, title: story.title,
          industry: story.industry || '', region: story.region || '',
          articleUrl: story.articleUrl, chunkIndex: ci, text: sanitize(chunk), embedding: null });
      });
      console.log(`${chunks.length} chunks`);
    } catch (err) { console.log(`ERROR — ${err.message}`); }
    await sleep(FETCH_DELAY);
  }

  if (newChunks.length === 0) { console.log('\nNo chunks extracted. Corpus unchanged.'); return; }
  console.log(`\n  ${newChunks.length} chunks to embed.`);

  // Step 2: Embed
  let succeeded = 0, failed = 0;
  for (let i = 0; i < newChunks.length; i++) {
    process.stdout.write(`  [${i+1}/${newChunks.length}] ${newChunks[i].company} chunk ${newChunks[i].chunkIndex} … `);
    try {
      newChunks[i].embedding = await embedSingle(newChunks[i].text, iamToken);
      console.log('ok'); succeeded++;
    } catch (err) { console.log(`SKIP — ${err.message.slice(0, 120)}`); failed++; }
    await sleep(EMBED_DELAY);
  }
  console.log(`\n  ${succeeded} embedded, ${failed} skipped.`);

  // Step 3: APPEND to existing corpus — never replace
  const embedded     = newChunks.filter(c => c.embedding !== null);
  const updatedCorpus = existingCorpus.concat(embedded);
  fs.writeFileSync(OUT_FILE, JSON.stringify(updatedCorpus, null, 2), 'utf8');
  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ corpus.json updated: ${existingCorpus.length} → ${updatedCorpus.length} chunks (${sizeMB} MB).`);
  console.log('   Commit corpus.json and push to trigger Render redeploy.');
}

main().catch(err => { console.error('\nFATAL:', err); process.exit(1); });
