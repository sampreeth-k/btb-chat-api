'use strict';
const mammoth = require('mammoth');
const fs      = require('fs');

const DIR = process.argv[2] || 'C:/Users/SampreethKumar/Downloads/CVPE/Video Transcripts_Roses/';

async function extractTranscript(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  let text = value.replace(/Transcribed by TurboScribe[^\n]*/gi, '');
  const firstSpeaker = text.search(/\[Speaker\s+\d+\]/i);
  if (firstSpeaker > 0) text = text.slice(firstSpeaker);
  text = text.replace(/\[Speaker\s+\d+\]\s*\([^)]*\)/gi, ' ');
  text = text.replace(/^[^\w\s]*(?:👉|⭐|🌹|✅)[^\n]*/gm, '');
  text = text.replace(/https?:\/\/\S+/g, '');
  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2011]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text;
}

function chunkText(text, cw, ow) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + cw, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 80) chunks.push(chunk);
    if (end >= words.length) break;
    start = end - ow;
  }
  return chunks;
}

(async () => {
  const allFiles = fs.readdirSync(DIR)
    .filter(f => f.endsWith('.docx') && !f.toLowerCase().includes('top 10 quotes'))
    .sort();

  console.log(`Found ${allFiles.length} transcript files.\n`);
  let total = 0;
  for (const f of allFiles) {
    const text   = await extractTranscript(DIR + f);
    const chunks = chunkText(text, 400, 60);
    total += chunks.length;
    console.log(`${f.slice(0, 64).padEnd(64)} words=${String(text.split(/\s+/).length).padStart(5)} chunks=${chunks.length}`);
    if (chunks.length) console.log(`  preview: "${chunks[0].slice(0, 130)}"`);
  }
  console.log(`\nTotal new chunks: ${total}`);
})().catch(e => { console.error(e); process.exit(1); });
