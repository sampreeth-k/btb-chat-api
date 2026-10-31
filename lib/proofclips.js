/**
 * lib/proofclips.js — story-level proof-clip index and selection
 *
 * Clips used to be keyed by company name, so every story from one company
 * (two Migrato stories, two Blue Pearl stories) received the same clip and
 * presented it as separate evidence. Clips are now owned by exactly one story,
 * and chosen per question from that story's own clips.
 *
 * Pure functions, no I/O — unit-tested in test/proofclips.test.js.
 */

'use strict';

const STRENGTH_RANK = { platinum: 4, gold: 3, silver: 2, bronze: 1 };

// Companies with several stories need an explicit owner for each clip.
// Ownership follows the source the clip was taken from (clip.sourceTranscriptFile).
//   Migrato: all four clips come from the Java 8 -> C++ Bob migration interview (story 43).
//   Blue Pearl: all four clips come from the BookiePrice/modernization interview, which is story 59.
//   CrushBank: the Bob clips are from the "Weeks to Days" interview (story 30); the rest are
//              from the IT service management interview (story 8).
const CLIP_STORY_OVERRIDES = {
  'migrato-bob-planning-readable-code': 43,
  'migrato-bob-demo-confidence': 43,
  'migrato-bob-selection-testing-documentation': 43,
  'migrato-bob-plan-mode-choices': 43,
  'bluepearl-bob-forty-of-45-deals': 59,
  'bluepearl-bob-never-seen-ai-code-generator': 59,
  'bluepearl-bob-roles-consolidated-game-changer': 59,
  'bluepearl-bob-nine-months-to-six-weeks': 59,
  'crushbank-bob-data-ai': 30,
  'crushbank-bob-weeks-to-days': 30,
  'crushbank-love-ibm-tech': 8,
  'crushbank-feasible-cost': 8,
  'crushbank-watsonx-stack': 8,
  'crushbank-hybrid-thought': 8,
};

// Clips about one specific project inside a multi-project story.
// Keys match PROJECTS[].key in lib/conversation.js.
const CLIP_PROJECT = {
  'bluepearl-bob-nine-months-to-six-weeks': 'bluepearl-bookieprice',
};

// A project-specific clip must not answer a question that is plainly about a
// different project, even when no conversation scope is active (standalone query).
const CLIP_EXCLUDED_WHEN = {
  'bluepearl-bookieprice': q => /investment[- ]report|investment firm/i.test(q) && !/bookie\s?price/i.test(q),
};

const norm = v => String(v || '').toLowerCase().trim();

function clipScore(c) {
  return c.score != null ? c.score : (STRENGTH_RANK[norm(c.strength || c.rating)] || 0);
}

/**
 * Build storyId -> clips[] from the raw endorsements list.
 * A clip is attached to a story only when ownership is unambiguous: the
 * company has a single story, or the clip has an explicit override.
 */
function buildClipIndex(rawClips, stories) {
  const byStory = new Map();
  const storiesByCompany = {};
  for (const s of stories) (storiesByCompany[norm(s.company)] = storiesByCompany[norm(s.company)] || []).push(s);

  (rawClips || []).forEach((c, n) => {
    const quote = c.quoteExcerpt || c.quote || '';
    if (!quote) return;
    const candidates = storiesByCompany[norm(c.storyMatch || c.customer)] || [];
    let owner = null;
    if (CLIP_STORY_OVERRIDES[c.id] != null) owner = candidates.find(s => s.id === CLIP_STORY_OVERRIDES[c.id]) || null;
    else if (candidates.length === 1) owner = candidates[0];
    if (!owner) return;
    const list = byStory.get(owner.id) || [];
    list.push({
      id: c.id || `${norm(c.customer)}-clip-${n}`,
      quote,
      speaker: c.speaker || '',
      role: c.role || '',
      strength: c.strength || c.rating || '',
      theme: c.theme || '',
      outcome: c.businessOutcome || '',
      projectKey: CLIP_PROJECT[c.id] || null,
      _score: clipScore(c),
    });
    byStory.set(owner.id, list);
  });
  return byStory;
}

const STOP = new Set(['what', 'which', 'with', 'that', 'this', 'from', 'about', 'their', 'there', 'were', 'have', 'does', 'discussed', 'earlier', 'conversation', 'project', 'the', 'and', 'for', 'was', 'how', 'did', 'who']);
const words = t => (String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !STOP.has(w));

/**
 * Choose the single clip that best supports this question for one story.
 * - skips clips that belong to a different project than the active scope
 * - prefers the clip whose theme/outcome/quote overlaps the question
 * - falls back to the strongest clip
 */
function pickClip(byStory, storyId, query, scope) {
  let list = byStory.get(storyId);
  if (!list || !list.length) return null;
  const activeProject = scope && scope.project ? scope.project.key : null;
  if (activeProject) list = list.filter(c => !c.projectKey || c.projectKey === activeProject);
  list = list.filter(c => !(c.projectKey && CLIP_EXCLUDED_WHEN[c.projectKey] && CLIP_EXCLUDED_WHEN[c.projectKey](String(query))));
  if (!list.length) return null;

  const q = new Set(words(query));
  let best = null, bestKey = -1;
  for (const c of list) {
    const hay = new Set(words(`${c.theme} ${c.outcome} ${c.quote}`));
    let overlap = 0;
    for (const w of q) if (hay.has(w)) overlap++;
    const key = overlap * 100 + c._score;
    if (key > bestKey) { bestKey = key; best = c; }
  }
  return best;
}

/**
 * Decide which stories may show a proof clip for this question.
 * A clip is evidence about its own story, so it must not ride along on a
 * question about someone else (e.g. Blue Pearl's quote on a United Airlines
 * answer just because Blue Pearl was retrieved as a related Bob story).
 *  - active conversation scope -> only the scoped stories
 *  - the question names one or more customers -> only those customers' stories
 *  - otherwise (a library-wide question) -> every story is eligible
 * Rollup pages named "IBM ..." are never treated as a named customer.
 */
function clipGate(query, scope, stories) {
  if (scope && scope.storyIds && scope.storyIds.size) {
    return id => scope.storyIds.has(id);
  }
  const q = String(query || '').toLowerCase();
  const named = new Set();
  for (const s of stories) {
    const name = norm(s.company);
    if (!name || name.length < 4 || /^ibm\b/.test(name)) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(q)) named.add(name);
  }
  if (!named.size) return () => true;

  // A named customer with several stories: only the story the question is
  // actually about may carry a clip (Migrato Bob vs Migrato hybrid architecture).
  const qWords = new Set(words(q));
  const allowed = new Set();
  for (const name of named) {
    const sibs = stories.filter(s => norm(s.company) === name);
    if (sibs.length < 2) { sibs.forEach(s => allowed.add(s.id)); continue; }
    const nameWords = new Set(words(name));
    const scored = sibs.map(s => {
      const hay = new Set(words(`${s.title} ${s.primaryProduct || ''}`).filter(w => !nameWords.has(w)));
      let n = 0;
      for (const w of qWords) if (hay.has(w)) n++;
      return { id: s.id, n };
    });
    const top = Math.max(...scored.map(x => x.n));
    scored.filter(x => x.n === top).forEach(x => allowed.add(x.id));
  }
  return id => allowed.has(id);
}

module.exports = { buildClipIndex, pickClip, clipGate, CLIP_STORY_OVERRIDES, CLIP_PROJECT };
