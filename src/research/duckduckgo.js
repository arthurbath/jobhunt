import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export async function instantAnswer(query) {
  const url = 'https://api.duckduckgo.com/';
  const params = {
    q: query,
    format: 'json',
    no_redirect: 1,
    no_html: 1,
  };
  const { data } = await axios.get(url, { params, headers: { 'User-Agent': USER_AGENT } });
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
  const params = new URLSearchParams({ q: query, ia: 'web' });
  const url = `https://duckduckgo.com/html/?${params.toString()}`;
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
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
