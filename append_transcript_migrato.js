#!/usr/bin/env node
/**
 * append_transcript_migrato.js
 *
 * Appends embedded chunks from the Migrato Beyond the Blueprints video
 * transcript ("How AI Accelerated a Java 8 to C++ Application Migration")
 * to corpus.json for story id=43.
 *
 * Usage:
 *   WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> WATSONX_URL=https://us-south.ml.cloud.ibm.com \
 *     node append_transcript_migrato.js
 *
 * Safe: reads existing corpus, skips if transcript chunks already present, appends only.
 */
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const WX_API_KEY    = process.env.WATSONX_API_KEY    || '';
const WX_PROJECT_ID = process.env.WATSONX_PROJECT_ID || '';
const WX_URL        = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').replace(/\/$/, '');
const EMBED_MODEL   = 'ibm/slate-125m-english-rtrvr-v2';
const OUT_FILE      = path.join(__dirname, 'corpus.json');

const STORY_ID  = 43;
const COMPANY   = 'Migrato';
const TITLE     = 'How Migrato used IBM Bob to turn a Java 8 roadblock into a three-day C++ migration';
const INDUSTRY  = 'IT Services';
const REGION    = 'EMEA';
const CHUNK_SOURCE = 'transcript_btb_interview';

// ── Transcript text ──────────────────────────────────────────────────────────
// Full transcript of the Beyond the Blueprints session:
// "How AI Accelerated a Java 8 to C++ Application Migration | Migrato"
// Speakers: Chad Jennings (host), Oskar Dubeldam (CEO, Migrato), Yuriyan Tuynes (Lead Architect, Migrato)
const TRANSCRIPT = `
Beyond the Blueprints Video Interview: How AI Accelerated a Java 8 to C++ Application Migration at Migrato

Host: Chad Jennings. Guests: Oskar Dubeldam (CEO, Migrato) and Yuriyan Tuynes (Lead Architect, Migrato).

Introduction and Company Overview:
Chad Jennings introduces the session, noting that Migrato used IBM Bob to migrate an installer application from Java 8 to C++. Oskar Dubeldam explains that Migrato — which can also be pronounced "Migrate too" — helps organisations migrate mostly unstructured content from source to destination. The MICC (Migrato Intelligent Content Classifier) is a software suite developed over 10 years, growing from a small script into six different applications. It handles privacy-sensitive data detection, metadata extraction, duplicate detection, and other content processing tasks. The software serves government agencies, local governments, banks, universities, and medical institutions. Security requirements vary: medical institutions often work fully on-premise with minimal internet connectivity after an installation phase.

The MICC Architecture:
Yuriyan Tuynes explains the architecture. The system handles a wide breadth of inputs — file systems, databases, emails and attachments. These are processed through OCR, classification, and private data detection pipelines before being indexed and moved to a database system. IBM tooling enables both on-premise and cloud deployment because customers have different hosting requirements. More privacy-sensitive customers, such as medical institutions, demand on-premise environments, sometimes completely closing internet access after installation.

The Modernisation Challenge — Java 8 to C++ Installer Migration:
Yuriyan led the technical work to convert the MICC installer application from Java 8 to C++ using IBM Bob. The challenge was a circular dependency: both the MICC Manager (the front-end application) and the installer run in Java. To update the MICC Manager, you use the installer — but to update the installer, the Manager needs to update it. Additionally, both applications run in the same Java Virtual Machine (JVM), making Java version upgrades and security fixes difficult because one application cannot independently update the JVM while the other depends on it. The solution was to rewrite the installer in a different language — C++ — so it could update the JVM and the Manager without this circular dependency.

IBM Bob Plan Mode and Design Decisions:
The project started in IBM Bob's plan mode. The team asked Bob a foundational question: how can you move this Java 8 codebase to C++, replace the dependencies, and choose new ones? Bob gave clear design choices, identifying which Java dependencies to replace and mapping them to C++ alternatives. Bob proposed restructuring options, including whether to preserve Java-like organisation or adopt conventional C++ patterns. After agreeing on the plan, the team moved to IBM Bob's code mode to start building the native C++ project. Yuriyan noted that the transition from plan mode to code mode was interactive and knowledgeable, and that Bob taught him about C++ alternatives while he worked — especially valuable as a Java developer with only secondary C++ experience.

Human-in-the-Loop and Testing:
For the Java-to-C++ design decisions, human review was less critical since Bob could make clear and appropriate choices. However, testing was essential: since it was a complete rewrite, all tests had to be recreated. Old Java unit tests could not be reused directly, but Bob could convert them to C++. Security-sensitive code required human pair review — Yuriyan and a colleague went through that code manually together. Confidence in production readiness came from testing the full integration: when the MICC Manager (front end) communicated correctly with the new C++ installer, confidence that the code was production ready increased significantly.

Why Migrato Chose IBM Bob:
Oskar Dubeldam described the decision. At IBM Think, a consultant demonstrated solving a Migrato customer challenge in 15 minutes — work that normally took Migrato several days. That was the pivotal moment. Migrato has two IBM Champions on the team. Oskar asked developers — including Yuriyan, Annika, and others — to test IBM Bob and report back. The comparison also included other AI coding tools such as a cloud-based code designer, but IBM Bob was chosen because it went further in vulnerability detection, testing support, and documentation generation. All four developers who evaluated it supported the decision.

Business Outcomes:
This migration served as a confidence-building test case for Migrato's broader modernisation roadmap. The MICC software suite is millions of lines of code, still largely written in Java 8 and Python. Migrato does not plan to migrate everything at once, but this installer project proved the approach works. The primary business metric was development speed: as a small company of five to six developers with a large backlog, and IBM constantly releasing new tools and components, Migrato needed a way to accelerate development without sacrificing reliability or ISO 27001 compliance. IBM Bob delivered that acceleration. Oskar confirmed: the major benefit is software development going faster.

Lessons Learned (Yuriyan Tuynes):
AI-generated code is not 100% correct but very close — treat Bob as a collaborator, not an automatic final answer. Bob is excellent at planning, translating the codebase, proposing library replacements, and preserving readable code structure even across languages. Even as a non-C++ developer, Yuriyan found the generated C++ code readable and understandable.

Advice for Other Organisations (Oskar Dubeldam):
Start small. Pick a specific component. Build confidence within the development team before expanding. Confidence must grow through small, concrete deliverables — what Yuriyan did with the installer, and what Annika did with old scripts. Then expand to the broader codebase. This phased approach is how Migrato plans to eventually modernise its full MICC software suite.

Key Metrics:
- Java 8 to C++ installer migration completed in three days (estimated without Bob: several weeks).
- Planning and full code generation completed in under one day by a single developer.
- Migrato is a small team of 5-6 developers with millions of lines of code to modernise.
- The approach must comply with ISO 27001.
- IBM Bob was chosen over competing AI coding tools after evaluation by four developers.
`;

