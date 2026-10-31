#!/usr/bin/env node
// _test_suite.js — comprehensive BtB chatbot test suite
// Usage: node _test_suite.js [--verbose]
// Outputs a structured pass/fail report to stdout.

const https = require('https');

const API = 'https://btb-chat-api-prod.2g0btkmn4dz6.us-south.codeengine.appdomain.cloud';
const VERBOSE = process.argv.includes('--verbose');

// ── Ground truth ──────────────────────────────────────────────────────────────
const APAC_COMPANIES    = ['Blue Pearl','Swan Christian Education Association','Axis Bank','Thunai','Changi General Hospital'];
const EMEA_COMPANIES    = ['Migrato','Spark Compass','RBH Hospitality','SupPlant','Focal Systems','Cogniware','Novacomp','Novadoc','Dynamiq','RFEA','WealthAPI','Edsvaard','Mitie','Serre Chevalier','Wikimedia Deutschland','Frontkom','Zurich Insurance Group','IBM Bob'];
const AMER_COMPANIES    = ['TrilliCom','Fogel Law Group','CrushBank','Claims Connection Group','US Open / USTA','Fiducia AI','Knockri','ViClinic','Brighthive','FlexiVan','Avid Solutions','California DMV','Mitsubishi Motors North America','LifeBridge','General Assembly','Lumenore','MyLua Health','Athena Intelligence','AXA Brazil','Bud Financial','Bay Point Advisors','UNACEM','Beacon Mobility','Airy','Careerforce Pro','Shorthills AI','The Wave Group','Busie'];
const NOT_IBM_COMPANIES = ['Google','Microsoft','Salesforce','OpenAI','AWS','Amazon','Meta','Apple'];

