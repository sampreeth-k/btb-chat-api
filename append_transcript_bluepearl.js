#!/usr/bin/env node
/**
 * append_transcript_bluepearl.js
 *
 * Appends the full cleaned transcript of the Beyond the Blueprints video
 * "Modernizing Legacy Applications with AI-Assisted Development | Blue Pearl"
 * (https://www.youtube.com/watch?v=ZXHzfjLhhaU) to corpus.json for story id=59.
 *
 * Usage:
 *   WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> WATSONX_URL=https://us-south.ml.cloud.ibm.com \
 *     node append_transcript_bluepearl.js
 *
 * If the WATSONX_* variables are NOT set, chunks are still appended with
 * embedding: null (the chat falls back to keyword matching for them). Run
 * patch_embed_null_chunks.js later, once the variables are set, to fill them.
 *
 * Safe: skips if transcript chunks for this story already exist; append only.
 */
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');
const mammoth = require('mammoth');

const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').replace(/\/$/, '');
const EMBED_MODEL   = 'ibm/slate-125m-english-rtrvr-v2';
const OUT_FILE      = path.join(__dirname, 'corpus.json');
const TRANSCRIPT_PATH = process.env.TRANSCRIPT_PATH ||
  'C:\\Users\\SampreethKumar\\Downloads\\CVPE\\Video Transcripts_Roses\\Modernizing Legacy Applications with AI-Assisted Development _ Blue Pearl.docx';

const STORY_ID  = 59;
const CHUNK_SOURCE = 'transcript_btb_interview';

// 280 words keeps each chunk inside the 2000-character embedding input limit used below.
const CHUNK_WORDS   = 280;
const CHUNK_OVERLAP = 50;
const EMBED_DELAY   = 700;

const SPEAKER_LABEL = { '1': 'Sai Govender (CEO and Founder, Blue Pearl)', '2': 'Chad Jennings (host, IBM)' };

// Obvious auto-transcription misspellings of names/terms (verified against the video context).
const FIXES = [
  [/\bBucky Price\b/g, 'BookiePrice'], [/\bBookie Price\b/g, 'BookiePrice'], [/\bBokehPrice's\b/g, "BookiePrice's"],
  [/\bSai Gavinder\b/g, 'Sai Govender'],
  [/\bBluePearl\b/g, 'Blue Pearl'], [/\bBluePower\b/g, 'Blue Pearl'],
  [/\bin any bit\b/g, 'any bet'], [/\bany bit\b/g, 'any bet']
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitize(text) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ')
    .replace(/\\/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

async function buildTranscript() {
  const { value } = await mammoth.extractRawText({ path: TRANSCRIPT_PATH });
  const parts = [];
  for (const raw of value.split(/\r?\n/)) {
    const l = raw.trim();
    const m = l.match(/^\[Speaker (\d)\]\s*\(\d+:\d+\s*-\s*\d+:\d+\)$/);
    if (m) { parts.push(`${SPEAKER_LABEL[m[1]] || 'Speaker'}:`); continue; }
    if (!l || /TurboScribe/.test(l) || l.startsWith('Modernizing Legacy Applications')) continue;
    parts.push(l);
  }
  let text = parts.join(' ');
  for (const [re, rep] of FIXES) text = text.replace(re, rep);
  const header = 'Beyond the Blueprints video interview transcript: Modernizing Legacy Applications with AI-Assisted Development at Blue Pearl. ' +
    'Host: Chad Jennings (Global Head of Customer Voice and Product Experience, IBM). Guest: Sai Govender (Saireshan Govender), CEO and founder of Blue Pearl, an IBM business partner and AWS strategic partner. ' +
    'All metrics below are statements made by the guest in the interview. ';
  return header + text;
}

function chunkText(text, chunkWords, overlapWords) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = []; let start = 0;
  while (start < words.length) {
    const end   = Math.min(start + chunkWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 100) chunks.push(chunk);
    if (end >= words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

async function getIamToken() {
  const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(WX_API_KEY)}`;
  return new Promise((resolve, reject) => {
    const buf  = Buffer.from(body);
    const opts = { hostname: 'iam.cloud.ibm.com', path: '/identity/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length } };
    const req = https.request(opts, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!d.access_token) reject(new Error('IAM error: ' + JSON.stringify(d).slice(0, 200)));
        else resolve(d.access_token);
      });
    });
    req.on('error', reject); req.write(buf); req.end();
  });
}

async function embedSingle(text, iamToken) {
  const safe = sanitize(text).slice(0, 2000);
  const buf  = Buffer.from(JSON.stringify({ model_id: EMBED_MODEL, project_id: WX_PROJECT_ID, inputs: [safe] }));
  const wxHost = new url.URL(WX_URL).hostname;
  return new Promise((resolve, reject) => {
    const opts = { hostname: wxHost, path: '/ml/v1/text/embeddings?version=2024-03-14', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${iamToken}`, 'Content-Length': buf.length } };
    const req = https.request(opts, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!d.results || !d.results[0]) reject(new Error('Embed error: ' + JSON.stringify(d).slice(0, 300)));
        else resolve(d.results[0].embedding);
      });
    });
    req.on('error', reject); req.write(buf); req.end();
  });
}

