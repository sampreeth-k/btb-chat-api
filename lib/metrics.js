/**
 * lib/metrics.js — deterministic correction of a known mis-stated metric
 *
 * California DMV (story 47) went from an estimated 5 years to 15 months. That is a
 * 75% reduction in duration ((60 - 15) / 60), and it describes the modernization
 * DISCOVERY phase, not the whole modernization. The published blog headline says
 * "85%", and the model repeats whatever wording it is shown. This guard rewrites the
 * claim in generated answers when the DMV story is part of the answer.
 *
 * Pure function, no I/O — unit-tested in test/metrics.test.js.
 */

'use strict';

const DMV_STORY_ID = 47;

// "85%" / "85 percent", optionally followed by faster/quicker. Not "85%+" (test coverage)
// and not an accuracy/coverage/parity figure.
const CLAIM_RE = /\b85\s?(?:%|percent)(?!\+)(\s+(?:faster|quicker))?/gi;

/**
 * Replace the DMV "85%" duration claim with the correct figure.
 * Sentences about coverage, accuracy or parity are left alone, and nothing changes
 * unless the DMV story is among `storyIds`.
 */
function correctKnownMetrics(text, storyIds) {
  if (!text) return text;
  const ids = storyIds instanceof Set ? storyIds : new Set(storyIds || []);
  if (!ids.has(DMV_STORY_ID)) return text;
  return String(text).replace(/[^.!?\n]+/g, sentence =>
    /coverage|accuracy|parity/i.test(sentence)
      ? sentence
      : sentence.replace(CLAIM_RE, (m, faster) => (faster ? 'about 75% shorter' : 'about 75%')));
}

module.exports = { correctKnownMetrics, DMV_STORY_ID };