// ── Test definitions ──────────────────────────────────────────────────────────
// Each test: { id, category, query, history?, checks: [fn(data) => {pass,reason}] }
const TESTS = [

  // ══ 1. REGION TESTS ══════════════════════════════════════════════════════════
  {
    id: 'R01', category: 'Region', query: 'Which stories come from APAC?',
    checks: [
      d => ({ pass: d.sources && d.sources.every(s => APAC_COMPANIES.some(c => s.company.includes(c) || c.includes(s.company))),
              reason: 'All sources must be APAC companies. Got: ' + (d.sources||[]).map(s=>s.company).join(', ') }),
      d => ({ pass: !d.sources || !d.sources.some(s => AMER_COMPANIES.some(c => s.company.includes(c))),
              reason: 'No AMER companies should appear. Got: ' + (d.sources||[]).map(s=>s.company).join(', ') }),
      d => ({ pass: d.sources && d.sources.length >= 1, reason: 'Must return at least 1 source' }),
    ]
  },
  {
    id: 'R02', category: 'Region', query: 'Show me stories from Australia',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Blue Pearl') || s.company.includes('Swan')),
              reason: 'Must include Blue Pearl or Swan (Australian companies)' }),
      d => ({ pass: !d.sources || !d.sources.some(s => AMER_COMPANIES.some(c => c === s.company)),
              reason: 'No AMER companies in Australia query' }),
    ]
  },
  {
    id: 'R03', category: 'Region', query: 'Which stories come from Europe or EMEA?',
    checks: [
      d => ({ pass: d.sources && d.sources.every(s => EMEA_COMPANIES.some(c => s.company.includes(c) || c.includes(s.company)) || s.company === 'IBM'),
              reason: 'All sources must be EMEA. Got: ' + (d.sources||[]).map(s=>s.company).join(', ') }),
      d => ({ pass: !d.sources || !d.sources.some(s => AMER_COMPANIES.some(c => c === s.company)),
              reason: 'No AMER companies in EMEA query' }),
    ]
  },
  {
    id: 'R04', category: 'Region', query: 'Stories from the United States or Americas',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => AMER_COMPANIES.some(c => s.company.includes(c))),
              reason: 'Must return AMER stories' }),
      d => ({ pass: !d.sources || !d.sources.some(s => APAC_COMPANIES.some(c => c === s.company)),
              reason: 'No APAC companies in AMER query' }),
    ]
  },
  {
    id: 'R05', category: 'Region', query: 'Which stories come from Singapore or India?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Thunai') || s.company.includes('Axis Bank')),
              reason: 'Must include Thunai (Singapore) or Axis Bank (India)' }),
      d => ({ pass: !d.sources || !d.sources.some(s => AMER_COMPANIES.some(c => c === s.company)),
              reason: 'No AMER companies in Singapore/India query' }),
    ]
  },

  // ══ 2. PRODUCT TESTS ═════════════════════════════════════════════════════════
  {
    id: 'P01', category: 'Product', query: 'Which customers use IBM Bob?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['TrilliCom','Migrato','CrushBank','Novacomp','Novadoc','Blue Pearl','Avid Solutions'].some(c => s.company.includes(c))),
              reason: 'Must include at least one IBM Bob customer' }),
    ]
  },
  {
    id: 'P02', category: 'Product', query: 'Show me stories using watsonx Orchestrate',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Claims Connection Group','ViClinic','Brighthive','LifeBridge','Swan Christian','Knockri','MyLua Health'].some(c => s.company.includes(c))),
              reason: 'Must return watsonx Orchestrate customers' }),
      d => ({ pass: d.answer && /orchestrate/i.test(d.answer), reason: 'Answer must mention Orchestrate' }),
    ]
  },
  {
    id: 'P03', category: 'Product', query: 'Which stories feature IBM Instana?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Lumenore') || s.company.includes('Mitsubishi')),
              reason: 'Must return Lumenore or Mitsubishi (Instana customers)' }),
    ]
  },
  {
    id: 'P04', category: 'Product', query: 'Stories using watsonx.data',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Cogniware','Shorthills AI','Wikimedia','Bud Financial','WealthAPI'].some(c => s.company.includes(c))),
              reason: 'Must return watsonx.data customers' }),
    ]
  },
  {
    id: 'P05', category: 'Product', query: 'Which customers use IBM Cloud Code Engine?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('TrilliCom') || s.company.includes('Fogel') || s.company.includes('Changi')),
              reason: 'Must return Code Engine customers (TrilliCom, Fogel, Changi)' }),
    ]
  },
  {
    id: 'P06', category: 'Product', query: 'Show me webMethods stories',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('FlexiVan') || s.company.includes('AXA')),
              reason: 'Must return FlexiVan or AXA Brazil (webMethods customers)' }),
    ]
  },

  // ══ 3. THEME / USE CASE TESTS ════════════════════════════════════════════════
  {
    id: 'T01', category: 'Theme', query: 'What are the best examples of agentic AI?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Thunai','Claims Connection Group','ViClinic','Brighthive','LifeBridge','Knockri'].some(c => s.company.includes(c))),
              reason: 'Must return at least one core agentic AI story' }),
      d => ({ pass: d.sources && d.sources.length >= 3, reason: 'Should return multiple agentic examples' }),
    ]
  },
  {
    id: 'T02', category: 'Theme', query: 'Which customers modernised legacy systems?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['California DMV','Migrato','CrushBank','Novacomp'].some(c => s.company.includes(c))),
              reason: 'Must return modernisation stories (DMV, Migrato, CrushBank)' }),
    ]
  },
  {
    id: 'T03', category: 'Theme', query: 'Show me developer productivity stories',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['TrilliCom','Blue Pearl','Migrato','CrushBank'].some(c => s.company.includes(c))),
              reason: 'Must return developer productivity stories' }),
    ]
  },
  {
    id: 'T04', category: 'Theme', query: 'Which customers reduced costs with IBM AI?',
    checks: [
      d => ({ pass: d.sources && d.sources.length >= 1, reason: 'Must return at least one result' }),
      d => ({ pass: d.answer && d.answer.length > 50, reason: 'Answer must be substantive' }),
    ]
  },
  {
    id: 'T05', category: 'Theme', query: 'Sports fan engagement and AI',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('USTA') || s.company.includes('Spark Compass')),
              reason: 'Must return USTA or Spark Compass for sports AI query' }),
    ]
  },
  {
    id: 'T06', category: 'Theme', query: 'Stories about data governance and AI compliance',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Knockri','Careerforce Pro','Spark Compass','Cogniware'].some(c => s.company.includes(c))),
              reason: 'Must return governance-focused stories' }),
    ]
  },

  // ══ 4. ROI / PROOF POINT TESTS ═══════════════════════════════════════════════
  {
    id: 'ROI01', category: 'ROI', query: 'Which stories show the fastest time to value?',
    checks: [
      d => ({ pass: d.sources && d.sources.length >= 3, reason: 'Should return multiple examples' }),
      d => ({ pass: d.answer && /\d/.test(d.answer), reason: 'Answer should contain at least one number/metric' }),
    ]
  },
  {
    id: 'ROI02', category: 'ROI', query: 'Show me stories with strong ROI proof points I can use in a pitch',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Blue Pearl') || s.company.includes('California DMV') || s.company.includes('USTA')),
              reason: 'Must return high-ROI stories (Blue Pearl 500% ROI, DMV 85% faster, USTA 14M uniques)' }),
      d => ({ pass: d.proof_clips && d.proof_clips.length >= 1, reason: 'Should include proof clips for pitch use' }),
    ]
  },
  {
    id: 'ROI03', category: 'ROI', query: 'Which customers improved processing speed or reduced time?',
    checks: [
      d => ({ pass: d.sources && d.sources.length >= 2, reason: 'Multiple time-reduction stories exist' }),
      d => ({ pass: d.answer && /\d/.test(d.answer), reason: 'Should cite specific time metrics' }),
    ]
  },

  // ══ 5. INDUSTRY TESTS ════════════════════════════════════════════════════════
  {
    id: 'I01', category: 'Industry', query: 'Show me healthcare stories',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Changi General Hospital','ViClinic','MyLua Health'].some(c => s.company.includes(c))),
              reason: 'Must return healthcare stories (Changi, ViClinic, MyLua)' }),
    ]
  },
  {
    id: 'I02', category: 'Industry', query: 'Which stories are from financial services?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Cogniware','Bud Financial','Bay Point Advisors','AXA Brazil','Axis Bank','Blue Pearl'].some(c => s.company.includes(c))),
              reason: 'Must return financial services stories' }),
    ]
  },
  {
    id: 'I03', category: 'Industry', query: 'Show me legal tech stories',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Fogel Law Group','Dynamiq','Shorthills AI'].some(c => s.company.includes(c))),
              reason: 'Must return legal tech stories' }),
    ]
  },
  {
    id: 'I04', category: 'Industry', query: 'Government and public sector AI stories',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['California DMV','RFEA','Frontkom','Avid Solutions'].some(c => s.company.includes(c))),
              reason: 'Must return public sector stories' }),
    ]
  },
  {
    id: 'I05', category: 'Industry', query: 'Stories from the insurance industry',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => ['Claims Connection Group','LifeBridge','AXA Brazil','Zurich Insurance'].some(c => s.company.includes(c))),
              reason: 'Must return insurance stories' }),
    ]
  },

  // ══ 6. MULTI-TURN FOLLOW-UP TESTS ════════════════════════════════════════════
  {
    id: 'MT01', category: 'Multi-turn', query: 'Tell me more about Blue Pearl',
    history: [{ role:'user', content:'Which stories come from APAC?' }, { role:'assistant', content:'Blue Pearl [CIT:story-59], Swan Christian Education Association [CIT:story-41], Changi General Hospital [CIT:story-56] and Thunai [CIT:story-53] are the APAC stories in the library.' }],
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Blue Pearl')),
              reason: 'Follow-up must focus on Blue Pearl' }),
      d => ({ pass: d.answer && /blue pearl/i.test(d.answer), reason: 'Answer must mention Blue Pearl' }),
      d => ({ pass: !d.sources || !d.sources.some(s => AMER_COMPANIES.some(c => c === s.company)),
              reason: 'Should not pull in unrelated AMER stories' }),
    ]
  },
  {
    id: 'MT02', category: 'Multi-turn', query: 'What was Blue Pearl\'s ROI?',
    history: [{ role:'user', content:'Tell me about Blue Pearl' }, { role:'assistant', content:'Blue Pearl [CIT:story-59] projected 500% first-year ROI after IBM Bob helped reduce daily processing time by 90%.' }],
    checks: [
      d => ({ pass: d.answer && (/blue pearl/i.test(d.answer) || /500|roi|return on investment/i.test(d.answer)),
              reason: 'Follow-up ROI question should return Blue Pearl ROI. Got: ' + (d.answer||'').slice(0,100) }),
    ]
  },
  {
    id: 'MT03', category: 'Multi-turn', query: 'What about Lumenore?',
    history: [{ role:'user', content:'Which APAC stories are there?' }, { role:'assistant', content:'The APAC stories are Blue Pearl, Swan Christian Education Association, Changi General Hospital, Thunai and Axis Bank.' }],
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Lumenore')),
              reason: 'Lumenore question should return Lumenore even though prior context was APAC' }),
      d => ({ pass: d.answer && /lumenore/i.test(d.answer), reason: 'Answer must mention Lumenore' }),
    ]
  },

  // ══ 7. OUT-OF-SCOPE / REFUSAL TESTS ══════════════════════════════════════════
  {
    id: 'OOS01', category: 'Out-of-scope', query: 'What is the capital of France?',
    checks: [
      d => ({ pass: d.answer && /don't have enough context|not about IBM|try searching/i.test(d.answer),
              reason: 'Must refuse geography question' }),
    ]
  },
  {
    id: 'OOS02', category: 'Out-of-scope', query: 'Write me a poem about summer',
    checks: [
      // Guard fires OR Granite declines — either is acceptable; must NOT return a real poem
      d => ({ pass: !d.answer || /don't have enough context|not about IBM|try searching|I don't|no customer stories|couldn't find/i.test(d.answer) || (d.answer_mode === 'out_of_scope'),
              reason: 'Must refuse creative writing — got: ' + (d.answer||'').slice(0,100) }),
    ]
  },
  {
    id: 'OOS03', category: 'Out-of-scope', query: 'What do you think about Microsoft Azure?',
    checks: [
      d => ({ pass: !d.answer || d.answer.trim() === '' || /don't have enough context|not about IBM|try searching|I don't|couldn't find/i.test(d.answer) || (d.answer_mode === 'out_of_scope'),
              reason: 'Must refuse competitor question — got: ' + (d.answer||'').slice(0,100) }),
    ]
  },
  {
    id: 'OOS04', category: 'Out-of-scope', query: 'How do I cook pasta?',
    checks: [
      d => ({ pass: !d.answer || d.answer.trim() === '' || /don't have enough context|not about IBM|try searching|I don't|couldn't find/i.test(d.answer) || (d.answer_mode === 'out_of_scope'),
              reason: 'Must refuse cooking query — got: ' + (d.answer||'').slice(0,100) }),
    ]
  },
  {
    id: 'OOS05', category: 'Out-of-scope', query: 'What is IBM stock price today?',
    checks: [
      d => ({ pass: !d.answer || /don't have enough context|not about IBM|try searching|I don't|couldn't find|stock price/i.test(d.answer) || (d.answer_mode === 'out_of_scope'),
              reason: 'Must refuse stock price query — got: ' + (d.answer||'').slice(0,100) }),
    ]
  },

  // ══ 8. EDGE CASE TESTS ═══════════════════════════════════════════════════════
  {
    id: 'E01', category: 'Edge case', query: 'watsonx',
    checks: [
      d => ({ pass: d.sources && d.sources.length >= 1, reason: 'Single product keyword must return results' }),
    ]
  },
  {
    id: 'E02', category: 'Edge case', query: 'Show me all stories about CrushBank',
    checks: [
      d => ({ pass: d.sources && d.sources.every(s => s.company.includes('CrushBank')),
              reason: 'Specific company query should return only CrushBank stories' }),
      d => ({ pass: d.sources && d.sources.length >= 2, reason: 'CrushBank has 2 stories — both should appear' }),
    ]
  },
  {
    id: 'E03', category: 'Edge case', query: 'Which stories have video interviews?',
    checks: [
      d => ({ pass: d.sources && d.sources.length >= 1, reason: 'Video query must return results' }),
      d => ({ pass: d.answer && d.answer.length > 30, reason: 'Answer must be substantive' }),
    ]
  },
  {
    id: 'E04', category: 'Edge case', query: 'Tell me about Migrato',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Migrato')),
              reason: 'Specific company query must return that company' }),
      d => ({ pass: d.answer && /migrato/i.test(d.answer), reason: 'Answer must mention Migrato' }),
    ]
  },
  {
    id: 'E05', category: 'Edge case', query: 'agentic AI healthcare insurance legal APAC ROI',
    checks: [
      d => ({ pass: d.sources && d.sources.length >= 1, reason: 'Multi-keyword query must return results' }),
      d => ({ pass: d.answer && d.answer.length > 50, reason: 'Answer must be substantive' }),
    ]
  },

  // ══ 9. SPECIFIC COMPANY ACCURACY TESTS ═══════════════════════════════════════
  {
    id: 'C01', category: 'Company accuracy', query: 'What did California DMV achieve with IBM?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('California DMV')),
              reason: 'Must return California DMV story' }),
      d => ({ pass: d.answer && (/85|15 month|5.year|million lines|cobol|assembler/i.test(d.answer)),
              reason: 'Answer must cite DMV-specific metrics (85% faster, 15 months, COBOL)' }),
    ]
  },
  {
    id: 'C02', category: 'Company accuracy', query: 'What is the Lumenore story about?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Lumenore')),
              reason: 'Must return Lumenore' }),
      d => ({ pass: d.answer && (/instana|mttd|5 min|41%|troubleshoot/i.test(d.answer)),
              reason: 'Answer must cite Lumenore metrics (MTTD, 5 min, 41%)' }),
    ]
  },
  {
    id: 'C03', category: 'Company accuracy', query: 'Tell me about the USTA US Open story',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('USTA')),
              reason: 'Must return USTA story' }),
      d => ({ pass: d.answer && (/14 million|slam.?tracker|fan|us open/i.test(d.answer)),
              reason: 'Answer must cite USTA-specific details (14M uniques, SlamTracker)' }),
    ]
  },
  {
    id: 'C04', category: 'Company accuracy', query: 'What did Changi General Hospital do with IBM?',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('Changi')),
              reason: 'Must return Changi General Hospital' }),
      d => ({ pass: d.answer && (/debrief|simulation|5.10 min|clinical|hospital/i.test(d.answer)),
              reason: 'Answer must cite Changi-specific details (debriefs, simulation)' }),
    ]
  },

  // ══ 10. HALLUCINATION GUARD TESTS ════════════════════════════════════════════
  {
    id: 'H01', category: 'Hallucination guard', query: 'What did Google achieve with IBM?',
    checks: [
      d => ({ pass: !d.answer || !/google/i.test(d.answer) || /don't have|not in the library|couldn't find/i.test(d.answer),
              reason: 'Must not fabricate a Google IBM story' }),
    ]
  },
  {
    id: 'H02', category: 'Hallucination guard', query: 'What did Apple achieve with watsonx?',
    checks: [
      d => ({ pass: !d.answer || !/apple.*watson|watson.*apple/i.test(d.answer) || /don't have|not in the library|couldn't find/i.test(d.answer),
              reason: 'Must not fabricate an Apple watsonx story' }),
    ]
  },
  {
    id: 'H03', category: 'Hallucination guard', query: 'Tell me about the TrilliCom story',
    checks: [
      d => ({ pass: d.sources && d.sources.some(s => s.company.includes('TrilliCom')),
              reason: 'TrilliCom is a real story — must return it. Sources: ' + (d.sources||[]).map(s=>s.company).join(', ') }),
      d => ({ pass: d.answer && /trillicom/i.test(d.answer), reason: 'Answer must mention TrilliCom. Got: ' + (d.answer||'').slice(0,100) }),
      d => ({ pass: !d.answer || !/blue pearl|lumenore|usta|crushbank/i.test(d.answer) || (d.answer.toLowerCase().indexOf('trillicom') < d.answer.toLowerCase().indexOf('blue pearl') || d.answer.toLowerCase().indexOf('blue pearl') === -1),
              reason: 'TrilliCom should be the primary focus' }),
    ]
  },
];

