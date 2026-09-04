// add_story_51_lifebridge.js
// Adds LifeBridge (id 51) to stories.json in both repos.
// Run: node add_story_51_lifebridge.js
const fs = require('fs');
const path = require('path');

const story51 = {
    "id": 51,
    "publishedDate": "2025-07-01",
    "date": "2025-07-01",
    "publishDate": "2025-07-01",
    "title": "How LifeBridge turns insurance AI recommendations into governed actions with IBM watsonx",
    "company": "LifeBridge",
    "industry": ["Insurance", "Financial Services", "Artificial Intelligence"],
    "region": "Americas",
    "country": "United States",
    "primaryProduct": "IBM watsonx Orchestrate",
    "primaryIBMProduct": "IBM watsonx Orchestrate",
    "products": [
        "IBM watsonx Orchestrate",
        "IBM watsonx Runtime",
        "IBM watsonx.ai",
        "IBM Cloud IAM",
        "IBM Cloud Object Storage"
    ],
    "otherIBMProducts": [
        "IBM watsonx Runtime",
        "IBM watsonx.ai",
        "IBM Cloud IAM",
        "IBM Cloud Object Storage"
    ],
    "description": "Miami-based LifeBridge built a composable insurance platform for life and annuity carriers that closes the gap between AI recommendations and governed execution — using IBM watsonx Orchestrate to coordinate agents across policy administration, producer management and digital servicing journeys without coupling AI inference, agent coordination and governance into a single opaque component.",
    "articleUrl": "https://www.ibm.com/new/product-blog/how-lifebridge-turns-insurance-ai-recommendations-into-governed-actions-with-ibm-watsonx",
    "url": "https://www.ibm.com/new/product-blog/how-lifebridge-turns-insurance-ai-recommendations-into-governed-actions-with-ibm-watsonx",
    "storyUrl": "https://www.ibm.com/new/product-blog/how-lifebridge-turns-insurance-ai-recommendations-into-governed-actions-with-ibm-watsonx",
    "blogUrl": "https://www.ibm.com/new/product-blog/how-lifebridge-turns-insurance-ai-recommendations-into-governed-actions-with-ibm-watsonx",
    "videoUrl": null,
    "hasVideo": false,
    "heroImage": "https://assets.ibm.com/is/image/ibm/Office-Building:5x2?fmt=png-alpha&dpr=on%2C1&fit=fit%2C1&wid=1584&hei=634",
    "architectureImage": "https://assets.ibm.com/adobe/assets/urn:aaid:aem:682c2170-31dc-4680-981d-05595488e0df/as/LifeBridgeDiagram2.png?fmt=png-alpha&dpr=on%2C1&fit=fit%2C1&width=1584&height=947",
    "tags": [
        "IBM watsonx Orchestrate",
        "IBM watsonx Runtime",
        "IBM watsonx.ai",
        "agentic AI",
        "insurance",
        "life insurance",
        "annuity",
        "LifeBridge",
        "LifeStudio",
        "LifeWorks",
        "composable insurance",
        "governed automation",
        "policy administration",
        "producer management",
        "AI governance",
        "insurance workflow",
        "Americas",
        "Miami",
        "split architecture"
    ],
    "summary": {
        "headline": "LifeBridge Closes the Gap Between Insurance AI Recommendations and Governed Execution with IBM watsonx",
        "match": {
            "customer": "LifeBridge",
            "industry": "Insurance / Financial Services",
            "region": "Americas — Miami, Florida, US"
        },
        "challenge": "A generative AI model can draft an insurance product rider or interpret a servicing request in seconds — but a life insurance carrier might still need weeks to determine whether that rider can be offered in a specific state, which rules it touches, and which systems would need to change. The model understands the intent, but carrier systems cannot execute it. The gap between knowing and doing is an architecture problem, not an AI problem.",
        "solution": [
            "LifeBridge composable insurance platform combines policy administration, producer management, governed automation and digital servicing workflows",
            "LifeStudio control center authors each insurance journey in LifeBridge's workflow language and publishes a versioned definition",
            "LifeWorks orchestration engine executes the journeys — compliance reviewers can inspect changes and history directly from the console",
            "IBM watsonx Orchestrate coordinates conversational and domain agents within LifeBridge's hybrid architecture",
            "IBM watsonx Runtime provides model access APIs so LifeBridge can select models without hardwiring them into each workflow",
            "IBM Cloud IAM secures calls into watsonx Orchestrate; IBM Cloud Object Storage holds unstructured source material for grounding",
            "Shared IBM services across all agent types eliminate rebuilding authentication, model integration and operating controls for every use case",
            "Modular REST APIs, event-driven integration and transactional outbox pattern connect carriers, partners and payment providers without tight coupling"
        ],
        "key_outcomes": [
            "Insurance carriers configure products and digital workflows more quickly — without application code changes",
            "Operations teams automate bounded work while compliance teams inspect how recommendations reached approval",
            "Single composable architecture scales across policy administration, producer management and digital servicing",
            "Each additional use case costs a fraction of the first — the tenth a fraction of both",
            "Advisors spend less time navigating disconnected systems; policyholders receive smoother onboarding and servicing"
        ],
        "business_impact": "LifeBridge used IBM watsonx to build an insurance platform architecture that treats the gap between AI recommendation and governed action as an engineering problem — enabling life and annuity carriers to configure products, automate workflows and inspect compliance without touching application code."
    },
    "themes": [
        "Agentic AI",
        "Insurance Technology",
        "Governed Automation",
        "Composable Architecture",
        "AI Governance",
        "Policy Administration Modernization",
        "Compliance by Design",
        "Split Architecture"
    ],
    "personas": [
        "Chief Insurance Officer",
        "Chief Technology Officer",
        "Compliance Officer",
        "Insurance Operations Manager",
        "AI/ML Engineer",
        "Insurance Product Manager",
        "Digital Transformation Lead"
    ],
    "businessFunctions": [
        "Insurance Operations",
        "Policy Administration",
        "Producer Management",
        "Compliance",
        "Digital Servicing",
        "Product Engineering"
    ],
    "outcomes": [
        "Insurance products and digital workflows configured without application code changes",
        "Compliance teams can inspect AI recommendation history directly from the console",
        "Composable architecture scales across policy administration, producer management and servicing",
        "Each additional AI use case costs a fraction of the first",
        "Advisors spend less time navigating disconnected systems"
    ],
    "useCases": [
        "Governed insurance AI automation",
        "Policy administration modernization",
        "Composable insurance platform",
        "AI agent coordination for life and annuity carriers",
        "Compliance-inspectable AI recommendations",
        "Digital onboarding and servicing journeys"
    ],
    "technologies": [
        "IBM watsonx Orchestrate",
        "IBM watsonx Runtime",
        "IBM watsonx.ai",
        "IBM Cloud IAM",
        "IBM Cloud Object Storage",
        "Agentic AI",
        "REST APIs / OpenAPI",
        "Event-driven integration",
        "Transactional outbox pattern"
    ],
    "proofPoints": [
        "LifeBridge LifeStudio authors versioned insurance journeys; LifeWorks executes them — compliance reviewers inspect changes from the console",
        "IBM watsonx Orchestrate coordinates agents in a hybrid architecture without coupling inference, coordination and governance",
        "IBM Cloud IAM and Object Storage shared across all agent types — no rebuilding auth or model integration per use case",
        "Each additional AI use case costs a fraction of the first — the architecture compounds, not the cost"
    ],
    "searchAliases": [
        "LifeBridge",
        "LifeStudio",
        "LifeWorks",
        "IBM watsonx Orchestrate",
        "IBM watsonx Runtime",
        "life insurance AI",
        "annuity carrier",
        "composable insurance",
        "governed automation",
        "policy administration",
        "insurance AI governance",
        "insurance workflow",
        "Manish Choudhary",
        "Miami insurance",
        "split architecture insurance"
    ],
    "salesMotions": [
        "Insurance AI governance and compliance narrative",
        "Composable insurance platform proof of value",
        "IBM watsonx Orchestrate agentic AI story",
        "Life and annuity modernization business case",
        "Americas insurance technology customer story"
    ],
    "industryTags": [
        "Insurance",
        "Financial Services",
        "Agentic AI",
        "Governed Automation"
    ],
    "businessChallenge": "Life and annuity carriers understand AI intent but cannot execute it — determining whether a product rider is available in a given state, which rules it affects and which systems need to change can take weeks despite AI being able to draft the answer in seconds. The gap between knowing and doing is an architecture problem.",
    "businessOutcome": "IBM watsonx Orchestrate enabled LifeBridge to build a composable insurance platform where AI recommendations become governed, inspectable actions — carriers configure products and workflows without code, compliance teams inspect every change, and each additional AI use case costs a fraction of the last.",
    "executiveSummary": "LifeBridge used IBM watsonx Orchestrate, Runtime and watsonx.ai to build a composable insurance platform for life and annuity carriers — closing the gap between AI recommendations and governed execution so carriers can configure products, automate workflows and maintain compliance without application code changes.",
    "searchText": "LifeBridge life insurance annuity carrier composable insurance platform IBM watsonx Orchestrate IBM watsonx Runtime IBM watsonx.ai LifeStudio LifeWorks policy administration producer management governed automation compliance inspection AI governance agentic AI insurance workflow digital servicing onboarding Miami Florida Americas Manish Choudhary split architecture modular REST API event-driven integration transactional outbox IBM Cloud IAM IBM Cloud Object Storage grounding insurance product rider state availability rules versioned journey configuration-driven no code insurance AI recommendations governed actions compliance by design",
    "precisionSearchTerms": "LifeBridge IBM watsonx Orchestrate watsonx Runtime life insurance annuity composable insurance governed automation LifeStudio LifeWorks policy administration compliance inspection agentic AI insurance Miami split architecture configuration-driven",
    "country": "United States"
};

function addStory(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const stories = JSON.parse(raw);
    if (stories.find(s => s.id === 51)) {
        console.log('Story 51 already exists in', path.basename(filePath), '— skipping');
        return;
    }
    stories.push(story51);
    fs.writeFileSync(filePath, JSON.stringify(stories, null, 4), 'utf8');
    console.log('Added story 51 to', path.basename(filePath), '— total:', stories.length);
}

addStory(path.join(__dirname, 'stories.json'));
addStory(path.join(__dirname, '..', 'beyondtheblueprints', 'stories.json'));
console.log('Done.');
