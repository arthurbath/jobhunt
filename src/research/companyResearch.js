import axios from 'axios';
import * as cheerio from 'cheerio';
import { instantAnswer, searchWeb } from './duckduckgo.js';
import { discoverProductRoles } from './jobBoards.js';
import { resolveCompanyWebsite, scrapeCompanySite } from './siteScraper.js';
import {
  findSanDiegoMentions,
  inferCompanyTypeAdvanced,
  SAN_DIEGO_CITIES,
  truncateSentences,
} from '../utils/text.js';
import {
  generateCompanyInsights,
  evaluateBcorpStatus,
  isOpenAIEnabled,
  researchLocalPresence,
  researchCompanyType,
} from '../services/gptResearcher.js';
import { openWebNinjaClient } from '../services/openWebNinja.js';

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

const TYPESENSE_HOSTS = [
  'https://94eo8lmsqa0nd3j5p.a1.typesense.net',
  'https://94eo8lmsqa0nd3j5p-1.a1.typesense.net',
  'https://94eo8lmsqa0nd3j5p-2.a1.typesense.net',
  'https://94eo8lmsqa0nd3j5p-3.a1.typesense.net',
  'https://94eo8lmsqa0nd3j5p-4.a1.typesense.net',
  'https://94eo8lmsqa0nd3j5p-5.a1.typesense.net',
];
const TYPESENSE_COLLECTION = 'companies-production-en-us';
const TYPESENSE_API_KEY = process.env.BCORP_TYPESENSE_KEY || 'IpJoOPZUczKNxR54gCnU8sjVNGCyXj21';
const TYPESENSE_QUERY_BY =
  'name,description,websiteKeywords,countries,industry,sector,hqCountry,hqProvince,hqCity,hqPostalCode,provinces,cities,size,demographicsList';
const DIRECTORY_PROFILE_URL = (slug) =>
  `https://www.bcorporation.net/en-us/find-a-b-corp/company/${slug}`;
