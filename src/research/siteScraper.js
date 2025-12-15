import axios from 'axios';
import * as cheerio from 'cheerio';
import { instantAnswer, searchWeb } from './duckduckgo.js';
import { findSanDiegoMentions, truncateSentences } from '../utils/text.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const GENERIC_DOMAINS = ['facebook.com', 'linkedin.com', 'twitter.com', 'crunchbase.com', 'glassdoor.com'];
const CAREERS_KEYWORDS = ['career', 'careers', 'jobs', 'join', 'opportunities'];
const ABOUT_PATHS = ['about', 'about-us', 'company', 'mission'];
const CORPORATE_SUFFIXES = ['inc', 'inc.', 'co', 'co.', 'corp', 'corp.', 'company', 'llc', 'l.l.c', 'ltd', 'ltd.'];

function normalizeCompanySlug(name = '') {
  if (!name) return '';
  const tokens = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length && CORPORATE_SUFFIXES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens[0] === 'the' && tokens.length > 1) {
    tokens.shift();
  }
  return tokens.join('');
}

function buildDomainCandidates(slug) {
  if (!slug) return [];
  const bases = new Set([slug]);
  if (slug.startsWith('the')) bases.add(slug.replace(/^the/, ''));
  const tlds = ['.com', '.co', '.io', '.ai', '.org', '.net'];
  const urls = [];
  bases.forEach((base) => {
    for (const tld of tlds) {
      urls.push(`https://${base}${tld}`);
    }
  });
  return urls;
}

async function fetchHtml(url) {
  if (!url) return null;
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 12000,
    });
    if (typeof data === 'string') return data;
    return null;
  } catch (err) {
    return null;
  }
}

function scoreSearchUrl(url = '', slug = '') {
  if (!url) return -Infinity;
  let score = 0;
  if (GENERIC_DOMAINS.some((domain) => url.includes(domain))) score -= 3;
  if (/wikipedia\.org/.test(url)) score += 2;
  if (/press|news|blog/.test(url)) score += 1;
  if (/about|company|careers/.test(url)) score += 1;
  if (slug) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const normalizedHost = host.replace(/[^a-z0-9]/g, '');
      if (normalizedHost.includes(slug)) score += 5;
    } catch (err) {
      // ignore URL parse errors
    }
  }
  return score;
}

function absolutize(base, path) {
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  try {
    const full = new URL(path, base);
    return full.toString();
  } catch (err) {
    return null;
  }
}

function extractMeta($) {
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const title = $('title').first().text() || $('h1').first().text();
  return {
    description,
    title,
  };
}

function collectBodies($) {
  const paragraphs = [];
  $('p').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 40) paragraphs.push(text);
  });
  return paragraphs.join(' ');
}

function discoverCareersLink($, baseUrl) {
  let href = null;
  $('a').each((_, el) => {
    const text = $(el).text().toLowerCase();
    const candidate = $(el).attr('href');
    if (!candidate) return;
    if (CAREERS_KEYWORDS.some((keyword) => text.includes(keyword) || candidate.toLowerCase().includes(keyword))) {
      href = absolutize(baseUrl, candidate);
      return false;
    }
    return undefined;
  });
  return href;
}

export async function resolveCompanyWebsite(companyName) {
  const slug = normalizeCompanySlug(companyName);
  const domainCandidates = buildDomainCandidates(slug).slice(0, 10);
  for (const candidate of domainCandidates) {
    const html = await fetchHtml(candidate);
    if (html) {
      return candidate;
    }
  }

  const queries = [
    `${companyName} official site`,
    `${companyName} company`,
    `${companyName} homepage`,
  ];
  const seen = new Set();
  const combinedResults = [];
  for (const query of queries) {
    const results = await searchWeb(query, 8);
    for (const result of results) {
      if (!result?.url || seen.has(result.url)) continue;
      seen.add(result.url);
      combinedResults.push(result);
    }
  }

  let best = null;
  let bestScore = -Infinity;
  for (const result of combinedResults) {
    const score = scoreSearchUrl(result.url, slug);
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }
  if (best?.url) {
    return best.url;
  }

  try {
    const data = await instantAnswer(companyName);
    return data.AbstractURL || (data.Results && data.Results[0]?.FirstURL) || null;
  } catch (err) {
    return null;
  }
}

export async function scrapeCompanySite(website) {
  if (!website) return null;
  const uniqueSources = new Set();
  const profile = {
    description: null,
    title: null,
    bodyText: '',
    locationMentions: [],
    candidateCareersPage: null,
    sources: [],
    rawHtml: '',
  };

  const baseHtml = await fetchHtml(website);
  if (baseHtml) {
    uniqueSources.add(website);
    const $ = cheerio.load(baseHtml);
    const meta = extractMeta($);
    profile.description = truncateSentences(meta.description || '', 3) || null;
    profile.title = meta.title;
    profile.bodyText = collectBodies($);
    profile.candidateCareersPage = discoverCareersLink($, website) || profile.candidateCareersPage;
    profile.locationMentions = findSanDiegoMentions($.text());
    profile.rawHtml = baseHtml;
  }

  // Try known about pages for richer copy
  for (const segment of ABOUT_PATHS) {
    const candidate = absolutize(website, `/${segment}`);
    if (!candidate || uniqueSources.has(candidate)) continue;
    const html = await fetchHtml(candidate);
    if (!html) continue;
    uniqueSources.add(candidate);
    const $ = cheerio.load(html);
    if (!profile.description) {
      const meta = extractMeta($);
      profile.description = truncateSentences(meta.description || collectBodies($), 3) || profile.description;
    }
    if (!profile.candidateCareersPage) {
      profile.candidateCareersPage = discoverCareersLink($, website) || profile.candidateCareersPage;
    }
    profile.bodyText += ` ${collectBodies($)}`;
    profile.locationMentions = [...new Set([...profile.locationMentions, ...findSanDiegoMentions($.text())])];
  }

  profile.sources = Array.from(uniqueSources);
  profile.primaryUrl = website;
  return profile;
}
