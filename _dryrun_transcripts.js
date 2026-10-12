'use strict';
const mammoth = require('mammoth');

async function extractAndChunk(filePath, label) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  let text = value.replace(/Transcribed by TurboScribe[^\n]*/gi, '');
  const firstSpeaker = text.search(/\[Speaker\s+\d+\]/i);
  if (firstSpeaker > 0) text = text.slice(firstSpeaker);
  text = text.replace(/\[Speaker\s+\d+\]\s*\([^)]*\)/gi, ' ');
  text = text.replace(/^[^\w\s]*(?:\u{1F449}|\u{2B50}|\u{1F339}|\u2705)[^\n]*/gmsu, '');
  text = text.replace(/https?:\/\/\S+/g, '');
  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  const CHUNK_WORDS = 400, OVERLAP = 60;
  let chunks = 0, start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim().length > 80) chunks++;
    if (end >= words.length) break;
    start = end - OVERLAP;
  }
  console.log(label + ': ' + words.length + ' words -> ' + chunks + ' chunks');
  console.log('  First 40 words: ' + words.slice(0, 40).join(' '));
  console.log('');
}

const DIR = 'C:/Users/SampreethKumar/Downloads/CVPE/Video Transcripts_Roses';
Promise.all([
  extractAndChunk(DIR + '/How to Build Enterprise AI Agents Across Any Environment _ Athena Intelligence.docx', 'Athena Intelligence (id=2)'),
  extractAndChunk(DIR + '/From Weeks to Days_ Building Enterprise Data Projects with AI _ CrushBank.docx', 'CrushBank Legacy Data (id=30)'),
]).then(() => {
  console.log('Dry-run complete. Both files parse successfully.');
}).catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
