import axios from 'axios';
import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';
import { buildServiceError } from '../utils/serviceErrors.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];
const DDG_MIN_DELAY_MS = Number(process.env.DDG_MIN_DELAY_MS) || 1500;
const DDG_JITTER_MS = Number(process.env.DDG_JITTER_MS) || 900;
const DDG_RETRY_MAX = Number(process.env.DDG_RETRY_MAX) || 3;
const DDG_RETRY_BASE_MS = Number(process.env.DDG_RETRY_BASE_MS) || 2000;
const DDG_MAX_REQUESTS_PER_MINUTE = Number(process.env.DDG_MAX_REQUESTS_PER_MINUTE) || 10;
const DDG_COOLDOWN_MS = Number(process.env.DDG_COOLDOWN_MS) || 5 * 60 * 1000;
const DDG_CACHE_TTL_MS = Number(process.env.DDG_CACHE_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const DDG_CACHE_PATH = (() => {
  const envPath = process.env.DDG_CACHE_PATH;
  if (!envPath) {
    return path.join(process.cwd(), '.cache', 'ddg-search.json');
  }
  return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
})();
const RETRY_STATUS = new Set([403, 429, 503, 520, 521, 522, 524]);
let ddgQueue = Promise.resolve();
let lastRequestAt = 0;
const requestTimestamps = [];
let cooldownUntil = 0;
let cacheLoaded = false;
const cache = new Map();
let cacheQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextJitter(maxMs) {
  if (!maxMs) return 0;
  return Math.floor(Math.random() * maxMs);
}

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function ensureCacheDir() {
  const dir = path.dirname(DDG_CACHE_PATH);
  await fs.mkdir(dir, { recursive: true });
}

async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = await fs.readFile(DDG_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const now = Date.now();
    for (const entry of parsed?.entries || []) {
      if (!entry?.key || !entry?.value || !entry?.ts) continue;
      if (now - entry.ts > DDG_CACHE_TTL_MS) continue;
      cache.set(entry.key, entry);
    }
  } catch (err) {
    // ignore missing/invalid cache
  }
}

async function saveCache() {
  const entries = Array.from(cache.values());
  await ensureCacheDir();
  await fs.writeFile(DDG_CACHE_PATH, JSON.stringify({ entries }, null, 2), 'utf8');
}

function queueCacheSave() {
  cacheQueue = cacheQueue.then(saveCache).catch(() => {});
  return cacheQueue;
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
  if (cooldownUntil && now < cooldownUntil) {
    const waitMs = Math.max(0, cooldownUntil - now) + nextJitter(DDG_JITTER_MS);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
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
      if (DDG_COOLDOWN_MS) {
        cooldownUntil = Math.max(cooldownUntil, Date.now() + DDG_COOLDOWN_MS);
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
    () => axios.get(url, { params, headers: { 'User-Agent': pickUserAgent() } }),
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
  const normalizedQuery = normalizeQuery(query);
  const cacheKey = `search::${normalizedQuery}::${limit}`;
  await loadCache();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts <= DDG_CACHE_TTL_MS) {
    return cached.value;
  }

  const params = new URLSearchParams({ q: normalizedQuery, ia: 'web' });
  const url = `https://duckduckgo.com/html/?${params.toString()}`;
  const response = await requestWithRetry(
    () =>
      axios.get(url, {
        headers: {
          'User-Agent': pickUserAgent(),
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
  cache.set(cacheKey, { key: cacheKey, ts: Date.now(), value: results });
  queueCacheSave();
  return results;
}
