'use strict';
const https = require('https');

function post(query) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ query, top_k: 4 });
    const req = https.request({
      hostname: 'btb-chat-api-prod.2g0btkmn4dz6.us-south.codeengine.appdomain.cloud', port: 443,
      path: '/v1/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    req.setTimeout(45000); req.on('error', rej); req.write(body); req.end();
  });
}

const QUERIES = [
  // Insurance / claims
  'AI for insurance claims processing',
  'customer story about automating policy review',
  // HR / hiring
  'reducing time to hire with AI',
  'AI bias reduction in recruitment',
  // Asset management / facilities
  'enterprise asset management with IBM',
  'facilities management digital transformation',
  // Sports / media
  'sports fan engagement and AI',
  'improving digital experience for live events',
  // Database / performance
  'database performance improvement',
  'open source database modernisation',
  // IT / automation
  'AI for IT service desk automation',
  'helpdesk ticket resolution with AI',
  // Logistics
  'logistics and supply chain visibility',
  'container shipping technology',
  // Fintech
  'fintech data platform migration',
  'banking AI data modernisation',
  // Document AI
  'document processing with AI',
  'intelligent document understanding',
];

let withClips = 0, noClips = 0, noContext = 0;

(async () => {
  console.log('Testing ' + QUERIES.length + ' generic queries against live API...\n');
  console.log('='.repeat(64));

  for (const q of QUERIES) {
    const d = await post(q);
    const clips  = d.proof_clips || [];
    const srcs   = (d.sources || []).map(s => s.company);
    const mode   = d.answer_mode || '?';

    if (mode === 'no_context') {
      noContext++;
      console.log('SKIP  [no_context] ' + JSON.stringify(q));
      continue;
    }

    if (clips.length) {
      withClips++;
      console.log('CLIP  [' + mode + '] ' + JSON.stringify(q));
      console.log('      sources : ' + srcs.join(', '));
      clips.forEach(c => {
        console.log('      [' + c.company + '] (' + c.strength + ') "' + c.quote.slice(0, 80) + '"');
      });
    } else {
      noClips++;
      console.log('NONE  [' + mode + '] ' + JSON.stringify(q));
      console.log('      sources : ' + srcs.join(', ') + '  (no clips for these companies)');
    }
    console.log('');
  }

  console.log('='.repeat(64));
  console.log('SUMMARY:');
  console.log('  WITH clips   : ' + withClips + ' / ' + QUERIES.length);
  console.log('  No clips     : ' + noClips   + ' / ' + QUERIES.length + '  (story found but company has no endorsement clip)');
  console.log('  No context   : ' + noContext  + ' / ' + QUERIES.length + '  (retriever found nothing)');
})();
