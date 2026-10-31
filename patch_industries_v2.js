// patch_industries_v2.js
// Converts industry field from string to array with clean controlled-vocabulary tags.
// Run: node patch_industries_v2.js
const fs = require('fs');
const path = require('path');

// Controlled vocabulary — every tag that appears below is intentional.
// Multiple tags allowed per story.
const INDUSTRY_MAP = {
    // id: [tag, ...]
    1:  ['Financial Services', 'FinTech'],
    2:  ['Enterprise Software', 'Automation'],
    3:  ['Real Estate', 'PropTech'],
    4:  ['Education', 'Transportation'],
    5:  ['Insurance', 'Financial Services'],
    6:  ['Facilities Management'],
    7:  ['Healthcare'],
    8:  ['IT Services'],
    9:  ['Legal Tech'],
    10: ['Technology', 'Artificial Intelligence'],
    11: ['Financial Services', 'FinTech'],
    12: ['Financial Services'],
    13: ['Transportation', 'Public Sector'],
    14: ['Government', 'Public Sector'],
    15: ['Legal Tech'],
    16: ['Logistics', 'Transportation'],
    17: ['IT Services'],
    18: ['IT Services'],
    19: ['IT Services'],
    20: ['Financial Services', 'Financial Crime'],
    21: ['Data & AI', 'Enterprise Data Governance'],
    22: ['Healthcare', 'Artificial Intelligence'],
    23: ['Artificial Intelligence', 'Human Resources'],
    24: ['Retail', 'Artificial Intelligence'],
    25: ['Sports', 'Entertainment', 'Artificial Intelligence'],
    26: ['Technology', 'Software'],
    27: ['Insurance', 'Artificial Intelligence'],
    28: ['Retail', 'Artificial Intelligence'],
    29: ['Human Resources'],
    30: ['IT Services'],
    31: ['Transportation'],
    32: ['Agriculture', 'AgTech'],
    33: ['Hospitality'],
    34: ['Conglomerate', 'Real Estate', 'Manufacturing', 'Healthcare'],
    35: ['Industrial', 'Manufacturing'],
    36: ['Travel', 'Hospitality'],
    37: ['Retail', 'Hospitality', 'Sports'],
    38: ['Sports'],
    39: ['Artificial Intelligence', 'Enterprise Software'],
    40: ['IT Services'],
    41: ['Education'],
    42: ['Artificial Intelligence', 'Software Development'],
    43: ['IT Services'],
    44: ['Artificial Intelligence', 'Data & AI'],
    45: ['Legal', 'Real Estate'],
    46: ['Artificial Intelligence', 'Data & AI'],
    47: ['Government', 'Public Sector'],
    48: ['Automotive'],
    49: ['Insurance', 'Financial Services'],
    50: ['Technology', 'Artificial Intelligence', 'Government'],
};

function patchFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const stories = JSON.parse(raw);
    let changed = 0;
    stories.forEach(function(s) {
        const tags = INDUSTRY_MAP[s.id];
        if (!tags) {
            console.warn('  WARNING: no mapping for id', s.id, s.company);
            return;
        }
        s.industry = tags;
        changed++;
    });
    fs.writeFileSync(filePath, JSON.stringify(stories, null, 4), 'utf8');
    console.log('  Patched', changed, 'stories in', path.basename(filePath));
}

console.log('Patching btb-chat-api/stories.json...');
patchFile(path.join(__dirname, 'stories.json'));

console.log('Patching beyondtheblueprints/stories.json...');
patchFile(path.join(__dirname, '..', 'beyondtheblueprints', 'stories.json'));

console.log('Done.');
