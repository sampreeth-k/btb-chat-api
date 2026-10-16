#!/usr/bin/env node
/**
 * patch_corpus_sanitize.js
 * One-time patch: clean garbled unicode from corpus.json chunk text.
 * Safe to re-run — idempotent.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CORPUS_FILE = path.join(__dirname, 'corpus.json');
const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));

let fixed = 0;
const cleaned = corpus.map(chunk => {
  const original = chunk.text;
  const c = original
    .replace(/\u00AD/g, '')          // soft hyphen — invisible, causes Granite garble
    .replace(/\u00A0/g, ' ')         // non-breaking space
    .replace(/\u2013/g, '-')         // en-dash
    .replace(/\u2014/g, '-')         // em-dash
    .replace(/\u2018|\u2019/g, "'")  // smart single quotes
    .replace(/\u201C|\u201D/g, '"')  // smart double quotes
    .replace(/\u2026/g, '...')       // ellipsis
    .replace(/[\u0080-\u009F]/g, '') // C1 control characters
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (c !== original) {
    fixed++;
    return { ...chunk, text: c };
  }
  return chunk;
});

console.log(`Chunks scanned: ${corpus.length}`);
console.log(`Chunks cleaned: ${fixed}`);

if (fixed > 0) {
  fs.writeFileSync(CORPUS_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
  console.log('corpus.json updated.');
} else {
  console.log('corpus.json unchanged — already clean.');
}
