'use strict';
// Repairs UTF-8 text that was mis-decoded as Windows-1252 (e.g. "â€”" -> "—").
// Usage: node scripts/fix-mojibake.js <file> [--write]
const fs = require('fs');

const CP1252_EXTRA = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
};

function toByte(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x100) return cp;
  return CP1252_EXTRA[cp];
}

const CONT = '[\\u0080-\\u00BF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC' +
  '\\u2013\\u2014\\u2018\\u2019\\u201A\\u201C\\u201D\\u201E\\u2020\\u2021\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122]';
const RUN = new RegExp('[\\u00C2-\\u00F4]' + CONT + '{1,3}', 'g');

function fix(text) {
  let changed = 0;
  const out = text.replace(RUN, (m) => {
    const bytes = [...m].map(toByte);
    if (bytes.some((b) => b === undefined)) return m;
    const dec = Buffer.from(bytes).toString('utf8');
    if (dec.includes('\uFFFD')) return m;
    changed++;
    return dec;
  });
  return { out, changed };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/fix-mojibake.js <file> [--write]'); process.exit(2); }
  const { out, changed } = fix(fs.readFileSync(file, 'utf8'));
  console.log(`${file}: ${changed} sequence(s) repaired`);
  if (process.argv.includes('--write')) fs.writeFileSync(file, out, 'utf8');
}

module.exports = { fix };
