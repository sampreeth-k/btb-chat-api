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
 * @returns null when the query is not a context-dependent follow-up, or the
 * active scope is ambiguous; otherwise
 * { company, label, storyIds:Set, project?:{key,label,chunkRe} }
 */
function resolveConversationScope({ query, history, stories }) {
  if (!Array.isArray(history) || !history.length) return null;
  if (NEW_TOPIC_RE.test(query) || !FOLLOWUP_RE.test(query)) return null;

  const companies = [...new Set(stories.map(s => s.company).filter(c => c && !/^IBM\b/i.test(c)))];
  const mentions = text => companies.filter(c => has(text, c));
  const projectsIn = text => PROJECTS
    .map(p => ({ p, idx: String(text).search(p.match) }))
    .filter(x => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  // An explicit company or project in the question is not a context-dependent follow-up.
  if (mentions(query).length || projectsIn(query).length) return null;

  const storyScope = company => {
    const ids = stories.filter(s => s.company === company).map(s => s.id);
    return { company, label: company, storyIds: new Set(ids) };
  };
  const projectScope = p => {
    const company = projectCompany(p, stories);
    return {
      company, label: `${company} ${p.label}`, storyIds: new Set(p.storyIds),
      project: { key: p.key, label: p.label, chunkFilter: p.chunkFilter || null }
    };
  };

  let company = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const { role, content } = history[i];
    const comps = mentions(content);
    if (!company && comps.length > 1) return null; // several companies discussed: ambiguous
    let projs = projectsIn(content);
    if (company) projs = projs.filter(x => projectCompany(x.p, stories) === company);
    if (!company && projs.length && comps.length === 1 && projectCompany(projs[0].p, stories) !== comps[0]) projs = [];

    if (projs.length) {
      // A user message naming several projects is ambiguous; an assistant answer
      // leads with its primary project, so the earliest mention wins.
      if (role === 'user' && projs.length > 1) return storyScope(company || projectCompany(projs[0].p, stories));
      return projectScope(projs[0].p);
    }
    if (company && comps.length && !comps.includes(company)) break; // earlier turn moved to another company
    if (!company && comps.length === 1) company = comps[0];
  }
  return company ? storyScope(company) : null;
}

module.exports = { PROJECTS, resolveConversationScope };
