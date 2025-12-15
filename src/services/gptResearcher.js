import { openaiClient } from './openaiClient.js';

const COMPANY_TYPES = [
  'Corporate',
  'Nonprofit',
  'Foundation',
  'Education',
  'Government',
  'Startup: Seed',
  'Startup: Series A',
  'Startup: Series B',
  'Startup: Series C',
  'Startup: Other/Unknown',
];

function sanitize(text = '', max = 4000) {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isOpenAIEnabled() {
  return openaiClient?.isReady?.() ?? false;
}

export async function generateCompanyInsights({ name, websiteText, instantAnswerText, extraFacts = '' }) {
  if (!isOpenAIEnabled()) return null;
  const contextBlocks = [
    `Company Name: ${name}`,
  ];
  if (websiteText) contextBlocks.push(`Website Content:\n${sanitize(websiteText)}`);
  if (instantAnswerText) contextBlocks.push(`Reference Notes:\n${sanitize(instantAnswerText, 1500)}`);
  if (extraFacts) contextBlocks.push(`Additional Facts:\n${sanitize(extraFacts, 1500)}`);

  const messages = [
    {
      role: 'system',
      content:
        'You are Codex, a research assistant. Summarize companies in two crisp sentences and classify their type/local presence. Only use provided context; if unknown, answer null.',
    },
    {
      role: 'user',
      content: contextBlocks.join('\n\n'),
    },
  ];

  const schema = {
    name: 'CompanyInsights',
    schema: {
      type: 'object',
      properties: {
        description: { type: ['string', 'null'] },
        companyType: { type: ['string', 'null'], enum: [...COMPANY_TYPES, null] },
        isSanDiegoLocal: { type: ['boolean', 'null'] },
        reasoning: { type: ['string', 'null'] },
      },
      required: ['description', 'companyType', 'isSanDiegoLocal'],
    },
  };

  const content = await openaiClient.chat({
    messages,
    responseFormat: { type: 'json_schema', json_schema: schema },
  });
  return JSON.parse(content);
}

export async function evaluateBcorpStatus({ name, directorySummary = '', officialSite }) {
  if (!isOpenAIEnabled()) return null;
  const directoryBlock = directorySummary
    ? `Directory Search Results:\n${sanitize(directorySummary, 4000)}`
    : 'Directory Search Results: none';
  const officialBlock = officialSite?.text
    ? `Official Site (${officialSite.url || 'unknown url'}):\n${sanitize(officialSite.text, 2000)}`
    : null;

  const messages = [
    {
      role: 'system',
      content:
        'You are validating B Corp certification. Only return true if the official B Lab directory search results clearly show the company name in the results table or cards. Official site claims may be accepted only if the company self-identifies as a Certified B Corp. If evidence is insufficient or missing, respond false.',
    },
    {
      role: 'user',
      content: [
        `Company: ${name}`,
        directoryBlock,
        officialBlock || 'Official Site Evidence: none',
      ].join('\n\n'),
    },
  ];

  const schema = {
    name: 'BCorpVerdict',
    schema: {
      type: 'object',
      properties: {
        isBcorp: { type: 'boolean' },
        evidenceUrl: { type: ['string', 'null'] },
        reasoning: { type: ['string', 'null'] },
      },
      required: ['isBcorp'],
    },
  };

  const content = await openaiClient.chat({
    messages,
    responseFormat: { type: 'json_schema', json_schema: schema },
  });
  return JSON.parse(content);
}
