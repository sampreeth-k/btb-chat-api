// add_story_52_axisbank.js
// Adds Axis Bank (id 52) to stories.json (both repos) and executiveDeckBlueprints.json (frontend).
// Run: node add_story_52_axisbank.js
'use strict';
const fs   = require('fs');
const path = require('path');

// ── Story entry ────────────────────────────────────────────────────────────
const story52 = {
    "id": 52,
    "publishedDate": "2026-08-31",
    "date": "2026-08-31",
    "publishDate": "2026-08-31",
    "title": "How Axis Bank accelerated developer onboarding from months to days",
    "company": "Axis Bank",
    "industry": ["Financial Services", "Banking", "FinTech"],
    "region": "APAC",
    "country": "India",
    "primaryProduct": "IBM API Connect",
    "primaryIBMProduct": "IBM API Connect",
    "products": [
        "IBM API Connect",
        "IBM webMethods Hybrid Integration"
    ],
    "otherIBMProducts": [
        "IBM webMethods Hybrid Integration"
    ],
    "description": "Axis Bank — India's third-largest private-sector bank — used IBM API Connect to replace a paper-heavy, months-long developer onboarding process with a self-service portal that delivers production go-live in as little as 10 days, exposing 400+ APIs organised into 100+ business-use-case API products with AI-powered personalised recommendations.",
    "articleUrl": "https://www.ibm.com/new/product-blog/how-axis-bank-accelerated-developer-onboarding-from-months-to-days",
    "url": "https://www.ibm.com/new/product-blog/how-axis-bank-accelerated-developer-onboarding-from-months-to-days",
    "storyUrl": "https://www.ibm.com/new/product-blog/how-axis-bank-accelerated-developer-onboarding-from-months-to-days",
    "blogUrl": "https://www.ibm.com/new/product-blog/how-axis-bank-accelerated-developer-onboarding-from-months-to-days",
    "videoUrl": null,
    "hasVideo": false,
    "heroImage": "https://assets.ibm.com/is/image/ibm/6278d9bb-ba83-4080-bfc8dade03c1209a:5x2?dpr=on%2C1&fit=fit%2C1&wid=1584&hei=634",
    "architectureImage": "https://assets.ibm.com/adobe/assets/urn:aaid:aem:53b553d5-5d6b-46b6-86b2-dcda0e391aee/as/AxisDiagramUpdate.png?fmt=png-alpha&dpr=on%2C1&fit=fit%2C1&width=1584&height=1329",
    "tags": [
        "IBM API Connect",
        "IBM webMethods Hybrid Integration",
        "API management",
        "developer portal",
        "developer onboarding",
        "banking",
        "financial services",
        "India",
        "APAC",
        "Axis Bank",
        "Project NEO",
        "self-service",
        "400 APIs",
        "10 days",
        "AI recommendations",
        "wholesale banking"
    ],
    "summary": {
        "headline": "Axis Bank Cuts Developer Onboarding from Months to 10 Days with IBM API Connect",
        "match": {
            "customer": "Axis Bank",
            "industry": "Financial Services / Banking",
            "region": "APAC — Mumbai, India"
        },
        "challenge": "Corporate developers integrating with Axis Bank's systems faced a paper-heavy onboarding journey of months — chasing approvals, resolving credential issues and navigating manual handoffs before writing a single line of code. Invalid IP addresses surfaced only after several handoffs; SSL certificates couldn't travel by email; wrong documentation versions sent testing to dead ends. The bank had no digital document repository and no self-service path from discovery to production.",
        "solution": [
            "IBM API Connect deployed as the API gateway and lifecycle management layer for Axis Bank's developer portal",
            "Self-service portal replacing paper forms, email and manual handoffs with a digital onboarding journey",
            "400+ APIs packaged into 100+ API products organised around business use cases (payments, balance, reconciliation, lending, card services)",
            "AI-powered personalised API recommendations — industry-first feature guiding developers to relevant APIs",
            "Sandbox testing, credential management and status tracking built directly into the portal",
            "Callback API URL enabling event-driven communication — another industry-first feature",
            "IBM webMethods Hybrid Integration connects digital channels, enterprise integrations and WhatsApp banking to core banking systems",
            "Separation of API consumer layer from core banking systems via API Connect gateway applying access and traffic policies"
        ],
        "key_outcomes": [
            "Developer onboarding reduced from months to 10–20 days, with production go-live achievable in as little as 10 days",
            "400+ APIs and 100+ API products exposed through a single self-service developer portal",
            "AI-powered personalised API recommendations — industry-first developer portal feature",
            "Paperless digital onboarding replacing manual approvals, email credentials and form-based processes",
            "Reusable API operating model: security, access and lifecycle processes built once and reused across products"
        ],
        "business_impact": "IBM API Connect transformed Axis Bank's developer onboarding from a months-long paper process into a 10-day self-service journey — giving India's third-largest private-sector bank a scalable API operating model that supports 400+ APIs, AI-driven discovery and reusable security and lifecycle controls."
    },
    "themes": [
        "API Management",
        "Developer Experience",
        "Digital Banking",
        "Self-Service Onboarding",
        "AI-Powered Recommendations",
        "Hybrid Integration",
        "Banking Modernization",
        "Fintech Ecosystem"
    ],
    "personas": [
        "Chief Digital Officer",
        "Head of Wholesale Banking",
        "API Product Manager",
        "Enterprise Architect",
        "Developer Relations Lead",
        "Corporate Banking Technology Head"
    ],
    "businessFunctions": [
        "Digital Banking",
        "Wholesale Banking",
        "API Product Management",
        "Developer Experience",
        "IT Integration",
        "Corporate Banking"
    ],
    "outcomes": [
        "Developer onboarding from months to 10 days — production go-live achievable in as little as 10 days",
        "400+ APIs and 100+ API products in a single self-service portal",
        "Industry-first AI-powered personalised API recommendations",
        "Industry-first callback API URL for event-driven communication",
        "Paperless digital onboarding replacing manual approvals and email credentials",
        "Reusable API operating model reducing total cost of ownership"
    ],
    "useCases": [
        "Developer portal modernisation",
        "API lifecycle management",
        "Self-service corporate developer onboarding",
        "AI-personalised API discovery",
        "Hybrid integration for banking channels",
        "Fintech and enterprise API ecosystem"
    ],
    "technologies": [
        "IBM API Connect",
        "IBM webMethods Hybrid Integration",
        "API gateway",
        "Self-service developer portal",
        "AI-powered recommendations",
        "Event-driven architecture",
        "Sandbox testing",
        "Hybrid integration"
    ],
    "proofPoints": [
        "Developer onboarding reduced from months to 10–20 days; production go-live in as little as 10 days",
        "400+ APIs packaged into 100+ API products organised around business use cases",
        "Industry-first AI-powered personalised API recommendations in a banking developer portal",
        "Serves 5,100+ domestic branches, 15,800+ ATMs and 2,800 service centres across India",
        "Acquired Citigroup's India consumer banking business in 2023 — portal scales to this expanded footprint"
    ],
    "searchAliases": [
        "Axis Bank",
        "Axis Bank NEO",
        "IBM API Connect",
        "IBM webMethods",
        "developer portal",
        "API onboarding",
        "developer onboarding",
        "10 days",
        "400 APIs",
        "India banking",
        "APAC banking",
        "wholesale banking",
        "fintech API",
        "Abhijit Dey",
        "Vivek Gupta",
        "Project NEO",
        "self-service banking API"
    ],
    "salesMotions": [
        "API management modernisation business case",
        "Developer experience transformation proof",
        "Banking digital onboarding story",
        "IBM API Connect and webMethods proof of value",
        "APAC financial services customer story"
    ],
    "industryTags": [
        "Financial Services",
        "Banking",
        "FinTech",
        "API Management",
        "Digital Banking"
    ],
    "businessChallenge": "Corporate developers integrating with Axis Bank faced months of paper-based manual onboarding — chasing approvals, email credentials and documentation errors — with no self-service path from API discovery to production go-live.",
    "businessOutcome": "IBM API Connect delivered a self-service developer portal that cut onboarding from months to 10 days, exposed 400+ APIs in 100+ business-use-case products, and introduced industry-first AI-powered API recommendations — building a reusable API operating model that lowers TCO as the bank scales.",
    "executiveSummary": "Axis Bank deployed IBM API Connect to replace a months-long paper-based developer onboarding process with a self-service portal that achieves production go-live in as little as 10 days — exposing 400+ APIs with AI-personalised recommendations for India's third-largest private-sector bank.",
    "searchText": "Axis Bank IBM API Connect IBM webMethods Hybrid Integration developer portal developer onboarding 10 days months to days 400 APIs 100 API products Project NEO self-service portal AI personalised recommendations India APAC Mumbai wholesale banking fintech corporate banking Abhijit Dey Vivek Gupta sandbox testing callback API URL event-driven paperless digital onboarding credential management SSL certificate IP address validation banking modernisation API lifecycle management gateway access traffic policies hybrid integration 5100 branches 15800 ATMs Citigroup consumer banking acquisition reusable API operating model TCO total cost of ownership financial services banking",
    "precisionSearchTerms": "Axis Bank IBM API Connect webMethods developer portal 10 days 400 APIs 100 API products Project NEO India APAC self-service onboarding AI recommendations wholesale banking paperless digital onboarding",
    "country": "India"
};

