import axios from 'axios';
import * as cheerio from 'cheerio';
import { searchWeb } from './duckduckgo.js';
import { inferCandidateFit, inferRoleLocation, normalizeRoleName } from '../utils/text.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ATS_PATTERNS = [
  /boards\.greenhouse\.io\/[^/]+\/jobs\//i,
  /jobs\.lever\.co\//i,
  /jobs\.ashbyhq\.com\//i,
  /workable\.com\/j\//i,
  /jobs\.jobvite\.com\//i,
  /myworkdayjobs\.com\//i,
  /bamboohr\.com\/jobs\//i,
  /smartrecruiters\.com\//i,
  /adp\.com\/careers/i,
];

const PRODUCT_KEYWORDS = ['product manager', 'product management', 'product operations', 'technical program manager', 'program manager'];

async function fetchJobPage(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 12000,
    });
    return typeof data === 'string' ? data : null;
  } catch (err) {
    return null;
  }
}

function extractLinksFromHtml(html, baseUrl) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const links = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const absolute = absolutize(baseUrl, href);
    if (!absolute) return;
    if (ATS_PATTERNS.some((pattern) => pattern.test(absolute))) {
      links.push(absolute);
    }
  });
  return links;
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

function parseJobDetails(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const candidateTitle = $('h1').first().text().trim() || $('title').text().trim();
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const locationMatch = bodyText.match(/Location[:\s]+([^\n]+)/i);
  const locationText = locationMatch ? locationMatch[1] : bodyText.slice(0, 400);
  return {
    title: candidateTitle,
    locationHint: locationText,
    snippet: bodyText.slice(0, 500),
  };
}

function isProductRole(title = '') {
  const lower = title.toLowerCase();
  return PRODUCT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export async function discoverProductRoles({ companyName, website, careersPage }) {
  const candidateLinks = new Set();
  const inspectPages = [];
  if (careersPage) inspectPages.push(careersPage);
  if (website) {
    inspectPages.push(`${website.replace(/\/$/, '')}/careers`);
    inspectPages.push(`${website.replace(/\/$/, '')}/jobs`);
  }

  for (const page of inspectPages) {
    if (!page) continue;
    const html = await fetchJobPage(page);
    const links = extractLinksFromHtml(html, page);
    links.forEach((link) => candidateLinks.add(link));
  }

  const searchQueries = [
    `${companyName} "Product Manager" job`,
    `${companyName} "Product Operations" job`,
    `${companyName} "Technical Program Manager" job`,
  ];
  for (const query of searchQueries) {
    const results = await searchWeb(query, 6);
    for (const res of results) {
      if (ATS_PATTERNS.some((pattern) => pattern.test(res.url))) {
        candidateLinks.add(res.url);
      }
    }
  }

  const roles = [];
  for (const link of candidateLinks) {
    if (roles.length >= 2) break;
    const html = await fetchJobPage(link);
    const details = parseJobDetails(html);
    if (!details?.title) continue;
    if (!isProductRole(details.title)) continue;
    const normalized = normalizeRoleName(details.title);
    if (roles.some((role) => normalizeRoleName(role.name) === normalized)) continue;
    roles.push({
      name: details.title,
      activeListing: link,
      location: inferRoleLocation(details.locationHint || ''),
      candidateFit: inferCandidateFit(details.title),
      sources: [link],
      commentary: details.snippet ? `Excerpt: ${details.snippet.slice(0, 160)}...` : null,
    });
  }

  return roles;
}