const CHUNK_WORDS   = 500;
const CHUNK_OVERLAP = 80;
const EMBED_DELAY   = 700;

if (!WX_API_KEY || !WX_PROJECT_ID) {
  console.error('ERROR: WATSONX_API_KEY and WATSONX_PROJECT_ID must be set.');
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitize(text) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ')
    .replace(/\\/g, ' ').replace(/\s{2,}/g, ' ').trim();
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
        if (!d.access_token) reject(new Error('IAM error: ' + JSON.stringify(d).slice(0,200)));
        else resolve(d.access_token);
      });
    });
    req.on('error', reject); req.write(buf); req.end();
  });
}

async function embedSingle(text, iamToken) {
  const safe = sanitize(text).slice(0, 2000);
  const body = JSON.stringify({ model_id: EMBED_MODEL, project_id: WX_PROJECT_ID, inputs: [safe] });
  const buf  = Buffer.from(body);
  const wxHost = new url.URL(WX_URL).hostname;
  return new Promise((resolve, reject) => {
    const opts = { hostname: wxHost, path: '/ml/v1/text/embeddings?version=2024-03-14', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${iamToken}`, 'Content-Length': buf.length } };
    const req = https.request(opts, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!d.results || !d.results[0]) reject(new Error('Embed error: ' + JSON.stringify(d).slice(0,300)));
        else resolve(d.results[0].embedding);
      });
    });
    req.on('error', reject); req.write(buf); req.end();
  });
}

async function main() {
  console.log('Loading corpus…');
  const corpus = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  console.log(`  ${corpus.length} existing chunks.`);

  // Safety: skip if transcript chunks already present for this story
  const already = corpus.filter(c => c.storyId === STORY_ID && c.source === CHUNK_SOURCE);
  if (already.length > 0) {
    console.log(`  Transcript chunks already present for story ${STORY_ID} (${already.length} chunks). Nothing to do.`);
    return;
  }

  const rawChunks = chunkText(sanitize(TRANSCRIPT), CHUNK_WORDS, CHUNK_OVERLAP);
  console.log(`  Transcript split into ${rawChunks.length} chunks.`);

  console.log('\nObtaining IAM token…');
  const iamToken = await getIamToken();
  console.log('  Token obtained.\n');

  const newChunks = [];

  for (let i = 0; i < rawChunks.length; i++) {
    const text = rawChunks[i];
    process.stdout.write(`  Embedding chunk ${i + 1}/${rawChunks.length}… `);
    try {
      const embedding = await embedSingle(text, iamToken);
      newChunks.push({
        storyId:    STORY_ID,
        company:    COMPANY,
        title:      TITLE,
        industry:   INDUSTRY,
        region:     REGION,
        articleUrl: 'https://www.ibm.com/new/product-blog/how-migrato-used-ibm-bob-to-turn-a-java-8-roadblock-into-a-three-day-c-migration',
        source:     CHUNK_SOURCE,
        chunkIndex: i,
        text:       sanitize(text),
        embedding
      });
      console.log('OK');
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
    }
    if (i < rawChunks.length - 1) await sleep(EMBED_DELAY);
  }

  if (newChunks.length === 0) {
    console.log('\nNo chunks embedded. Corpus unchanged.');
    return;
  }

  const updated = [...corpus, ...newChunks];
  fs.writeFileSync(OUT_FILE, JSON.stringify(updated), 'utf8');
  console.log(`\nCorpus updated: ${corpus.length} → ${updated.length} chunks (+${newChunks.length} transcript chunks for story ${STORY_ID} ${COMPANY}).`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
