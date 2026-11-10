/**
 * test/conversation.test.js — deterministic tests for project-aware follow-ups
 *
 * Run with: node test/conversation.test.js
 * Any failure exits with code 1.
 */

'use strict';

const path = require('path');
const { resolveConversationScope, chunkProjectLabel, explicitProjectsIn, scopeForProjects, namedCompanyStoryIds } = require(path.join(__dirname, '..', 'lib', 'conversation'));
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
check('explicit company with no project context in history', scope("What was Novadoc's delivery timeline?", [u('Tell me about Zurich'), a('Zurich Insurance Group [S1] ...')]) === null);
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

console.log('\nfrontend-rewritten wording (company named explicitly)');
s = scope("What was Blue Pearl's delivery timeline?", INVEST);
check("explicit company + investment history still pins the investment project", s && s.project && s.project.key === 'bluepearl-investment-reporting');
s = scope("What was Blue Pearl's delivery timeline?", BOOKIE);
check("explicit company + BookiePrice history pins BookiePrice", s && s.project && s.project.key === 'bluepearl-bookieprice');
s = scope("What was Novadoc's delivery timeline?", INVEST);
check('explicit other company is not captured by the earlier project', s === null);

console.log('\nambiguity');
const BOTH = [
  u('Compare the investment reporting project and the BookiePrice project for Blue Pearl'),
  a('Blue Pearl [S1] ran an investment reporting project and a BookiePrice evaluation.')
];
s = scope('What was the delivery timeline?', BOTH);
check('user naming both projects yields a clarification', s && s.ambiguous === true && s.options.length === 2);
s = scope("What was Blue Pearl's delivery timeline?", BOTH);
check('clarification also when the company is named explicitly', s && s.ambiguous === true);
s = scope('What was the delivery timeline?', [u("Tell me about Blue Pearl's investment-reporting project"), a('It took four weeks. This is distinct from the BookiePrice evaluation.')]);
check('assistant contrasting a sibling project does not make it ambiguous', s && s.project && s.project.key === 'bluepearl-investment-reporting');
s = scope('What was the delivery timeline?', [u('Tell me about Blue Pearl'), a('Blue Pearl has an investment reporting project and a BookiePrice evaluation.')]);
check('assistant answer covering both projects after a generic ask is ambiguous', s && s.ambiguous === true);

console.log('\nprompt project labels');
const c59 = CORPUS.filter(c => c.storyId === 59);
const labelOf = (src, idx) => chunkProjectLabel(c59.find(c => c.source === src && c.chunkIndex === idx));
check('investment article chunk labelled investment reporting', /investment reporting/.test(labelOf('article', 0)));
check('BookiePrice article chunk labelled BookiePrice', /BookiePrice/.test(labelOf('article', 3)));
check('nine-month/six-week interview chunk labelled BookiePrice', /BookiePrice/.test(labelOf('transcript_btb_interview', 11)));
check('non-Blue-Pearl chunks are not labelled', chunkProjectLabel(CORPUS.find(c => c.storyId !== 59 && c.storyId !== 17)) === '');
check('chunks outside multi-project stories are not labelled', chunkProjectLabel({ storyId: 17, source: 'article', text: 'x' }) === '');

console.log('\nstandalone project questions');
const keys = q => explicitProjectsIn(q, STORIES).map(p => p.key);
check('BookiePrice developer-count question names the BookiePrice project',
  keys('How many developers did Blue Pearl need for the BookiePrice project?').join() === 'bluepearl-bookieprice');
check('"senior developers ... BookiePrice modernization" names the BookiePrice project without the company',
  keys('How many senior developers were on the BookiePrice modernization?').join() === 'bluepearl-bookieprice');
check('comparison names both Blue Pearl projects',
  keys('Compare Blue Pearl investment reporting and BookiePrice projects').join() === 'bluepearl-investment-reporting,bluepearl-bookieprice');
check('"investment firm" in a library-wide question is not treated as Blue Pearl',
  keys('Which customers built something for an investment firm?').length === 0);
check('a question that names only the company names no project', keys('Tell me about Blue Pearl').length === 0);

const bp = () => CORPUS.filter(x => x.storyId === 59);
const one = scopeForProjects(explicitProjectsIn('How many developers for BookiePrice?', STORIES), STORIES);
check('BookiePrice scope keeps the "14 senior developers" excerpt', bp().filter(one.chunkFilter).some(c => /14 senior developers/.test(c.text)));
check('BookiePrice scope is a single project on story 59', one.project && one.project.key === 'bluepearl-bookieprice' && one.storyIds.has(59) && !one.storyIds.has(17));

const two = scopeForProjects(explicitProjectsIn('Compare Blue Pearl investment reporting and BookiePrice', STORIES), STORIES);
check('comparison scope lists both projects and never pulls in the Java story (17)',
  two.projects.length === 2 && two.storyIds.has(59) && !two.storyIds.has(17));
check('each compared project has its own excerpts', two.projects.every(p => bp().some(c => p.matches(c))));

console.log('\nnamed customer scoping');
const named = q => [...namedCompanyStoryIds(q, STORIES)].sort((x, y) => x - y);
check('"ACS" names only the Anya Consultancy Services story (65), not Shorthills AI', named('Tell me about ACS').join() === '65');
check('full name names story 65 only', named('What results did Anya Consultancy Services achieve?').join() === '65');
check('a library-wide question names no customer', named('Which customers saw the biggest productivity gains?').length === 0);
check('"IBM ..." rollup pages are never a named customer', named('Tell me about IBM Bob').length === 0);
check('Blue Pearl names both of its stories', named('Tell me about Blue Pearl').join() === '17,59');


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
