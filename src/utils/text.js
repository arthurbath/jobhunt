export const SAN_DIEGO_CITIES = [
  'san diego',
  'carlsbad',
  'encinitas',
  'vista',
  'oceanside',
  'escondido',
  'chula vista',
  'del mar',
  'poway',
  'la jolla',
  'san marcos',
  'solana beach',
  'imperial beach',
  'santee',
];

export function truncateSentences(text, maxSentences = 2) {
  if (!text) return null;
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, maxSentences).join(' ').trim();
}

export function normalizeRoleName(name = '') {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function inferCandidateFit(title = '') {
  const lower = title.toLowerCase();
  if (/(product manager|product management|product owner|tpm|technical program)/.test(lower)) {
    return 'High';
  }
  if (/(program manager|implementation|solutions|customer success|onboarding)/.test(lower)) {
    return 'Medium';
  }
  return 'Low';
}

export function inferRoleLocation(snippet = '') {
  const lower = snippet.toLowerCase();
  if (lower.includes('san diego')) {
    return 'San Diego';
  }
  if (lower.includes('remote')) {
    return 'Remote';
  }
  return 'Other';
}

export function inferCompanyType(description = '') {
  return inferCompanyTypeAdvanced(description, '');
}

export function inferLocality(text = '') {
  const lower = text.toLowerCase();
  return SAN_DIEGO_CITIES.some((city) => lower.includes(city));
}

export function findSanDiegoMentions(text = '') {
  const lower = text.toLowerCase();
  return SAN_DIEGO_CITIES.filter((city) => lower.includes(city));
}

export function inferCompanyTypeAdvanced(description = '', bodyText = '') {
  const combined = `${description} ${bodyText}`.toLowerCase();
  if (/nonprofit|non-profit|501c3/.test(combined)) return 'Nonprofit';
  if (/university|college|school|academy|education/.test(combined)) return 'Education';
  if (/county|city of|state of|municipal|government agency/.test(combined)) return 'Government';
  if (/foundation|philanthropy/.test(combined)) return 'Foundation';
  if (/seed round|pre-seed/.test(combined)) return 'Startup: Seed';
  if (/series a/.test(combined)) return 'Startup: Series A';
  if (/series b/.test(combined)) return 'Startup: Series B';
  if (/series c/.test(combined)) return 'Startup: Series C';
  if (/startup|venture-backed|vc-funded|emerging company/.test(combined)) return 'Startup: Other/Unknown';
  return 'Corporate';
}
