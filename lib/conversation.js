/**
 * lib/conversation.js — project-aware follow-up scoping
 *
 * A follow-up such as "What was the delivery timeline?" names neither a company
 * nor a pronoun, so company-level history resolution cannot tell which story
 * (or which project inside a story) is being discussed. This module infers the
 * active story/project from bounded conversation history so retrieval can be
 * restricted to it. History is used ONLY to choose the scope; it is never
 * evidence.
 *
 * Pure functions, no I/O — unit-tested in test/conversation.test.js.
 */

'use strict';

// Projects that need to be told apart. `storyIds` are the stories that hold the
// project's evidence. `chunkFilter` is only needed when ONE story covers several
// projects (Blue Pearl story 59), so its corpus chunks can be filtered.
const PROJECTS = [
  {
    key: 'bluepearl-investment-reporting', storyIds: [59],
    label: 'investment reporting project',
    match: /investment[- ]report|investment firm|\bVBA\b|custodian/i,
    // Transcript chunks are the BookiePrice interview; keep only those that name the investment project.
    chunkFilter: c => c.source === 'article'
      ? /investment|\bVBA\b|custodian|workbook/i.test(c.text)
      : /investment[- ]report|investment firm/i.test(c.text)
  },
  {
    key: 'bluepearl-bookieprice', storyIds: [59],
    label: 'BookiePrice project',
    match: /bookie\s?price/i,
    // Article chunk 2 mixes in the investment project's four-week figure, so exclude it.
    chunkFilter: c => /bookie\s?price|nine[- ]month|any bet/i.test(c.text) && !/investment firm project/i.test(c.text)
  },
  {
    key: 'bluepearl-java-modernization', storyIds: [17],
    label: 'Java 11 to Java 21 modernization project',
    match: /java 11|java 21|security posture|outdated codebase/i
  },
  {
    key: 'migrato-bob-migration', storyIds: [43],
    label: 'Java 8 to C++ migration project',
    match: /java 8|c\+\+|bob migration/i
  },
  {
    key: 'migrato-hybrid-cloud', storyIds: [40],
    label: 'hybrid-architecture document insight project',
    match: /hybrid|document sprawl|document insight/i
  }
];

// Detail questions that only make sense about something already under discussion.
const FOLLOWUP_RE = /\b(timeline|timeframe|duration|how long|weeks?|months?|days?|roi|return on investment|savings?|cost|outcomes?|results?|metrics?|challenges?|team|developers?|technolog(y|ies)|architecture|benefits?|impact|delivery|delivered|tell me more|more detail|more about|elaborate)\b/i;
// Cues that the user is opening a new, library-wide question instead.
const NEW_TOPIC_RE = /\b(stories|story|customers?|companies|which|list|compare|other|another|any|all|every)\b/i;

const has = (text, name) => String(text).toLowerCase().includes(name.toLowerCase());

function projectCompany(project, stories) {
  const s = stories.find(x => x.id === project.storyIds[0]);
  return s ? s.company : null;
}

/**
 * Label a corpus chunk with the project it is about, for prompt construction.
 * Only stories that hold several projects with chunk filters (Blue Pearl, 59)
 * get a label; everything else returns ''. Used so the model can see which
 * project a figure belongs to and cannot silently merge two projects' metrics.
 */
function chunkProjectLabel(chunk) {
  const cands = PROJECTS.filter(p => p.chunkFilter && p.storyIds.includes(chunk.storyId));
  if (cands.length < 2) return '';
  const hit = cands.filter(p => p.chunkFilter(chunk));
  const lead = chunk.source && chunk.source !== 'article' ? 'Interview excerpt, mainly about project' : 'Project';
  if (hit.length === 1) return `${lead}: ${hit[0].label}`;
  if (hit.length > 1) return 'Excerpt covers several projects: attribute each figure only to the project it is stated for';
  return 'General commentary, not specific to one project';
}

/**
 * Decide which story/project a context-dependent follow-up is about.
 *
 * @returns
 *   null                                  - not a context-dependent follow-up, or no usable context
 *   { ambiguous:true, company, options }  - history covers several of the company's projects
 *   { company, label, storyIds:Set, project?:{key,label,chunkFilter} } - the active scope
 */
function resolveConversationScope({ query, history, stories }) {
  if (!Array.isArray(history) || !history.length) return null;
  if (NEW_TOPIC_RE.test(query) || !FOLLOWUP_RE.test(query)) return null;

  const companies = [...new Set(stories.map(s => s.company).filter(c => c && !/^IBM\b/i.test(c)))];
  const mentions = text => companies.filter(c => has(text, c));
  const projectsIn = text => PROJECTS.filter(p => p.match.test(String(text)));
  // Companies a message is about: named outright, or implied by a project it names.
  const companiesIn = text => [...new Set([...mentions(text), ...projectsIn(text).map(p => projectCompany(p, stories))])]
    .filter(Boolean);

  // An explicitly named project needs no help from history; retrieval handles it.
  if (projectsIn(query).length) return null;
  const inQuery = companiesIn(query);
  if (inQuery.length > 1) return null;
  const explicit = inQuery[0] || null;

  // 1. Which company? An explicit one wins; otherwise the most recent message that names one.
  let company = explicit;
  if (!company) {
    for (let i = history.length - 1; i >= 0 && !company; i--) {
      const found = companiesIn(history[i].content);
      if (found.length > 1) return null; // several companies discussed: ambiguous
      if (found.length === 1) company = found[0];
    }
  }
  if (!company) return null;

  // 2. Which of that company's projects? The user's own wording outranks an
  //    assistant answer, which may mention sibling projects only to contrast them.
  const candidates = PROJECTS.filter(p => projectCompany(p, stories) === company);
  const turns = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const found = companiesIn(history[i].content);
    if (found.length && !found.includes(company)) {
      if (explicit) continue;  // explicit company: skip unrelated turns
      break;                   // implicit: the conversation moved on to another company
    }
    turns.push(history[i]);
  }
  const named = role => {
    const turn = turns.find(t => t.role === role && candidates.some(p => p.match.test(t.content)));
    return turn ? candidates.filter(p => p.match.test(turn.content)) : [];
  };
  const projs = named('user').length ? named('user') : named('assistant');

  if (projs.length > 1) {
    return { ambiguous: true, company, options: projs.map(p => p.label) };
  }
  if (projs.length === 1) {
    const p = projs[0];
    return {
      company, label: `${company} ${p.label}`, storyIds: new Set(p.storyIds),
      project: { key: p.key, label: p.label, chunkFilter: p.chunkFilter || null }
    };
  }
  if (explicit) return null; // company named but no project context: normal retrieval
  const ids = stories.filter(s => s.company === company).map(s => s.id);
  return { company, label: company, storyIds: new Set(ids) };
}

module.exports = { PROJECTS, resolveConversationScope, chunkProjectLabel };