// ── HTTP helper ───────────────────────────────────────────────────────────────
function chatRequest(message, history) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message, history: history || [] });
    const opts = {
      hostname: 'btb-chat-api-prod.2g0btkmn4dz6.us-south.codeengine.appdomain.cloud',
      path: '/v1/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 45000,
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        if (!raw || raw.trim() === '' || raw.trim() === '{}') {
          reject(new Error('empty_response:' + res.statusCode + ':' + raw.slice(0,50)));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('JSON parse: ' + raw.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function pingWarm() {
  // Hit /health and wait for a real 200 — retries until warm (handles cold start)
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const ok = await new Promise((resolve) => {
        const opts = { hostname:'btb-chat-api-prod.2g0btkmn4dz6.us-south.codeengine.appdomain.cloud', path:'/health', method:'GET', timeout:20000 };
        const req = https.request(opts, res => {
          let raw = ''; res.resume();
          res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
      if (ok) { await sleep(300); return; } // confirmed warm
    } catch(e) { /* retry */ }
    await sleep(3000); // wait 3s between warm-up attempts
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function runAll() {
  const results = [];
  let passed = 0, failed = 0, errored = 0;

  // Group by category for ordered output
  const categories = [...new Set(TESTS.map(t => t.category))];

  for (const cat of categories) {
    const catTests = TESTS.filter(t => t.category === cat);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${cat.toUpperCase()} (${catTests.length} tests)`);
    console.log('═'.repeat(60));
    await pingWarm(); // keep container warm between categories

    for (const test of catTests) {
      let data, apiError;
      const start = Date.now();
      try {
        data = await chatRequest(test.query, test.history);
      } catch(e) {
        apiError = e.message;
        // On timeout/connection error, wait 3s and retry once (handles cold start mid-run)
        if (/timeout|ECONNRESET|ECONNREFUSED|empty_response/.test(apiError)) {
          await pingWarm();
          try { data = await chatRequest(test.query, test.history); apiError = null; }
          catch(e2) { apiError = e2.message; }
        }
      }
      // If API returned {"error":...} (container was starting up), retry after warm-up
      if (data && data.error && !data.answer) {
        await pingWarm();
        try { data = await chatRequest(test.query, test.history); apiError = null; }
        catch(e3) { apiError = e3.message; }
      }
      const ms = Date.now() - start;

      if (apiError) {
        errored++;
        console.log(`  ✗ [${test.id}] ERROR: ${apiError}`);
        results.push({ ...test, status: 'ERROR', error: apiError, ms });
        continue;
      }

      const checkResults = test.checks.map(fn => {
        try { return fn(data); }
        catch(e) { return { pass: false, reason: 'Check threw: ' + e.message }; }
      });

      const allPass = checkResults.every(r => r.pass);
      const failures = checkResults.filter(r => !r.pass);

      if (allPass) {
        passed++;
        console.log(`  ✓ [${test.id}] ${test.query.slice(0,60)} (${ms}ms)`);
      } else {
        failed++;
        console.log(`  ✗ [${test.id}] FAIL: ${test.query.slice(0,60)} (${ms}ms)`);
        failures.forEach(f => console.log(`       → ${f.reason}`));
        // Always show raw response on failure for diagnosis
        console.log(`       mode: ${data && data.answer_mode || 'n/a'} | sources: ${(data && data.sources||[]).map(s=>s.company).join(', ') || 'none'}`);
        console.log(`       answer: ${(data && data.answer||'[empty]').slice(0,150)}`);
        if (!data || (!data.answer && !data.answer_mode)) console.log(`       RAW DATA KEYS: ${data ? Object.keys(data).join(',') : 'null'} | error: ${data && data.error ? JSON.stringify(data.error).slice(0,100) : 'n/a'}`);
      }

      if (VERBOSE && allPass) {
        console.log(`       Answer: ${(data.answer||'').slice(0,120)}...`);
        console.log(`       Sources: ${(data.sources||[]).map(s=>s.company).join(', ')}`);
      }
      if (VERBOSE && !allPass) {
        console.log(`       Answer: ${(data.answer||'').slice(0,200)}...`);
        console.log(`       Sources: ${(data.sources||[]).map(s=>s.company).join(', ')}`);
      }

      results.push({ ...test, status: allPass ? 'PASS' : 'FAIL', failures, ms, data });
      await sleep(300); // small inter-test delay — single-instance container (max-scale=1)
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const total = passed + failed + errored;
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  FINAL RESULTS');
  console.log('═'.repeat(60));
  console.log(`  Total:   ${total}`);
  console.log(`  Passed:  ${passed} (${Math.round(passed/total*100)}%)`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Errored: ${errored}`);
  console.log('');

  if (failed > 0 || errored > 0) {
    console.log('  FAILURES SUMMARY:');
    results.filter(r => r.status !== 'PASS').forEach(r => {
      console.log(`  [${r.id}] ${r.category}: ${r.query.slice(0,60)}`);
      if (r.failures) r.failures.forEach(f => console.log(`    → ${f.reason}`));
      if (r.error)    console.log(`    → ERROR: ${r.error}`);
    });
  }

  console.log('═'.repeat(60));
  return { passed, failed, errored, results };
}

runAll().catch(console.error);
