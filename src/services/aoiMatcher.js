export function matchAOI(records, companyDescription, companyName) {
  if (!records?.length) return null;
  const haystack = `${companyName || ''} ${companyDescription || ''}`.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const record of records) {
    const name = record.fields?.Name?.toLowerCase();
    if (!name) continue;
    const tokens = name.split(/\s+/).filter(Boolean);
    let score = 0;
    tokens.forEach((token) => {
      if (haystack.includes(token)) score += 1;
    });
    if (score > bestScore) {
      best = record;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}
