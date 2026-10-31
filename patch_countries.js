'use strict';
const fs = require('fs');

// Country derived from summary.match.region + web research for "Not specified" stories
// Using the customer's HQ country (not IBM's location)
const countryMap = {
  1:  'Germany',           // WealthAPI — Berlin
  2:  'United States',     // Athena Intelligence — New York, NY
  3:  'Sweden',            // Edsvaard
  4:  'United States',     // Beacon Mobility — US
  5:  'Brazil',            // AXA Brazil
  6:  'United Kingdom',    // Mitie — London
  7:  'United States',     // MyLua Health — Brooklyn, NY
  8:  'United States',     // CrushBank
  9:  'United States',     // Shorthills AI
  10: 'Germany',           // Wikimedia Deutschland
  11: 'United Kingdom',    // Bud Financial — London
  12: 'United States',     // Bay Point Advisors
  13: 'Norway',            // Frontkom — Bergen
  14: 'United States',     // Avid Solutions / GovPulse.io — Winston-Salem, NC
  15: 'United States',     // Dynamiq — San Francisco / Delaware
  16: 'United States',     // FlexiVan
  17: 'South Africa',      // Blue Pearl
  18: 'Netherlands',       // Novadoc
  19: 'Mexico',            // Novacomp — Mexico City
  20: 'Czech Republic',    // Cogniware — Prague
  21: 'United States',     // Brighthive
  22: 'Global',            // ViClinic — multi-country telehealth
  23: 'Canada',            // Knockri — Toronto
  24: 'United States',     // Fiducia AI — New York
  25: 'United States',     // US Open / USTA — New York
  26: 'United States',     // Airy
  27: 'United States',     // Claims Connection Group
  28: 'United States',     // Focal Systems
  29: 'United States',     // Careerforce Pro
  30: 'United States',     // CrushBank (duplicate)
  31: 'United States',     // Busie
  32: 'Global',            // SupPlant — Israel HQ, global deployments
  33: 'United Kingdom',    // RBH Hospitality
  34: 'India',             // The Wave Group
  35: 'Peru',              // UNACEM — Lima
  36: 'France',            // Serre Chevalier
  37: 'United States',     // Spark Compass
  38: 'Spain',             // RFEA — Madrid
  39: 'Global',            // IBM watsonx Orchestrate — product, multi-region
  40: 'Netherlands',       // Migrato
  41: 'Australia',         // Swan Christian Education Association — Western Australia
  42: 'Global',            // IBM Bob — product, multi-region
  43: 'Netherlands',       // Migrato (duplicate)
  44: 'Global',            // IBM watsonx.data — product, multi-region
  45: 'United States',     // Fogel Law Group
  46: 'Global',            // IBM Confluent — product, multi-region
  47: 'United States',     // California DMV
  48: 'United States',     // Mitsubishi Motors North America — Nashville, TN
  49: 'Switzerland',       // Zurich Insurance Group — Zurich
  50: 'United States',     // Avid Solutions — Winston-Salem, NC
};

const paths = [
  'C:\\Users\\SampreethKumar\\Desktop\\btb-chat-api\\stories.json',
  'C:\\Users\\SampreethKumar\\Desktop\\beyondtheblueprints\\stories.json'
];

for (const filePath of paths) {
  const stories = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let patched = 0;
  for (const story of stories) {
    if (countryMap[story.id] !== undefined) {
      story.country = countryMap[story.id];
      patched++;
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(stories, null, 4), 'utf8');
  console.log(`${filePath.split('\\').slice(-2).join('/')}: patched ${patched} stories`);
}

// Print clean country list for verification
const stories = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
const byCountry = {};
stories.forEach(s => {
  const c = s.country || 'Unknown';
  if (!byCountry[c]) byCountry[c] = [];
  byCountry[c].push(s.company);
});
const sorted = Object.keys(byCountry).sort();
console.log(`\n${sorted.length} unique countries:`);
sorted.forEach(c => console.log(`  ${c}: ${byCountry[c].join(', ')}`));
