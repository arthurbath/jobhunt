import OpenAI from 'openai';
import { config } from '../config.js';
import { buildServiceError } from '../utils/serviceErrors.js';

class OpenAIClient {
  constructor(apiKey) {
    this.enabled = Boolean(apiKey);
    this.client = this.enabled ? new OpenAI({ apiKey }) : null;
  }

  isReady() {
    return this.enabled;
  }

  async chat({ messages, responseFormat, temperature = 0.2 }) {
    if (!this.enabled) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY.');
    }
    try {
      const completion = await this.client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature,
        response_format: responseFormat,
        messages,
      });
      return completion.choices[0]?.message?.content;
    } catch (err) {
      throw buildServiceError('OpenAI', 'chat completion', err);
    }
  }
}

export const openaiClient = new OpenAIClient(config.openAiKey);
