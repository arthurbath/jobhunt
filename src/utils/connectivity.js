import axios from 'axios';

const DEFAULT_URLS = [
  'https://www.google.com/generate_204',
  'https://www.cloudflare.com/cdn-cgi/trace',
];

const NET_CHECK_URLS = (process.env.NET_CHECK_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const CHECK_URLS = NET_CHECK_URLS.length ? NET_CHECK_URLS : DEFAULT_URLS;

const NET_CHECK_TIMEOUT_MS = Number(process.env.NET_CHECK_TIMEOUT_MS) || 5000;
const NET_RETRY_BASE_MS = Number(process.env.NET_RETRY_BASE_MS) || 2000;
const NET_RETRY_MAX_MS = Number(process.env.NET_RETRY_MAX_MS) || 30000;
const NET_JITTER_MS = Number(process.env.NET_JITTER_MS) || 1000;

const CONNECTIVITY_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs) {
  if (!maxMs) return 0;
  return Math.floor(Math.random() * maxMs);
}

function isSuccessStatus(status) {
  return status >= 200 && status < 400;
}

async function probeOnce() {
  let lastError = null;
  for (const url of CHECK_URLS) {
    try {
      const response = await axios.get(url, { timeout: NET_CHECK_TIMEOUT_MS });
      if (response?.status && isSuccessStatus(response.status)) {
        return true;
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return false;
}

export async function checkConnectivity() {
  try {
    return await probeOnce();
  } catch (err) {
    return false;
  }
}

export async function waitForConnectivity({ logger, label } = {}) {
  let delay = NET_RETRY_BASE_MS;
  for (;;) {
    const ok = await checkConnectivity();
    if (ok) return;
    const message = `Network offline${label ? ` (${label})` : ''}. Waiting to retry...`;
    if (logger?.warn) {
      logger.warn(message);
    }
    await sleep(delay + jitter(NET_JITTER_MS));
    delay = Math.min(delay * 2, NET_RETRY_MAX_MS);
  }
}

export function isConnectivityError(err) {
  if (!err) return false;
  const visited = new Set();
  let current = err;
  while (current && !visited.has(current)) {
    visited.add(current);
    const code = current?.code;
    const message = (current?.message || '').toLowerCase();
    if (code && CONNECTIVITY_ERROR_CODES.has(code)) return true;
    if (message.includes('network error')) return true;
    if (message.includes('getaddrinfo') || message.includes('econn')) return true;
    current = current?.cause;
  }
  return false;
}