const COMPANY_TYPE_VALUES = new Set([
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
]);
function normalizeForMatch(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function htmlToPlainText(html = '') {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $('body').text().replace(/\s+/g, ' ').trim();
}

async function fetchPageText(url) {
  if (!url) return null;
  try {
    const { data } = await axios.get(url, { headers: REQUEST_HEADERS, timeout: 12000 });
    if (typeof data === 'string') return data;
    return null;
  } catch (err) {
    return null;
  }
}

async function scrapeGlassdoorRating(url) {
  const html = await fetchPageText(url);
  if (!html) return null;
  const $ = cheerio.load(html);
  const rating =
    $('[data-test=\"rating\"]').first().text().trim() ||
    $('span[itemprop=\"ratingValue\"]').first().text().trim() ||
    $('div.v2__EIReviewsRatingsStylesV2__ratingNum').first().text().trim();
  const value = Number(rating);
  return Number.isFinite(value) ? value : null;
}

export class CompanyResearcher {
  constructor(name, { skipGlassdoor = false } = {}) {
    this.name = name;
    this.lastScrapedWebsiteHtml = null;
    this.lastScrapedWebsiteUrl = null;
    this.lastScrapedWebsiteText = null;
    this.lastInstantAnswerText = null;
    this.internalWarnings = new Set();
    this.skipGlassdoor = skipGlassdoor;
  }

  async research() {
    const sourcesSet = new Set();
    const baseResult = {
      name: this.name,
      website: null,
      careersPage: null,
      description2Sentences: null,
      type: null,
      bcorp: null,
      bcorpEvidence: null,
      glassdoorPage: null,
      glassdoorRating: null,
      glassdoorYearFounded: null,
      glassdoorBusinessOutlookRating: null,
      glassdoorCeoRating: null,
      roles: [],
      sources: [],
      warnings: [],
    };

    const summary = await this.collectGeneralInfo();
    Object.assign(baseResult, summary);
    if (summary.warnings?.length) {
      baseResult.warnings.push(...summary.warnings);
    }
    summary.sources?.forEach((src) => sourcesSet.add(src));

    await this.applyGptInsights(baseResult, summary);
    await this.applyGptLocalResearch(baseResult, summary, sourcesSet);
    await this.applyGptTypeResearch(baseResult, summary, sourcesSet);

    const [careers, bcorp, glassdoor] = await Promise.all([
      this.findCareersPage(summary.candidateCareersPage, summary.website),
      this.findBCorpEvidence(),
      this.skipGlassdoor ? Promise.resolve(null) : this.findGlassdoorPage(),
    ]);

    if (careers?.url) {
      baseResult.careersPage = careers.url;
      sourcesSet.add(careers.url);
    }
    if (bcorp?.url) {
      baseResult.bcorp = true;
      baseResult.bcorpEvidence = bcorp.url;
      sourcesSet.add(bcorp.url);
    } else {
      baseResult.bcorp = false;
    }
    if (glassdoor?.url) {
      baseResult.glassdoorPage = glassdoor.url;
      baseResult.glassdoorRating = glassdoor.rating;
      baseResult.glassdoorYearFounded = glassdoor.yearFounded ?? null;
      baseResult.glassdoorBusinessOutlookRating = glassdoor.businessOutlookRating ?? null;
      baseResult.glassdoorCeoRating = glassdoor.ceoRating ?? null;
      sourcesSet.add(glassdoor.url);
    }

    let roles = await this.discoverRoles({
      companyName: this.name,
      website: baseResult.website,
      careersPage: baseResult.careersPage,
    });
    if (!roles.length) {
      const theorized = this.theorizeRole({
        description: baseResult.description2Sentences,
        bodyText: summary.bodyText,
        website: baseResult.website,
      });
      if (theorized) {
        roles = [theorized];
      }
    }
    // If no active listing nor convincing signals exist, it's acceptable to return zero roles.
    baseResult.roles = roles;

    baseResult.type =
      baseResult.type ||
      inferCompanyTypeAdvanced(
        baseResult.description2Sentences || '',
        summary.bodyText || ''
      );

    baseResult.sources = Array.from(sourcesSet);
    if (this.internalWarnings.size) {
      baseResult.warnings.push(...Array.from(this.internalWarnings));
    }
    return baseResult;
  }

  async collectGeneralInfo() {
    const info = {
      description2Sentences: null,
      website: null,
      local: null,
      type: null,
      sources: [],
      warnings: [],
      candidateCareersPage: null,
      bodyText: '',
    };
    try {
      const website = await resolveCompanyWebsite(this.name);
      info.website = website;
      if (website) {
        info.sources.push(website);
        const profile = await scrapeCompanySite(website);
        if (profile) {
          info.bodyText = profile.bodyText || '';
          info.description2Sentences = profile.description || null;
          info.candidateCareersPage = profile.candidateCareersPage;
          profile.sources?.forEach((src) => info.sources.push(src));
          if (profile.rawHtml) {
            this.lastScrapedWebsiteHtml = profile.rawHtml;
            this.lastScrapedWebsiteUrl = profile.primaryUrl || website;
            this.lastScrapedWebsiteText = htmlToPlainText(profile.rawHtml);
          }
        }
      }

      const data = await instantAnswer(this.name);
      if (!info.website) {
        info.website = data.AbstractURL || (data.Results && data.Results[0]?.FirstURL) || null;
        if (info.website) info.sources.push(info.website);
      }
      if (!info.description2Sentences) {
        info.description2Sentences = truncateSentences(
          data.Abstract || data.Description || data.Heading || '',
          2
        );
      }
      this.lastInstantAnswerText =
        data.AbstractText ||
        data.Abstract ||
        data.Text ||
        data.Description ||
        data.Heading ||
        '';
      info.type = info.description2Sentences
        ? inferCompanyTypeAdvanced(info.description2Sentences, info.bodyText)
        : null;
    } catch (err) {
      info.warnings.push(`Failed to gather initial profile: ${err.message}`);
    }
    info.sources = Array.from(new Set(info.sources.filter(Boolean)));
    return info;
  }

  async findCareersPage(hintUrl, website) {
    if (hintUrl) {
      return { url: hintUrl };
    }
    const candidates = [];
    if (website) {
      candidates.push(`${website.replace(/\/$/, '')}/careers`);
      candidates.push(`${website.replace(/\/$/, '')}/jobs`);
    }
    for (const candidate of candidates) {
      const html = await fetchPageText(candidate);
      if (html) {
        return { url: candidate };
      }
    }
    const results = await searchWeb(`${this.name} careers`, 6);
    return results.find((r) => /career|jobs|join/.test(r.url)) || results[0] || null;
  }

  async findBCorpEvidence() {
    const directoryResults = await this.fetchDirectoryResults();
    const officialSite =
      this.lastScrapedWebsiteText && this.lastScrapedWebsiteUrl
        ? { url: this.lastScrapedWebsiteUrl, text: this.lastScrapedWebsiteText }
        : null;

    const searchSummary = directoryResults?.summary || '';
    const directMatch = directoryResults?.hits.find(
      (hit) => hit.isCertified && this.isMatchingCompanyName(hit.name)
    );
    if (directMatch?.profileUrl) {
      return { url: directMatch.profileUrl };
    }

    if (isOpenAIEnabled()) {
      try {
        const verdict = await evaluateBcorpStatus({
          name: this.name,
          directorySummary: searchSummary,
          officialSite,
        });
        if (verdict?.isBcorp) {
          return { url: verdict.evidenceUrl || directoryResults?.searchUrl || directMatch?.profileUrl || this.lastScrapedWebsiteUrl || null };
        }
      } catch (err) {
        this.warnOnce('GPT B Corp evaluation failed', err);
      }
    } else {
      this.warnOnce('GPT B Corp evaluation skipped (OpenAI disabled).');
    }

    if (directMatch?.profileUrl) {
      return { url: directMatch.profileUrl };
    }

    const verifiedOfficial = await this.scanOfficialSiteForBCorpClaim();
    if (verifiedOfficial) {
      return verifiedOfficial;
    }

    return null;
  }

  async scanOfficialSiteForBCorpClaim() {
    if (!this.lastScrapedWebsiteText) return null;
    const normalizedPage = normalizeForMatch(this.lastScrapedWebsiteText);
    const normalizedName = normalizeForMatch(this.name);
    const hasClaim =
      normalizedPage.includes('certifiedbcorp') ||
      normalizedPage.includes('certifiedbcorporation') ||
      normalizedPage.includes('bcorp');
    if (hasClaim && normalizedPage.includes(normalizedName)) {
      return { url: this.lastScrapedWebsiteUrl };
    }
    return null;
  }

  async findGlassdoorPage() {
    if (this.skipGlassdoor) {
      return null;
    }
    const apiResult = await this.fetchGlassdoorViaOpenWeb();
    if (apiResult) {
      return apiResult;
    }
    const results = await searchWeb(`${this.name} Glassdoor`, 6);
    const glassdoorResult = results.find((r) => r.url.includes('glassdoor.com'));
    if (!glassdoorResult) return null;
    const rating = await scrapeGlassdoorRating(glassdoorResult.url);
    return {
      url: glassdoorResult.url,
      rating,
    };
  }

  async fetchGlassdoorViaOpenWeb() {
    if (this.skipGlassdoor) {
      return null;
    }
    if (!openWebNinjaClient?.isEnabled?.()) {
      return null;
    }
    try {
      const payload = await openWebNinjaClient.fetchGlassdoorCompany(this.name);
      if (!payload) {
        return null;
      }
      const { url, rating, yearFounded, businessOutlookRating, ceoRating } = payload;
      if (!url && rating == null) {
        return null;
      }
      return {
        url: url || null,
        rating: rating ?? null,
        yearFounded: yearFounded ?? null,
        businessOutlookRating: businessOutlookRating ?? null,
        ceoRating: ceoRating ?? null,
      };
    } catch (err) {
      this.warnOnce('OpenWeb Ninja Glassdoor lookup failed', err);
      return null;
    }
  }

  async discoverRoles({ companyName, website, careersPage }) {
    return discoverProductRoles({ companyName, website, careersPage });
  }

  async applyGptInsights(baseResult, summary) {
    if (!isOpenAIEnabled()) {
      this.warnOnce('GPT insights skipped (OpenAI disabled).');
      return;
    }
    try {
      const insights = await generateCompanyInsights({
        name: this.name,
        websiteText: summary.bodyText || this.lastScrapedWebsiteText || '',
        instantAnswerText: this.lastInstantAnswerText || '',
        extraFacts: summary.description2Sentences || '',
      });
      if (!insights) return;
      if (insights.description) {
        baseResult.description2Sentences = insights.description;
      }
      if (insights.companyType && COMPANY_TYPE_VALUES.has(insights.companyType)) {
        baseResult.type = insights.companyType;
      }
    } catch (error) {
      this.warnOnce('GPT insights failed', error);
    }
  }

  async applyGptLocalResearch(baseResult, summary, sourcesSet) {
    if (!isOpenAIEnabled()) {
      this.warnOnce('GPT local research skipped (OpenAI disabled).');
      return;
    }
    try {
      const searchResults = await this.fetchLocalSearchResults();
      const verdict = await researchLocalPresence({
        name: this.name,
        website: summary.website || baseResult.website,
        description: summary.description2Sentences || '',
        websiteText: summary.bodyText || '',
        searchResults,
      });
      if (
        verdict &&
        typeof verdict.isSanDiegoLocal === 'boolean' &&
        (verdict.isSanDiegoLocal ? verdict.evidenceUrls?.length : true)
      ) {
        baseResult.local = verdict.isSanDiegoLocal;
        verdict.evidenceUrls?.forEach((url) => {
          if (url) sourcesSet.add(url);
        });
      } else if (verdict?.isSanDiegoLocal) {
        this.warnOnce('GPT local research returned TRUE without evidence URLs.');
        baseResult.local = false;
      }
    } catch (error) {
      this.warnOnce('GPT local research failed', error);
    }
  }

  async applyGptTypeResearch(baseResult, summary, sourcesSet) {
    if (!isOpenAIEnabled()) {
      this.warnOnce('GPT type research skipped (OpenAI disabled).');
      return;
    }
    try {
      const searchResults = await this.fetchTypeSearchResults();
      const verdict = await researchCompanyType({
        name: this.name,
        website: summary.website || baseResult.website,
        description: summary.description2Sentences || '',
        websiteText: summary.bodyText || '',
        searchResults,
      });
      if (
        verdict?.companyType &&
        COMPANY_TYPE_VALUES.has(verdict.companyType) &&
        verdict.evidenceUrls?.length
      ) {
        baseResult.type = verdict.companyType;
        verdict.evidenceUrls.forEach((url) => {
          if (url) sourcesSet.add(url);
        });
      } else if (verdict?.companyType) {
        this.warnOnce('GPT type research returned a type without evidence URLs.');
      }
    } catch (error) {
      this.warnOnce('GPT type research failed', error);
    }
  }

  async fetchLocalSearchResults() {
    const primaryQueries = [
      `${this.name} "San Diego" office`,
      `${this.name} "San Diego" location`,
      `${this.name} "San Diego" headquarters`,
    ];
    const cityQueries = SAN_DIEGO_CITIES.filter((city) => city !== 'san diego').map(
      (city) => `${this.name} "${city}" office`
    );
    const queries = [...primaryQueries, ...cityQueries];
    const seen = new Set();
    const results = [];
    let positiveMentions = 0;
    const MAX_RESULTS = 18;

    for (const query of queries) {
      let hits = [];
      try {
        hits = await searchWeb(query, 3);
      } catch (err) {
        this.warnOnce(`Local search failed for "${query}"`, err);
        continue;
      }
      for (const hit of hits) {
        if (!hit?.url || seen.has(hit.url)) continue;
        seen.add(hit.url);
        const snippet = hit.snippet || '';
        results.push({
          query,
          title: hit.title,
          url: hit.url,
          snippet,
        });
        if (findSanDiegoMentions(snippet).length) {
          positiveMentions += 1;
        }
        if (results.length >= MAX_RESULTS || positiveMentions >= 3) {
          return results;
        }
      }
    }
    return results;
  }

  async fetchTypeSearchResults() {
    const queries = [
      `${this.name} Crunchbase`,
      `${this.name} GuideStar`,
      `${this.name} organization profile`,
      `${this.name} company overview`,
    ];
    const preferredDomains = ['crunchbase.com', 'guidestar.org', 'pitchbook.com', 'bloomberg.com'];
    const results = [];
    const seen = new Set();
    const MAX_RESULTS = 16;

    for (const query of queries) {
      let hits = [];
      try {
        hits = await searchWeb(query, 5);
      } catch (err) {
        this.warnOnce(`Type search failed for "${query}"`, err);
        continue;
      }
      for (const hit of hits) {
        if (!hit?.url || seen.has(hit.url)) continue;
        seen.add(hit.url);
        let domain = null;
        try {
          domain = new URL(hit.url).hostname.replace(/^www\./, '');
        } catch (err) {
          domain = null;
        }
        if (preferredDomains.length && domain) {
          const matchesPreferred = preferredDomains.some((d) => domain.endsWith(d));
          if (!matchesPreferred && results.length >= MAX_RESULTS / 2) {
            continue;
          }
        }
        results.push({
          query,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          domain,
        });
        if (results.length >= MAX_RESULTS) {
          return results;
        }
      }
    }
    return results;
  }

  theorizeRole({ description, bodyText, website }) {
    const corpus = `${description || ''} ${bodyText || ''}`.toLowerCase();
    const productSignals = ['software', 'platform', 'product', 'saas', 'app', 'digital', 'tech', 'data', 'api'];
    const pmSignals = ['product manager', 'product ops', 'product operations', 'technical program'];
    const industrySignals = ['climate tech', 'ai', 'machine learning', 'analytics', 'marketplace', 'cloud', 'infrastructure'];
    const hasProductSignal =
      productSignals.some((token) => corpus.includes(token)) ||
      pmSignals.some((token) => corpus.includes(token));
    const hasIndustrySignal = industrySignals.some((token) => corpus.includes(token));
    if (!hasProductSignal && !hasIndustrySignal) {
      return null;
    }
    const commentaryPieces = [];
    if (hasProductSignal) commentaryPieces.push('Company materials emphasize software/product work.');
    if (hasIndustrySignal) commentaryPieces.push('Industry context implies dedicated product leadership.');
    const commentary = commentaryPieces.join(' ');
    const sources = website ? [website] : [];
    return {
      name: 'Product Manager (theorized)',
      candidateFit: 'High',
      activeListing: null,
      location: null,
      sources,
      commentary: commentary || 'Likely leverages PM roles despite no active postings.',
    };
  }
  warnOnce(message, error) {
    const text = error?.message ? `${message}: ${error.message}` : message;
    if (!this.internalWarnings.has(text)) {
      this.internalWarnings.add(text);
    }
  }

  async fetchDirectoryResults() {
    const params = {
      q: this.name,
      query_by: TYPESENSE_QUERY_BY,
      per_page: 25,
    };
    for (const host of TYPESENSE_HOSTS) {
      try {
        const { data } = await axios.get(
          `${host}/collections/${TYPESENSE_COLLECTION}/documents/search`,
          {
            params,
            headers: { 'X-TYPESENSE-API-KEY': TYPESENSE_API_KEY },
            timeout: 9000,
          }
        );
        const hits = (data?.hits || []).map((hit) => {
          const doc = hit.document || {};
          return {
            name: doc.name || '',
            slug: doc.slug || '',
            isCertified: Boolean(doc.isCertified),
            description: doc.description || '',
            score: hit?.highlight || null,
            profileUrl: doc.slug ? DIRECTORY_PROFILE_URL(doc.slug) : null,
          };
        });
        const summary = hits
          .map(
            (hit, idx) =>
              `Result ${idx + 1}: name="${hit.name}" slug="${hit.slug}" certified=${hit.isCertified} url=${hit.profileUrl || 'n/a'}`
          )
          .join('\n');
        return {
          hits,
          summary,
          searchUrl: `https://www.bcorporation.net/en-us/find-a-b-corp/?query=${encodeURIComponent(this.name)}`,
        };
      } catch (err) {
        // try next host
        continue;
      }
    }
    this.warnOnce('Failed to fetch B Corp directory results');
    return null;
  }

  isMatchingCompanyName(candidate) {
    if (!candidate) return false;
    const normalizedTarget = normalizeForMatch(this.name);
    const normalizedCandidate = normalizeForMatch(candidate);
    if (!normalizedCandidate || !normalizedTarget) return false;
    return (
      normalizedCandidate === normalizedTarget ||
      normalizedCandidate.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedCandidate)
    );
  }
}
