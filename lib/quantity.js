/**
 * lib/quantity.js - ranking bonus for "how many X" questions
 *
 * Vector similarity cannot tell a passage that states "14 senior developers" from one
 * that merely discusses the same project. For a "how many <noun>" question, a passage
 * with a number directly in front of that noun is the one that answers it.
 *
 * Pure function, no I/O - unit-tested in test/quantity.test.js.
 */

'use strict';

const QUANTITY_BONUS = 0.4;
const NUMBER = '(?:\\d[\\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|hundred)';
const STOP = new Set(['did', 'does', 'do', 'were', 'was', 'are', 'is', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and']);

/** The noun after "how many" (modifiers allowed before it), singularised. */
function countedNouns(query) {
  const m = /\bhow many\s+((?:[a-z-]+\s+){0,2}[a-z-]+)/i.exec(String(query || ''));
  if (!m) return [];
  const out = [];
  for (const w of m[1].toLowerCase().split(/\s+/)) {
    if (STOP.has(w)) break;
    if (w.length > 3) out.push(w.replace(/s$/, ''));
  }
  return out;
}

/** QUANTITY_BONUS when `text` has a number (plus up to two modifiers) before a counted noun. */
function quantityBonus(query, text) {
  const nouns = countedNouns(query);
  if (!nouns.length) return 0;
  const t = String(text || '').toLowerCase();
  return nouns.some(n => new RegExp('\\b' + NUMBER + '\\s+(?:[a-z-]+\\s+){0,2}' + n + 's?\\b').test(t))
    ? QUANTITY_BONUS
    : 0;
}

module.exports = { quantityBonus, countedNouns, QUANTITY_BONUS };