// ── Executive Deck entry ───────────────────────────────────────────────────
const deck52 = {
    "storyId": 52,
    "style": "premium",
    "customer": "Axis Bank",
    "headline": "Axis Bank cuts developer onboarding from months to 10 days with IBM API Connect",
    "subheadline": "India's third-largest private-sector bank built a self-service developer portal exposing 400+ APIs with AI-personalised recommendations — replacing a paper-heavy process that once took months",
    "heroStatement": "From months of manual handoffs to production go-live in 10 days",
    "storyTheme": "API-led digital banking transformation",
    "challengeNarrative": "\"A corporate developer integrating with a bank's systems can take months to navigate paper-based processes, chasing approvals and resolving credential issues before writing a single line of code.\"",
    "challenge": "Axis Bank's corporate developer onboarding relied on paper forms, email and manual handoffs. Invalid IP addresses surfaced only after several approvals. SSL certificates couldn't travel by email. The wrong documentation version sent testing to dead ends. There was no self-service path from API discovery to production — and no digital document repository to support one.",
    "solutionNarrative": "IBM API Connect gave Axis Bank a reusable API operating model — security, access and lifecycle built once and reused across every product.",
    "solution": "Axis Bank deployed IBM API Connect as the gateway and lifecycle layer for a self-service developer portal. 400+ APIs were packaged into 100+ API products organised around business use cases. Developers can now move from discovery through sandbox testing to production go-live in as little as 10 days. AI-powered personalised API recommendations — an industry first — guide developers to the right APIs for their use case. IBM webMethods Hybrid Integration connects digital channels, enterprise ERP integrations and WhatsApp banking to core banking systems without tight coupling.",
    "heroImage": "https://assets.ibm.com/is/image/ibm/6278d9bb-ba83-4080-bfc8dade03c1209a:5x2?dpr=on%2C1&fit=fit%2C1&wid=1584&hei=634",
    "architecture": {
        "image": "https://assets.ibm.com/adobe/assets/urn:aaid:aem:53b553d5-5d6b-46b6-86b2-dcda0e391aee/as/AxisDiagramUpdate.png?fmt=png-alpha&dpr=on%2C1&fit=fit%2C1&width=1584&height=1329",
        "caption": "Axis Bank developer portal integration architecture — IBM API Connect and IBM webMethods connecting digital channels to core banking systems"
    },
    "metrics": [
        {
            "value": "10 days",
            "label": "Developer onboarding to production go-live — down from months"
        },
        {
            "value": "400+",
            "label": "APIs exposed through the self-service developer portal"
        },
        {
            "value": "100+",
            "label": "API products organised around business use cases"
        },
        {
            "value": "Industry first",
            "label": "AI-powered personalised API recommendations in a banking portal"
        }
    ],
    "impactCards": [
        {
            "title": "Speed",
            "body": "Corporate developers move from API discovery through sandbox testing to production go-live in as little as 10 days — replacing a paper-based process that previously required months of manual approvals, email credentials and form handoffs."
        },
        {
            "title": "Scale",
            "body": "400+ APIs packaged into 100+ API products built around customer tasks — payments, balance, reconciliation, lending and card services. Security, access and lifecycle controls are built once and reused across every product, lowering TCO as Axis Bank scales."
        },
        {
            "title": "Intelligence",
            "body": "AI-powered personalised API recommendations guide developers to the right APIs for their use case — an industry-first feature that reduces decision overhead and support effort while improving the developer experience."
        }
    ],
    "products": [
        "IBM API Connect",
        "IBM webMethods Hybrid Integration"
    ],
    "capabilityCallouts": [
        "API Management",
        "Self-Service Onboarding",
        "AI Recommendations",
        "Hybrid Integration"
    ],
    "industry": "Financial Services / Banking",
    "blogUrl": "https://www.ibm.com/new/product-blog/how-axis-bank-accelerated-developer-onboarding-from-months-to-days",
    "publishedDate": "2026-08-31",
    "accentColor": "0043CE"
};

