import { openaiClient } from './openaiClient.js';
import { SAN_DIEGO_CITIES } from '../utils/text.js';

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

function formatLocalSearchResults(searchResults = []) {
  if (!searchResults?.length) {
    return 'No supplemental search snippets were available.';
  }
  return searchResults
    .slice(0, 14)
    .map((hit, idx) => {
      const title = sanitize(hit.title || '', 300);
      const snippet = sanitize(hit.snippet || '', 600);
      return [
        `Result ${idx + 1} | Query: ${hit.query}`,
        title ? `Title: ${title}` : null,
        `URL: ${hit.url}`,
        snippet ? `Snippet: ${snippet}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function extractHostname(url = '') {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./i, '').toLowerCase();
  } catch (err) {
    return null;
  }
}

export async function researchLocalPresence({
  name,
  website,
  description = '',
  websiteText = '',
  searchResults = [],
}) {
  if (!isOpenAIEnabled()) return null;
  const websiteHost = extractHostname(website || '');
  const contextBlocks = [
    `Company: ${name}`,
    `San Diego County Cities (valid evidence targets): ${SAN_DIEGO_CITIES.join(', ')}`,
  ];
  if (website) {
    contextBlocks.push(`Official Website: ${website}`);
  }
  if (websiteHost) {
    contextBlocks.push(`Official Domain Hostname: ${websiteHost}`);
  }
  if (description) {
    contextBlocks.push(`Known Summary:\n${sanitize(description, 1000)}`);
  }
  if (websiteText) {
    contextBlocks.push(`Website Copy:\n${sanitize(websiteText, 2000)}`);
  }
  contextBlocks.push(`Search Findings:\n${formatLocalSearchResults(searchResults)}`);

  const messages = [
    {
      role: 'system',
      content:
        'You verify whether a specific company maintains an office in San Diego County, California. '
        + 'Treat the provided company name and website/domain as authoritative. '
        + 'Local must be TRUE only when an explicit address/office list/job post clearly ties THIS exact company '
        + 'to San Diego County (matching the brand/domain). '
        + 'If snippets describe a different organization with a similar name, ignore them. '
        + 'Never infer from indirect phrases (e.g., “customers in San Diego”) or from distributors. '
        + 'If no qualifying evidence exists, respond false. '
        + 'Only rely on the supplied snippets/site copy and cite the corresponding URLs for every affirmative claim.',
    },
    {
      role: 'user',
      content: contextBlocks.join('\n\n'),
    },
  ];

  const schema = {
    name: 'LocalPresenceVerdict',
    schema: {
      type: 'object',
      properties: {
        isSanDiegoLocal: { type: ['boolean', 'null'] },
        reasoning: { type: ['string', 'null'] },
        evidenceUrls: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['isSanDiegoLocal'],
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
