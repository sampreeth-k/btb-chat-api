// add_deck_51_lifebridge.js
// Adds LifeBridge (id 51) deck entry to executiveDeckBlueprints.json in the frontend.
// Run: node add_deck_51_lifebridge.js
const fs = require('fs');
const path = require('path');

const deck51 = {
    "storyId": 51,
    "style": "premium",
    "customer": "LifeBridge",
    "headline": "LifeBridge closes the gap between insurance AI recommendations and governed execution with IBM watsonx",
    "subheadline": "IBM watsonx Orchestrate, Runtime and watsonx.ai power LifeBridge's composable insurance platform — enabling life and annuity carriers to configure products, automate workflows and inspect every AI decision without touching application code",
    "heroStatement": "From AI recommendation to governed insurance action — in minutes, not weeks",
    "storyTheme": "Governed agentic AI for life and annuity carriers",
    "challengeNarrative": "\"The model was not the hard part. Knowing what to change was quick, while closing the distance between knowing and doing was not.\"",
    "challenge": "A generative AI model can draft an insurance product rider in seconds — but a life insurance carrier might still need weeks to determine whether that rider can be offered in a specific state, which rules it touches and which systems need to change. Carriers understand AI intent but cannot execute it. The gap is an architecture problem, not an AI problem.",
    "solutionNarrative": "IBM watsonx gives LifeBridge a managed enterprise agent runtime that keeps model inference, agent coordination and governance as distinct, inspectable layers.",
    "solution": "LifeBridge built a composable insurance platform combining policy administration, producer management, governed automation and digital servicing. IBM watsonx Orchestrate coordinates agents in a split architecture — LifeStudio authors versioned insurance journeys, LifeWorks executes them, and compliance teams inspect every AI recommendation and its history directly from the console. IBM watsonx Runtime lets LifeBridge select models without hardwiring them into workflows. Shared IBM Cloud IAM and Object Storage eliminate rebuilding authentication and model integration for every new use case.",
    "heroImage": "https://assets.ibm.com/is/image/ibm/Office-Building:5x2?fmt=png-alpha&dpr=on%2C1&fit=fit%2C1&wid=1584&hei=634",
    "architecture": {
        "image": "https://assets.ibm.com/adobe/assets/urn:aaid:aem:682c2170-31dc-4680-981d-05595488e0df/as/LifeBridgeDiagram2.png?fmt=png-alpha&dpr=on%2C1&fit=fit%2C1&width=1584&height=947",
        "caption": "LifeBridge composable insurance platform architecture — LifeStudio, LifeWorks and IBM watsonx Orchestrate in a split agentic architecture"
    },
    "metrics": [
        {
            "value": "Minutes",
            "label": "To configure a new product or workflow — instead of weeks of code changes"
        },
        {
            "value": "100%",
            "label": "AI recommendation history inspectable by compliance teams from the console"
        },
        {
            "value": "Fraction",
            "label": "Each additional AI use case costs a fraction of the first — the tenth a fraction of both"
        },
        {
            "value": "Zero",
            "label": "Application code changes required to configure products, rates, rules, riders and forms"
        }
    ],
    "impactCards": [
        {
            "title": "Speed",
            "body": "Insurance carriers using LifeBridge configure products, rates, rules, riders, forms and state availability through LifeStudio — publishing versioned journey definitions without touching application code."
        },
        {
            "title": "Governance",
            "body": "Every AI recommendation passes through existing journey gates before commitment. Compliance teams inspect recommendations and their full history directly from the LifeWorks console — governance is built into the architecture, not bolted on."
        },
        {
            "title": "Scale",
            "body": "Shared IBM watsonx and IBM Cloud services across all agent types mean each additional AI use case costs a fraction of the last. IBM watsonx Runtime lets LifeBridge swap models without rewiring workflows."
        }
    ],
    "products": [
        "IBM watsonx Orchestrate",
        "IBM watsonx Runtime",
        "IBM watsonx.ai",
        "IBM Cloud IAM",
        "IBM Cloud Object Storage"
    ],
    "capabilityCallouts": [
        "Governed Automation",
        "Agentic AI",
        "Composable Architecture",
        "Compliance by Design"
    ],
    "industry": "Insurance / Financial Services",
    "blogUrl": "https://www.ibm.com/new/product-blog/how-lifebridge-turns-insurance-ai-recommendations-into-governed-actions-with-ibm-watsonx",
    "publishedDate": "2025-07-01",
    "accentColor": "0043CE"
};

const filePath = path.join(__dirname, '..', 'beyondtheblueprints', 'executiveDeckBlueprints.json');
const raw = fs.readFileSync(filePath, 'utf8');
const decks = JSON.parse(raw);

if (decks['51']) {
    console.log('Deck 51 already exists — skipping');
} else {
    decks['51'] = deck51;
    fs.writeFileSync(filePath, JSON.stringify(decks, null, 4), 'utf8');
    console.log('Added deck 51 to executiveDeckBlueprints.json — total entries:', Object.keys(decks).length);
}
