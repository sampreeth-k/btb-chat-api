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

module.exports = { buildClipIndex, pickClip, CLIP_STORY_OVERRIDES, CLIP_PROJECT };
