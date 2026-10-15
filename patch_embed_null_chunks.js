#!/usr/bin/env node
/**
 * patch_embed_null_chunks.js
 *
 * Targeted fix: finds every corpus.json chunk with embedding: null,
 * embeds it via watsonx.ai, and writes the result back in-place.
 * Does NOT re-crawl articles or touch already-embedded chunks.
 *
 * Usage (PowerShell):
 *   $env:WATSONX_API_KEY    = 'your-key'
 *   $env:WATSONX_PROJECT_ID = 'your-project-id'
 *   node patch_embed_null_chunks.js
 *
 * Optional:
 *   $env:WATSONX_URL = 'https://us-south.ml.cloud.ibm.com'  # default
 *   $env:EMBED_MODEL = 'ibm/slate-125m-english-rtrvr-v2'    # default
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').replace(/\/$/, '');
const EMBED_MODEL   = process.env.EMBED_MODEL || 'ibm/slate-125m-english-rtrvr-v2';
const CORPUS_FILE   = path.join(__dirname, 'corpus.json');
const EMBED_DELAY   = 600;  // ms between API calls — matches build-corpus.js

if (!WX_API_KEY || !WX_PROJECT_ID) {
  console.error('ERROR: WATSONX_API_KEY and WATSONX_PROJECT_ID must be set.');
  process.exit(1);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpPost(hostname, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const opts = {
      hostname,
      path: urlPath,
      method: 'POST',
      headers: { ...headers, 'Content-Length': buf.length }
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(buf);
    req.end();
  });
}

async function getIamToken() {
  const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(WX_API_KEY)}`;
  const raw  = await httpPost('iam.cloud.ibm.com', '/identity/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded'
  });
  const d = JSON.parse(raw);
  if (!d.access_token) throw new Error('IAM token exchange failed: ' + raw.slice(0, 300));
  return d.access_token;
}

function sanitizeText(text) {
  return text
    .replace(/\{[^{}]{0,500}\}/g, ' ')
    .replace(/\[[^\[\]]{0,500}\]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function embedText(text, iamToken) {
  const safe = sanitizeText(text).slice(0, 2000);
  const body = JSON.stringify({
    model_id:   EMBED_MODEL,
    project_id: WX_PROJECT_ID,
    inputs:     [safe]
  });
  const hostname = new url.URL(WX_URL).hostname;
  const raw = await httpPost(
    hostname,
    '/ml/v1/text/embeddings?version=2024-03-14',
    body,
    {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${iamToken}`
    }
  );
  const d = JSON.parse(raw);
  if (!d.results || !d.results[0] || !d.results[0].embedding) {
    throw new Error('Unexpected embed response: ' + raw.slice(0, 400));
  }
  return d.results[0].embedding;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
async function main() {
  console.log(`Loading ${CORPUS_FILE} …`);
  const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  console.log(`  ${corpus.length} total chunks loaded.`);

  const nullIdxs = corpus
    .map((c, i) => (c.embedding === null ? i : -1))
    .filter(i => i !== -1);

  if (nullIdxs.length === 0) {
    console.log('\n✅ No null embeddings found — corpus is already complete.');
    return;
  }

  console.log(`\n  ${nullIdxs.length} chunk(s) with null embeddings:`);
  nullIdxs.forEach(i => {
    console.log(`    [${i}] storyId=${corpus[i].storyId}  company="${corpus[i].company}"  chunkIndex=${corpus[i].chunkIndex}`);
  });

  console.log('\nObtaining IAM token …');
  const iamToken = await getIamToken();
  console.log('  Token obtained.');

  console.log(`\nEmbedding ${nullIdxs.length} chunk(s) …`);
  let succeeded = 0, failed = 0;
  for (const idx of nullIdxs) {
    const c = corpus[idx];
    process.stdout.write(`  storyId=${c.storyId} chunk ${c.chunkIndex} ("${c.company}") … `);
    try {
      corpus[idx].embedding = await embedText(c.text, iamToken);
      console.log('ok');
      succeeded++;
    } catch (err) {
      console.log(`FAILED — ${err.message.slice(0, 120)}`);
      failed++;
    }
    if (idx !== nullIdxs[nullIdxs.length - 1]) await sleep(EMBED_DELAY);
  }

  console.log(`\n  ${succeeded} embedded, ${failed} failed.`);

  if (succeeded === 0) {
    console.error('\nERROR: No chunks were embedded — corpus.json NOT written.');
    process.exit(1);
  }

  const stillNull = corpus.filter(c => c.embedding === null).length;
  console.log(`\nWriting updated corpus.json … (${stillNull} null embedding(s) remaining)`);
  fs.writeFileSync(CORPUS_FILE, JSON.stringify(corpus, null, 2), 'utf8');
  const sizeMB = (fs.statSync(CORPUS_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`  Done. ${corpus.length} chunks, ${sizeMB} MB.`);

  if (failed > 0) {
    console.warn(`\nWARN: ${failed} chunk(s) still have null embeddings. Re-run to retry them.`);
    process.exit(1);
  }

  console.log('\n✅ All null embeddings resolved. Commit corpus.json and push to trigger Render redeploy.');
}

main().catch(err => { console.error('\nFATAL:', err.message); process.exit(1); });
