import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const DEFAULT_BASE_URL = 'https://api.openwebninja.com';
const DEFAULT_GLASSDOOR_PATH = '/realtime-glassdoor-data/company-search';
const DEFAULT_DOMAIN = 'www.glassdoor.com';
const DEFAULT_LIMIT = 5;
const REQUEST_TIMEOUT = 12000;
const OPENWEB_DOCS_URL = 'https://www.openwebninja.com/api/real-time-glassdoor-data/docs';

function buildEndpoint(baseUrl, path) {
  const hasAbsolutePath = path && /^https?:\/\//i.test(path);
  if (hasAbsolutePath) {
    return path;
  }
  const normalizedBase = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  if (!path) {
    return normalizedBase;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function coerceFirstValue(values = []) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

function resolveCandidate(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data[0] || null;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results[0] || null;
  }
  if (payload?.data?.result) {
    return payload.data.result;
  }
  if (payload?.data?.company) {
    return payload.data.company;
  }
  if (payload?.result) {
    return payload.result;
  }
  if (payload?.company) {
    return payload.company;
  }
  return payload.data || payload;
}

function extractUrl(candidate = {}) {
  const url = coerceFirstValue([
    candidate.profileUrl,
    candidate.profile_url,
    candidate.company_link,
    candidate.companyLink,
    candidate.url,
    candidate.glassdoorUrl,
    candidate.glassdoor_url,
    candidate.link,
    candidate.siteUrl,
    candidate.site_url,
  ]);
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return url;
  }
  return null;
}

function extractRating(candidate = {}) {
  const rating = coerceFirstValue([
    candidate.rating,
    candidate.ratingValue,
    candidate.rating_value,
    candidate.overallRating,
    candidate.overall_rating,
    candidate['overall-rating'],
    candidate.glassdoorRating,
    candidate.glassdoor_rating,
    candidate.score,
    candidate.reviewRating,
    candidate.ratingScore,
    candidate.stats?.rating,
    candidate.stats?.overallRating,
    candidate.meta?.rating,
  ]);
  const numeric = Number(rating);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
}

function extractYearFounded(candidate = {}) {
  const raw = coerceFirstValue([candidate.year_founded, candidate.yearFounded, candidate.founded]);
  if (raw == null) return null;
  const numeric = Number(String(raw).replace(/[^0-9-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function extractNormalizedScore(candidate = {}, keys = []) {
  const raw = coerceFirstValue(keys.map((key) => candidate[key]));
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : null;
}

class OpenWebNinjaClient {
  constructor({ apiKey, baseUrl, glassdoorPath, domain, limit } = {}) {
    this.apiKey = apiKey || null;
    this.baseUrl = baseUrl || DEFAULT_BASE_URL;
    this.glassdoorPath = glassdoorPath || DEFAULT_GLASSDOOR_PATH;
    this.domain = domain || DEFAULT_DOMAIN;
    this.limit = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT;
  }

  isEnabled() {
    return Boolean(this.apiKey);
  }

  async fetchGlassdoorCompany(companyName) {
    if (!this.isEnabled() || !companyName) {
      return null;
    }
    const url = buildEndpoint(this.baseUrl, this.glassdoorPath);
    try {
      const params = {
        query: companyName,
      };
      if (this.domain) {
        params.domain = this.domain;
      }
      if (this.limit) {
        params.limit = this.limit;
      }
      const { data } = await axios.get(url, {
        params,
        headers: {
          'x-api-key': this.apiKey,
        },
        timeout: REQUEST_TIMEOUT,
      });
      const candidate = resolveCandidate(data);
      if (!candidate) {
        return null;
      }
      const profileUrl = extractUrl(candidate);
      const rating = extractRating(candidate);
      if (!profileUrl && rating == null) {
        return null;
      }
      const yearFounded = extractYearFounded(candidate);
      const businessOutlookRating = extractNormalizedScore(candidate, [
        'business_outlook_rating',
        'businessOutlookRating',
      ]);
      const ceoRating = extractNormalizedScore(candidate, ['ceo_rating', 'ceoRating']);
      return {
        url: profileUrl || null,
        rating,
        yearFounded,
        businessOutlookRating,
        ceoRating,
        raw: candidate,
      };
    } catch (err) {
      logger.warn(
        `OpenWeb Ninja Glassdoor lookup failed for "${companyName}": ${err.message} (see ${OPENWEB_DOCS_URL})`
      );
      return null;
    }
  }
}

export const openWebNinjaClient = new OpenWebNinjaClient(config.openWebNinja);
