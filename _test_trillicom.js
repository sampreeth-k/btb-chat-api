'use strict';
const https = require('https');

function post(query) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ query, top_k: 5 });
    const req = https.request({
      hostname: 'btb-chat-api-prod.2g0btkmn4dz6.us-south.codeengine.appdomain.cloud', port: 443,
      path: '/v1/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    req.setTimeout(60000); req.on('error', rej); req.write(body); req.end();
  });
}

const QUERIES = [
  // Direct name lookups
  'TrilliCom IBM Bob',
  'Ask@Lori',
  // Productivity / developer angle
  'doubled coding productivity with IBM Bob',
  'IBM Bob developer productivity',
  // Financial services / lending angle
  'SBA loan document processing AI',
  'loan reconciliation AI minutes instead of hours',
  // Document intelligence angle
  'scanned PDFs to workbooks financial calculations',
  'document intelligence for lending compliance',
  // Generic IBM Bob
  'IBM Bob customer stories',
  // IBM partner angle
  'IBM partner built AI for lending',
];

(async () => {
  console.log('Testing ' + QUERIES.length + ' TrilliCom-targeted queries against live API...\n');
  console.log('='.repeat(72));

  let trilliHits = 0, otherHits = 0, noContext = 0;

  for (const q of QUERIES) {
    process.stdout.write(`\nQ: "${q}"\n`);
    let d;
    try { d = await post(q); } catch (err) { console.log('  ERROR:', err.message); continue; }

    const mode    = d.answer_mode || '?';
    const sources = (d.sources || []);
    const companies = sources.map(s => s.company || s.id || '?');
    const clips   = d.proof_clips || [];

    if (mode === 'no_context') {
      noContext++;
      console.log('  âœ— no_context â€” retriever found nothing');
      continue;
    }

    const hitsTrilliCom = companies.some(c =>
      c && (c.toLowerCase().includes('trillicom') || c.toLowerCase().includes('trilli'))
    );

    if (hitsTrilliCom) {
      trilliHits++;
      console.log('  âœ“ TrilliCom FOUND  [mode=' + mode + ']');
    } else {
      otherHits++;
      console.log('  ~ TrilliCom NOT in top results [mode=' + mode + ']');
    }

    console.log('  sources  : ' + (companies.join(', ') || '(none)'));
    if (d.answer) {
      const snippet = d.answer.replace(/\n+/g, ' ').slice(0, 200);
      console.log('  answer   : ' + snippet + (d.answer.length > 200 ? 'â€¦' : ''));
    }
    if (clips.length) {
      clips.forEach(c => {
        console.log('  clip     : [' + c.company + ' / ' + c.strength + '] "' + c.quote.slice(0, 90) + '"');
      });
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY  (' + QUERIES.length + ' queries):');
  console.log('  TrilliCom in results : ' + trilliHits + ' / ' + QUERIES.length);
  console.log('  Other story returned : ' + otherHits  + ' / ' + QUERIES.length);
  console.log('  No context           : ' + noContext  + ' / ' + QUERIES.length);
})();
