'use strict';
// Deterministic "impressiveness" ranking for individual proof points.
// Scores a proof point by the largest comparable magnitude it states.
// Different units are mapped onto one rough 0-140 scale so they can be ranked together.

const WORD_MULT = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, b: 1e9 };

function num(s) { return parseFloat(String(s).replace(/,/g, '')); }

// Baseline / state-of-the-world statements are not outcomes ("95% already on REST",
// "99% of the portfolio was on Java 8", "100% functional equivalence", "9% flagged").
const BASELINE_RE = /\b(already|flagged|equivalen\w*)\b|\d\s*%\s+of\s+[\w’' ]{0,30}(application|portfolio|services|codebase)/i;

function pointScore(text) {
  const t = String(text || '');
  if (BASELINE_RE.test(t)) return 0;
  let best = 0;
  let m;

  // Percentages: 0-100 map 1:1; above 100 grows logarithmically (500% ~ 114, 5,000% ~ 134)
  const pctRe = /(\d[\d,]*(?:\.\d+)?)\s*%/g;
  while ((m = pctRe.exec(t))) {
    const p = num(m[1]);
    const s = p <= 100 ? p : 100 + Math.log10(p / 100) * 20;
    if (s > best) best = s;
  }

  // Multiples: "30x", "30×", "30 times"
  const multRe = /(\d[\d,]*(?:\.\d+)?)\s*(?:x|×|times)\b/gi;
  while ((m = multRe.exec(t))) {
    const n = num(m[1]);
    if (n > 1) best = Math.max(best, 50 + Math.log10(n) * 20);
  }

  // Scale: "14 million", "500M+", "2 billion"
  const scaleRe = /(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|[MBK])\b/g;
  while ((m = scaleRe.exec(t))) {
    const key = m[2].toLowerCase();
    const v = num(m[1]) * (WORD_MULT[key] || 1);
    if (v > 1) best = Math.max(best, Math.log10(v) * 8);
  }

  // Hedged claims are less impressive than measured ones
  if (/\b(projected|expected|can help|up to)\b/i.test(t)) best *= 0.9;
  return best;
}

// Returns the single best proof point per story (diversity), ranked high to low.
function rankProofPoints(stories, limit = 10) {
  const bestPerStory = [];
  for (const story of stories) {
    let top = null;
    for (const p of story.proofPoints || []) {
      const score = pointScore(p);
      if (score > 0 && (!top || score > top.score)) top = { story, point: p, score };
    }
    if (top) bestPerStory.push(top);
  }
  bestPerStory.sort((a, b) => b.score - a.score || a.story.company.localeCompare(b.story.company));
  // One entry per company (some companies have more than one story record)
  const seen = new Set();
  const unique = bestPerStory.filter((r) => {
    const key = (r.story.company || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, limit);
}

module.exports = { pointScore, rankProofPoints };
