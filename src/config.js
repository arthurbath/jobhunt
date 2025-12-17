import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Did you copy .env.example to .env?`);
  }
  return value;
}

export const config = {
  airtable: {
    apiKey: requireEnv('AIRTABLE_TOKEN'),
    baseId: requireEnv('AIRTABLE_BASE_ID'),
  },
  // optional OpenAI key for future enhancements
  openAiKey: process.env.OPENAI_API_KEY || null,
  openWebNinja: {
    apiKey: process.env.OPENWEB_NINJA_API_KEY || null,
    baseUrl: process.env.OPENWEB_NINJA_BASE_URL || 'https://api.openwebninja.com',
    glassdoorPath:
      process.env.OPENWEB_NINJA_GLASSDOOR_PATH || '/realtime-glassdoor-data/company-search',
    domain: process.env.OPENWEB_NINJA_DOMAIN || 'www.glassdoor.com',
    limit: Number(process.env.OPENWEB_NINJA_LIMIT) || 5,
  },
};
