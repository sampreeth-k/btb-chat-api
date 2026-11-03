'use strict';
// Deterministic "which stories cover <topic>" lookup, used for link / list requests
// about capabilities that retrieval ranks poorly (multi-cloud, multi-model).
// Matching is done on narrative fields only (not hidden searchText), so a story is
// listed only when its own text supports the topic.

const MULTI_CLOUD_Q = /multi[\s-]?cloud|cross[\s-]?cloud|multiple clouds/i;
const MULTI_MODEL_Q = /multi[\s-]?model|multiple (?:ai |llm |foundation |language )?models|choice of (?:ai |llm |foundation )?models|model (?:choice|flexibility)|(?:any|different) (?:llm|model)s?\b/i;

const MULTI_CLOUD_TEXT = /multi[\s-]?cloud|multiple clouds|\bcross[\s-]?cloud|across (?:multiple |several |different )?clouds/i;
const MULTI_MODEL_PHRASE = /\bmodel providers\b|multiple (?:ai |llm |foundation |language )?models|model[\s-]agnostic|(?:any|different) (?:llm|model)s?\b/i;

const MODEL_FAMILIES = [
  ['Granite', /granite/i], ['Llama', /llama/i], ['Mistral', /mistral|mixtral/i],
  ['Claude', /claude|anthropic/i], ['GPT', /\bgpt|chatgpt|openai/i],
  ['Gemini', /gemini/i], ['DeepSeek', /deepseek/i], ['Qwen', /qwen/i]
];

const LINK_RE = /\b(links?|urls?)\b/i;
const LIST_RE = /\b(which|what|list|show|share|find|give|any)\b[^?.!]*\b(stories|story|customers?|companies|case studies|examples)\b/i;

const isRollup = s => (s.story_type || '').toLowerCase().trim() === 'rollup / insight';

function fields(s) {
  const sm = s.summary && typeof s.summary === 'object' ? s.summary : {};
  return [s.title, s.businessChallenge, s.description, s.executiveSummary, s.businessOutcome,
    sm.headline, sm.challenge, ...(Array.isArray(sm.solution) ? sm.solution : []),
    ...(Array.isArray(sm.key_outcomes) ? sm.key_outcomes : []),
    ...(s.outcomes || []), ...(s.useCases || []), ...(s.proofPoints || []),
    ...(s.technologies || []), ...(s.themes || []), ...(s.tags || []), ...(s.products || [])]
    .filter(x => typeof x === 'string' && x.trim());
}

// Shows the sentence containing the match, cut on word boundaries, so the reader
// sees why the story is listed.
function snippet(text, re, max = 190) {
  const t = text.replace(/\s+/g, ' ').trim();
  let s = t.split(/(?<=[.!?])\s+/).find(x => re.test(x)) || t;
  s = s.replace(/[.;:,]+$/, '');
  if (s.length <= max) return s;
  const m = s.match(re);
  let from = Math.max(0, (m ? m.index : 0) - Math.floor(max / 2));
  if (from > 0) { const sp = s.indexOf(' ', from); from = sp === -1 ? from : sp + 1; }
  let end = Math.min(s.length, from + max);
  if (end < s.length) { const sp = s.lastIndexOf(' ', end); end = sp > from ? sp : end; }
  return (from > 0 ? '…' : '') + s.slice(from, end).trim() + (end < s.length ? '…' : '');
}

function multiCloudEvidence(s) {
  const hit = fields(s).find(f => MULTI_CLOUD_TEXT.test(f));
  return hit ? snippet(hit, MULTI_CLOUD_TEXT) : null;
}

function multiModelEvidence(s) {
  // 1. An explicit statement about multiple models or model providers
  const hit = fields(s).find(f => MULTI_MODEL_PHRASE.test(f));
  if (hit) return snippet(hit, MULTI_MODEL_PHRASE);
  // 2. Otherwise the story must name two or more model families
  const named = MODEL_FAMILIES.filter(([, re]) => re.test(fields(s).join(' | '))).map(([n]) => n);
  return named.length >= 2 ? `Names several AI models: ${named.join(', ')}` : null;
}

const TOPICS = [
  { key: 'multi-cloud', label: 'Multi-cloud', query: MULTI_CLOUD_Q, evidence: multiCloudEvidence },
  { key: 'multi-model', label: 'Multiple AI models', query: MULTI_MODEL_Q, evidence: multiModelEvidence }
];

function mentionsCompany(query, stories) {
  const q = query.toLowerCase();
  return stories.some(s => (s.company || '').toLowerCase().split(/\s+/)
    .some(t => t.length >= 4 && new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(q)));
}

/**
 * Returns { topics: [{key,label,customers:[{story,evidence}],overviews:[...]}], both: [...] }
 * when the query asks to list/link stories for a known topic, otherwise null.
 */
function detectTopicQuery(query, stories) {
  const wanted = TOPICS.filter(t => t.query.test(query));
  if (!wanted.length) return null;
  if (!LINK_RE.test(query) && !LIST_RE.test(query)) return null;
  if (mentionsCompany(query, stories)) return null;

  const topics = wanted.map(t => {
    const hits = [];
    for (const story of stories) {
      const evidence = t.evidence(story);
      if (evidence) hits.push({ story, evidence });
    }
    return {
      key: t.key, label: t.label,
      customers: hits.filter(h => !isRollup(h.story)),
      overviews: hits.filter(h => isRollup(h.story))
    };
  });
  if (topics.every(t => !t.customers.length && !t.overviews.length)) return null;

  let both = [];
  if (topics.length > 1) {
    const sets = topics.map(t => new Set(t.customers.map(h => h.story.id)));
    both = topics[0].customers.filter(h => sets.every(s => s.has(h.story.id))).map(h => h.story);
  }
  return { topics, both };
}

function formatTopicAnswer(result, makeCitKey) {
  const line = h => `• [${makeCitKey(h.story.id)}] ${h.story.company} — ${h.evidence}`;
  const blocks = result.topics.map(t => {
    const head = `${t.label}: ${t.customers.length} customer ${t.customers.length === 1 ? 'story' : 'stories'}` +
      (t.overviews.length ? ` and ${t.overviews.length} overview ${t.overviews.length === 1 ? 'article' : 'articles'}` : '');
    const parts = [head];
    if (t.customers.length) parts.push(...t.customers.map(line));
    if (t.overviews.length) { parts.push('Overview articles:'); parts.push(...t.overviews.map(line)); }
    if (!t.customers.length && !t.overviews.length) parts.push('No story in the library states this.');
    return parts.join('\n');
  });
  if (result.topics.length > 1) {
    blocks.push(result.both.length
      ? 'Covering both: ' + result.both.map(s => `[${makeCitKey(s.id)}] ${s.company}`).join(', ')
      : 'No single customer story above is listed under both topics.');
  }
  return blocks.join('\n\n');
}

function topicStories(result) {
  const seen = new Set(); const out = [];
  for (const t of result.topics) for (const h of [...t.customers, ...t.overviews])
    if (!seen.has(h.story.id)) { seen.add(h.story.id); out.push(h.story); }
  return out;
}

module.exports = { detectTopicQuery, formatTopicAnswer, topicStories };
