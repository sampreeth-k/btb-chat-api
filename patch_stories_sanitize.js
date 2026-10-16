#!/usr/bin/env node
/**
 * patch_stories_sanitize.js
 * One-time patch: fix mis-decoded UTF-8 sequences in stories.json text fields.
 * The sequence U+E2 U+20AC + smart-quote variants is UTF-8 bytes read as Latin-1.
 * Safe to re-run — idempotent.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STORIES_FILE = path.join(__dirname, 'stories.json');
const stories = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'));

const TEXT_FIELDS = [
  'title', 'description', 'businessOutcome', 'blurb', 'summary',
  'customerQuote', 'quote', 'speaker'
];

function fixText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    // Mis-decoded UTF-8 en-dash: â€" (bytes E2 80 93 read as Latin-1)
    .replace(/\u00E2\u20AC\u201C/g, '-')   // en-dash
    .replace(/\u00E2\u20AC\u201D/g, '-')   // em-dash variant
    .replace(/\u00E2\u20AC\u2122/g, "'")   // right single quote
    .replace(/\u00E2\u20AC\u0153/g, '"')   // left double quote
    .replace(/\u00E2\u20AC\u009D/g, '"')   // right double quote
    .replace(/\u00E2\u20AC\u00A6/g, '...')  // ellipsis
    // Standard unicode replacements
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2026/g, '...')
    .replace(/\u00AD/g, '')              // soft hyphen
    .replace(/[\u0080-\u009F]/g, '')     // C1 control chars
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeStory(story) {
  const cleaned = { ...story };
  // Fix scalar text fields
  TEXT_FIELDS.forEach(f => {
    if (typeof cleaned[f] === 'string') cleaned[f] = fixText(cleaned[f]);
  });
  // Fix outcomes array
  if (Array.isArray(cleaned.outcomes)) {
    cleaned.outcomes = cleaned.outcomes.map(o => typeof o === 'string' ? fixText(o) : o);
  }
  // Fix products array
  if (Array.isArray(cleaned.products)) {
    cleaned.products = cleaned.products.map(p => typeof p === 'string' ? fixText(p) : p);
  }
  return cleaned;
}

let fixed = 0;
const cleaned = stories.map(story => {
  const c = sanitizeStory(story);
  if (JSON.stringify(c) !== JSON.stringify(story)) fixed++;
  return c;
});

console.log(`Stories scanned: ${stories.length}`);
console.log(`Stories with fixes: ${fixed}`);

if (fixed > 0) {
  fs.writeFileSync(STORIES_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
  console.log('stories.json updated.');
} else {
  console.log('stories.json unchanged — already clean.');
}
