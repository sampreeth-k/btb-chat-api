'use strict';
/**
 * Adds TrilliCom/Bob story (ID 60) to btb-chat-api/stories.json
 * Run: node add_story60_trillicom_bob.js
 */
const fs   = require('fs');
const path = require('path');

const storiesPath = path.join(__dirname, 'stories.json');
const stories = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));

const alreadyHas = stories.some(s => s.id === 60);
if (alreadyHas) { console.log('Story 60 already exists. Nothing to do.'); process.exit(0); }

const newStory = {
  "id": 60,
  "publishedDate": "2026-10-13",
  "date": "2026-10-13",
  "publishDate": "2026-10-13",
  "title": "How IBM Bob helped TrilliCom double coding productivity and transform scattered loan records into reviewable evidence",
  "company": "TrilliCom",
  "industry": ["Financial Services", "IT Services"],
  "primaryProduct": "IBM Bob",
  "primaryIBMProduct": "IBM Bob",
  "products": [
    "IBM Bob",
    "IBM watsonx.ai",
    "IBM watsonx Orchestrate",
    "IBM Content Manager OnDemand",
    "IBM Cloud Code Engine",
    "Docling for IBM watsonx"
  ],
  "description": "IBM partner TrilliCom used IBM Bob to build Ask@Lori inside Document Center V3\u2014doubling coding productivity, reducing manual testing effort and enabling LRM Lender Consultants to prepare SBA loan reconciliation cases for expert review in minutes instead of hours.",
  "articleUrl": "https://www.ibm.com/new/product-blog/how-ibm-bob-helped-trillicom-double-coding-productivity-and-transform-scattered-loan-records-into-reviewable-evidence",
  "url": "https://www.ibm.com/new/product-blog/how-ibm-bob-helped-trillicom-double-coding-productivity-and-transform-scattered-loan-records-into-reviewable-evidence",
  "videoUrl": null,
  "hasVideo": false,
  "heroImage": "https://assets.ibm.com/adobe/assets/urn:aaid:aem:c6920444-b002-4bbb-841d-ed9c5dca7bec/as/TrillicomBobLeadspace.png?fmt=png-alpha&smartcrop=5x2&dpr=on%2C1&fit=fit%2C1&width=1536&height=614",
  "architectureImage": "https://assets.ibm.com/adobe/assets/urn:aaid:aem:e1895ec5-b8df-4bdb-b2d8-c99eec7c0f21/as/TrillicomBobDiagram.jpg?dpr=on%2C1&fit=fit%2C1&width=1536&height=864",
  "tags": [
    "IBM Bob", "TrilliCom", "LRM Lender Consultants", "Ask@Lori", "Document Center V3",
    "SBA lending", "loan reconciliation", "financial services", "document intelligence",
    "agentic software development", "developer productivity", "IBM watsonx.ai",
    "IBM watsonx Orchestrate", "IBM Content Manager OnDemand", "Docling", "Milvus",
    "RAG", "unit test generation", "pandas", "IBM Cloud Code Engine", "IBM partner"
  ],
  "themes": [
    "Agentic Software Development", "Developer Productivity", "Document Intelligence",
    "Retrieval-Augmented Generation", "Financial Services AI", "SBA Lending Compliance",
    "Human-in-the-Loop", "Test Automation", "IBM Partner Solution", "Workflow Orchestration"
  ],
  "personas": [
    "CTO", "Software Engineer", "Engineering Leader", "AI Engineer",
    "IBM Business Partner", "Financial Services Leader", "Compliance Officer"
  ],
  "businessFunctions": [
    "Software Engineering", "Financial Operations", "Compliance",
    "Document Management", "Lending Operations"
  ],
  "outcomes": [
    "Coding productivity roughly doubled",
    "Manual testing effort significantly reduced",
    "Loan case preparation reduced from hours to minutes",
    "PDF records expanded into 16-column workbooks with financial calculations",
    "Source citations for every AI-generated answer",
    "Reusable Document Center V3 foundation for future workflows"
  ],
  "proofPoints": [
    "TrilliCom roughly doubled coding productivity using IBM Bob",
    "Manual testing effort significantly reduced through Bob-generated unit tests with boundary condition coverage",
    "Ask@Lori organizes loan data for expert review in minutes\u2014compared with hours of manual preparation",
    "Scanned PDFs with 3\u20134 columns converted into workbooks with approximately 16 columns including financial calculations",
    "IBM Bob generated code, tests and documentation\u2014reducing repetitive engineering work while retaining human responsibility for behavior"
  ],
  "searchIntents": [
    "Agentic Software Development", "Developer Productivity", "Document Intelligence",
    "IBM Bob", "Retrieval-Augmented Generation", "Financial Services AI",
    "Test Automation", "IBM Partner Solution", "SBA Lending Compliance", "Workflow Orchestration"
  ],
  "executiveSummary": "IBM partner TrilliCom used IBM Bob to build Ask@Lori\u2014doubling coding productivity and generating reliable unit tests\u2014so LRM Lender Consultants can prepare SBA loan reconciliation cases for expert review in minutes instead of the hours previously required for manual document preparation.",
  "businessChallenge": "LRM Lender Consultants specialists spent several hours per loan case transcribing and aligning records across up to nine document sources before any investigative work could begin. TrilliCom needed to build the Ask@Lori capability faster, with better test coverage, without expanding the team.",
  "businessOutcome": "IBM Bob helped TrilliCom roughly double coding productivity and reduce manual testing effort\u2014generating application code, procedural financial calculations, unit tests and documentation. Ask@Lori now organizes loan data for expert review in minutes, letting specialists spend more time investigating discrepancies and advising lenders.",
  "searchText": "TrilliCom IBM Bob Ask@Lori LRM Lender Consultants Document Center V3 SBA lending loan reconciliation financial document AI Docling Milvus IBM watsonx.ai watsonx Orchestrate IBM Content Manager OnDemand IBM Cloud Code Engine developer productivity doubled coding productivity unit test generation boundary conditions pandas Python RAG retrieval-augmented generation vector search document classification entity extraction missing document detection financial calculations Claude Rheaume CEO TrilliCom Chad Jennings IBM partner minutes instead of hours 16 columns workbook scanned PDF OCR layout analysis table extraction",
  "region": "AMER",
  "story_type": "customer story",
  "country": "United States"
};

// Prepend (most-recent first)
stories.unshift(newStory);
fs.writeFileSync(storiesPath, JSON.stringify(stories, null, 2), 'utf8');
console.log('Added story 60 (TrilliCom/Bob) to stories.json. Total stories:', stories.length);
