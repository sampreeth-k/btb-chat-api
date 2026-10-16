#!/usr/bin/env node
// patch_stories_sanitize_v2.js
// Cleans remaining mis-decoded UTF-8 sequences from businessChallenge,
// businessOutcome, description, title, summary, and outcomes[] fields.
// Covers stories missed by the first sanitize pass.

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'stories.json');

function clean(str) {
    if (!str || typeof str !== 'string') return str;
    return str
        // --- multi-byte mojibake (UTF-8 bytes misread as latin-1) ---
        .replace(/\u00e2\u0080\u0099/g, "'")    // right single quote '
        .replace(/\u00e2\u0080\u009c/g, '"')    // left double quote "
        .replace(/\u00e2\u0080\u009d/g, '"')    // right double quote "
        .replace(/\u00e2\u0080\u0093/g, '-')    // en-dash
        .replace(/\u00e2\u0080\u0094/g, '-')    // em-dash
        .replace(/\u00e2\u0080\u00a6/g, '...')  // ellipsis
        // --- literal mojibake strings (survived as visible chars) ---
        .replace(/\u00e2\u20ac\u2122/g, "'")    // â€™
        .replace(/\u00e2\u20ac\u0153/g, '"')    // â€œ
        .replace(/\u00e2\u20ac\u009d/g, '"')    // â€
        .replace(/\u00e2\u20ac\u201c/g, '-')    // â€" (en-dash variant)
        .replace(/\u00e2\u20ac\u201d/g, '-')    // â€" (em-dash variant)
        .replace(/\u00e2\u20ac\u00a6/g, '...')  // â€¦
        // --- soft hyphen and C1 control chars ---
        .replace(/\u00ad/g, '')
        .replace(/[\u0080-\u009f]/g, '');
}

const stories = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const TEXT_FIELDS = ['businessChallenge', 'businessOutcome', 'description', 'title', 'summary'];

let fieldsCleaned = 0;
let storiesTouched = 0;

stories.forEach(s => {
    let touched = false;
    TEXT_FIELDS.forEach(f => {
        if (s[f] && typeof s[f] === 'string') {
            const c = clean(s[f]);
            if (c !== s[f]) { s[f] = c; fieldsCleaned++; touched = true; }
        }
    });
    if (Array.isArray(s.outcomes)) {
        s.outcomes = s.outcomes.map(o => {
            const c = clean(o);
            if (c !== o) { fieldsCleaned++; touched = true; }
            return c;
        });
    }
    if (touched) storiesTouched++;
});

fs.writeFileSync(FILE, JSON.stringify(stories, null, 2));
console.log(`Done. Stories touched: ${storiesTouched}, fields cleaned: ${fieldsCleaned}`);
