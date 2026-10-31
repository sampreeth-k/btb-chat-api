/**
 * test/conversation.test.js — deterministic tests for project-aware follow-ups
 *
 * Run with: node test/conversation.test.js
 * Any failure exits with code 1.
 */

'use strict';

const path = require('path');
const { resolveConversationScope } = require(path.join(__dirname, '..', 'lib', 'conversation'));
const STORIES = require(path.join(__dirname, '..', 'stories.json'));
const CORPUS = require(path.join(__dirname, '..', 'corpus.json'));

let passed = 0, failed = 0;
function check(label, ok) {
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}`); failed++; }
}
const scope = (query, history) => resolveConversationScope({ query, history, stories: STORIES });
const u = content => ({ role: 'user', content });
const a = content => ({ role: 'assistant', content });

const INVEST = [
  u("Tell me about Blue Pearl's investment-reporting project"),
  a('Blue Pearl [S1] used IBM Bob to replace a 30,000-line VBA investment reporting workflow in four weeks, cutting daily processing time by more than 90%.')
];

console.log('\nproject-aware follow-ups');
let s = scope('What was the delivery timeline?', INVEST);
check('Blue Pearl investment follow-up pins the investment project', s && s.project && s.project.key === 'bluepearl-investment-reporting');
check('scope is restricted to story 59', s && s.storyIds.size === 1 && s.storyIds.has(59));

const invChunks = CORPUS.filter(c => s.storyIds.has(c.storyId) && s.project.chunkFilter(c));
check('investment chunks exist', invChunks.length > 0);
check('investment chunks exclude BookiePrice six-weeks transcript chunk', !invChunks.some(c => /six weeks/i.test(c.text)));
check('investment chunks include the four-week figure', invChunks.some(c => /four weeks/i.test(c.text)));
check('investment chunks exclude BookiePrice-only article chunk', !invChunks.some(c => c.source === 'article' && c.chunkIndex === 3));

const BOOKIE = [u('Tell me about the BookiePrice project'), a('BookiePrice is a separate Blue Pearl wagering application evaluation.')];
s = scope('What was the delivery timeline?', BOOKIE);
check('BookiePrice follow-up pins BookiePrice', s && s.project && s.project.key === 'bluepearl-bookieprice');
const bookChunks = CORPUS.filter(c => s.storyIds.has(c.storyId) && s.project.chunkFilter(c));
check('BookiePrice chunks include the six-weeks figure', bookChunks.some(c => /six weeks/i.test(c.text)));
check('BookiePrice chunks exclude article chunk 2 (four-week investment figure)', !bookChunks.some(c => c.source === 'article' && c.chunkIndex === 2));

s = scope('What was the delivery timeline?', [u('Tell me about Novadoc'), a('Novadoc [S1] used IBM Bob to build a FileNet solution over a weekend.')]);
check('company-level follow-up scopes to that company\'s stories', s && !s.project && s.company === 'Novadoc' && s.storyIds.has(18));

s = scope('What was the delivery timeline?', [u('Tell me about Blue Pearl'), a('Blue Pearl [S1] built a repeatable modernization practice.')]);
check('company with several projects but no project named scopes to all company stories', s && !s.project && s.storyIds.has(17) && s.storyIds.has(59));

console.log('\ncases that must not be scoped');
check('no history', scope('What was the delivery timeline?', []) === null);
check('explicit company in query', scope('What was the Novadoc delivery timeline?', INVEST) === null);
check('explicit project in query', scope('What was the BookiePrice timeline?', INVEST) === null);
check('library-wide question', scope('Which stories mention a short timeline?', INVEST) === null);
check('non-follow-up phrasing', scope('Hello there', INVEST) === null);
check('several companies in latest answer is ambiguous', scope('What was the delivery timeline?', [u('Compare them'), a('Novadoc and Blue Pearl both used IBM Bob.')]) === null);

const MOVED = [
  u("Tell me about Blue Pearl's investment-reporting project"),
  a('Blue Pearl [S1] replaced a VBA investment reporting workflow in four weeks.'),
  u('Now tell me about Novadoc'),
  a('Novadoc [S1] built a FileNet solution over a weekend.')
];
s = scope('What was the delivery timeline?', MOVED);
check('switching topics moves scope to the latest company', s && s.company === 'Novadoc' && !s.project);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