// ── Patch functions ────────────────────────────────────────────────────────
function addStory(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const stories = JSON.parse(raw);
    if (stories.find(s => s.id === 52)) {
        console.log('  Story 52 already exists in', path.basename(filePath), '— skipping');
        return;
    }
    stories.push(story52);
    fs.writeFileSync(filePath, JSON.stringify(stories, null, 4), 'utf8');
    console.log('  Added story 52 to', path.basename(filePath), '— total:', stories.length);
}

function addDeck(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const decks = JSON.parse(raw);
    if (decks['52']) {
        console.log('  Deck 52 already exists — skipping');
        return;
    }
    decks['52'] = deck52;
    fs.writeFileSync(filePath, JSON.stringify(decks, null, 4), 'utf8');
    console.log('  Added deck 52 to', path.basename(filePath), '— total entries:', Object.keys(decks).length);
}

console.log('Patching btb-chat-api/stories.json...');
addStory(path.join(__dirname, 'stories.json'));

console.log('Patching beyondtheblueprints/stories.json...');
addStory(path.join(__dirname, '..', 'beyondtheblueprints', 'stories.json'));

console.log('Patching beyondtheblueprints/executiveDeckBlueprints.json...');
addDeck(path.join(__dirname, '..', 'beyondtheblueprints', 'executiveDeckBlueprints.json'));

console.log('Done.');
