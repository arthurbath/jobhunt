import axios from 'axios';
import * as cheerio from 'cheerio';
import { buildServiceError } from '../utils/serviceErrors.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const DDG_MIN_DELAY_MS = Number(process.env.DDG_MIN_DELAY_MS) || 1500;
const DDG_JITTER_MS = Number(process.env.DDG_JITTER_MS) || 900;
const DDG_RETRY_MAX = Number(process.env.DDG_RETRY_MAX) || 3;
const DDG_RETRY_BASE_MS = Number(process.env.DDG_RETRY_BASE_MS) || 2000;
const DDG_MAX_REQUESTS_PER_MINUTE = Number(process.env.DDG_MAX_REQUESTS_PER_MINUTE) || 10;
const RETRY_STATUS = new Set([403, 429, 503, 520, 521, 522, 524]);
let ddgQueue = Promise.resolve();
let lastRequestAt = 0;
const requestTimestamps = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextJitter(maxMs) {
  if (!maxMs) return 0;
  return Math.floor(Math.random() * maxMs);
}

function pruneOldTimestamps(now) {
  const cutoff = now - 60_000;
  while (requestTimestamps.length && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
}

async function applyGlobalCap(now) {
  if (!DDG_MAX_REQUESTS_PER_MINUTE) return;
  pruneOldTimestamps(now);
  if (requestTimestamps.length < DDG_MAX_REQUESTS_PER_MINUTE) {
    return;
  }
  const oldest = requestTimestamps[0];
  const waitMs = Math.max(0, 60_000 - (now - oldest)) + nextJitter(DDG_JITTER_MS);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function rateLimit() {
  const now = Date.now();
  await applyGlobalCap(now);
  if (!DDG_MIN_DELAY_MS) {
    requestTimestamps.push(Date.now());
    return;
  }
  const elapsed = now - lastRequestAt;
  const waitMs = Math.max(0, DDG_MIN_DELAY_MS - elapsed) + nextJitter(DDG_JITTER_MS);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastRequestAt = Date.now();
  requestTimestamps.push(lastRequestAt);
}

async function withRateLimit(task) {
  const run = async () => {
    await rateLimit();
    return task();
  };
  const resultPromise = ddgQueue.then(run, run);
  ddgQueue = resultPromise.catch(() => {});
  return resultPromise;
}

async function requestWithRetry(task, operation) {
  let attempt = 0;
  let delay = DDG_RETRY_BASE_MS;
  for (;;) {
    try {
      return await withRateLimit(task);
    } catch (err) {
      const status = err?.response?.status ?? err?.status;
      const shouldRetry = status && RETRY_STATUS.has(status);
      if (!shouldRetry || attempt >= DDG_RETRY_MAX) {
        throw buildServiceError('DuckDuckGo', operation, err);
      }
      await sleep(delay + nextJitter(DDG_JITTER_MS));
      delay *= 2;
      attempt += 1;
    }
  }
}

function normalizeQuery(raw = '') {
  if (!raw) return raw;
  return raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[&/]/g, ' ')
    .replace(/["“”]/g, '"')
    .replace(/[^\w\s"-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function instantAnswer(query) {
  const url = 'https://api.duckduckgo.com/';
  const params = {
    q: normalizeQuery(query),
    format: 'json',
    no_redirect: 1,
    no_html: 1,
  };
  const { data } = await requestWithRetry(
    () => axios.get(url, { params, headers: { 'User-Agent': USER_AGENT } }),
    'instant answer'
  );
  return data;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const parsed = new URL(rawUrl, 'https://duckduckgo.com');
    if (parsed.hostname === 'duckduckgo.com' && parsed.searchParams.get('uddg')) {
      return decodeURIComponent(parsed.searchParams.get('uddg'));
    }
    return parsed.toString();
  } catch (err) {
    return rawUrl;
  }
}

export async function searchWeb(query, limit = 5) {
  const params = new URLSearchParams({ q: normalizeQuery(query), ia: 'web' });
  const url = `https://duckduckgo.com/html/?${params.toString()}`;
  const response = await requestWithRetry(
    () =>
      axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }),
    'search'
  );
  const data = response.data;
  const $ = cheerio.load(data);
  const results = [];
  $('div.results div.result').each((_, el) => {
    if (results.length >= limit) return false;
    const link = $(el).find('a.result__a');
    const url = normalizeUrl(link.attr('href'));
    if (!url) return;
    results.push({
      title: link.text().trim(),
      url,
      snippet: $(el).find('.result__snippet').text().trim(),
    });
    return undefined;
  });
  return results;
}