async function main() {
  const corpus = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  console.log(`Corpus: ${corpus.length} existing chunks.`);

  const already = corpus.filter(c => c.storyId === STORY_ID && c.source === CHUNK_SOURCE);
  if (already.length > 0) {
    console.log(`Transcript chunks already present for story ${STORY_ID} (${already.length}). Nothing to do.`);
    return;
  }

  const story = JSON.parse(fs.readFileSync(path.join(__dirname, 'stories.json'), 'utf8')).find(s => s.id === STORY_ID);
  if (!story) throw new Error('Story 59 not found in stories.json');
  // Reuse the industry/region labels of this story's existing article chunks.
  const existing = corpus.find(c => c.storyId === STORY_ID);
  const meta = {
    company: story.company,
    title: story.title,
    industry: existing ? existing.industry : (Array.isArray(story.industry) ? story.industry.join(',') : story.industry),
    region: existing ? existing.region : story.region,
    articleUrl: story.articleUrl
  };

  const rawChunks = chunkText(sanitize(await buildTranscript()), CHUNK_WORDS, CHUNK_OVERLAP);
  console.log(`Transcript split into ${rawChunks.length} chunks.`);

  const canEmbed = !!(WX_API_KEY && WX_PROJECT_ID);
  let iamToken = null;
  if (canEmbed) iamToken = await getIamToken();
  else console.warn('WATSONX_API_KEY / WATSONX_PROJECT_ID not set - chunks will be written with embedding: null.');

  const newChunks = [];
  for (let i = 0; i < rawChunks.length; i++) {
    let embedding = null;
    if (canEmbed) {
      process.stdout.write(`  Embedding chunk ${i + 1}/${rawChunks.length}... `);
      try { embedding = await embedSingle(rawChunks[i], iamToken); console.log('OK'); }
      catch (err) { console.log('ERROR - ' + err.message + ' (stored with embedding: null)'); }
      if (i < rawChunks.length - 1) await sleep(EMBED_DELAY);
    }
    newChunks.push({
      storyId: STORY_ID, ...meta, source: CHUNK_SOURCE, chunkIndex: i, text: sanitize(rawChunks[i]), embedding
    });
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify([...corpus, ...newChunks], null, 2), 'utf8');
  const nulls = newChunks.filter(c => !Array.isArray(c.embedding)).length;
  console.log(`Corpus updated: ${corpus.length} -> ${corpus.length + newChunks.length} chunks (+${newChunks.length} for story ${STORY_ID}; ${nulls} without embeddings).`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
