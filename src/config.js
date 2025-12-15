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
};
