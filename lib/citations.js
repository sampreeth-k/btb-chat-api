/**
 * lib/citations.js — name-anchored citation token helpers
 *
 * Exported by server.js and imported by tests.
 * Both production code and tests share the same implementation —
 * there is no copied duplicate.
 *
 * Design:
 *   The LLM freely re-assigns positional [S1],[S2] numbers.
 *   Instead we embed a CITE_AS=[CIT:story-<id>] token in every prompt story
 *   header, keyed on the immutable story ID (not the company name).
 *   The LLM writes [CIT:story-25], which we resolve server-side to
 *   [S1],[S2] by first-appearance order.
 *   This guarantees sources[0] === the story the LLM cited as [S1],
 *   and is unique even when two stories share a company name.
 */

'use strict';

/**
 * makeCitKey(storyId)
 * Derives a stable, unique citation token from the immutable story ID.
 * Using the ID (not the company name) prevents collisions between
 * stories that share a company (e.g. two CrushBank or Migrato stories).
 *
 * @param  {number|string} storyId  — the story's .id field
 * @returns {string}                — e.g. "CIT:story-25"
 */
function makeCitKey(storyId) {
  return `CIT:story-${storyId}`;
}

/**
 * resolveCitations(answer, storyList)
 * Replaces [CIT:story-N] tokens in the LLM answer with [S1],[S2]… in
 * first-appearance order, and reorders storyList to match so that
 * sources[0] always corresponds to [S1].
 *
 * Unknown tokens (keys not in storyList) are stripped from the answer
 * rather than left visible to the user.
 *
 * @param  {string}   answer     — raw LLM output
 * @param  {Array}    storyList  — array of story objects (each must have .id)
 * @returns {{ answer: string, reorderedStories: Array }}
 */
function resolveCitations(answer, storyList) {
  // Map citKey → index in storyList
  const keyToIdx = {};
  storyList.forEach((s, i) => { keyToIdx[makeCitKey(s.id)] = i; });

  // First pass — collect first-appearance order
  const citationOrder = [];
  answer.replace(/\[CIT:story-[0-9]+\]/g, match => {
    const key = match.slice(1, -1); // strip [ ]
    const idx = keyToIdx[key];
    if (idx !== undefined && !citationOrder.includes(idx)) citationOrder.push(idx);
  });
  // Append any un-cited stories at the end (they appear in sources but may not
  // be referenced in the text)
  storyList.forEach((_, i) => { if (!citationOrder.includes(i)) citationOrder.push(i); });

  // Build key → new 1-based S-number
  const keyToSRef = {};
  citationOrder.forEach((origIdx, newPos) => {
    keyToSRef[makeCitKey(storyList[origIdx].id)] = newPos + 1;
  });

  // Second pass — replace tokens; strip unknowns
  const remapped = answer.replace(/\[CIT:story-[0-9]+\]/g, match => {
    const key = match.slice(1, -1);
    const n   = keyToSRef[key];
    return n ? `[S${n}]` : '';  // unknown token → empty string (sanitize)
  });

  const reorderedStories = citationOrder.map(i => storyList[i]);
  return { answer: remapped, reorderedStories };
}

module.exports = { makeCitKey, resolveCitations };
