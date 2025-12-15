# Jobhunt

CLI/agent that researches target companies and PM-friendly roles, then syncs results into Airtable per `docs/AGENTS.md`.

## Getting Started
1. Copy `.env.example` to `.env` and fill Airtable token/base ID (see `docs/AGENTS.md` for details). Add `OPENAI_API_KEY` if you want GPT-powered research.
2. Install dependencies: `npm install`.
3. Run commands through the CLI (examples below).

## Usage

```bash
# Research a single company
jobhunt add-company "Station A"

# Research multiple companies from a newline-delimited file
jobhunt add-companies companies.txt

# Delete existing Airtable records for a company and re-run research
jobhunt refresh-company "Station A"

# Preview without writing to Airtable
jobhunt --dry-run add-company "Station A"
```

The CLI prints structured logs per company, showing write status, sources, and warnings.

## Implementation Notes
- Research pipeline:
  - Resolves official websites via direct domain heuristics and multiple DuckDuckGo queries (with Instant Answer fallback), then scrapes homepage/about/careers content for descriptions, location clues, and careers links.
  - GPT (OpenAI) interprets the scraped text + search snippets to craft the two-sentence description, infer company type/local presence, and judge B Corp status. If GPT is unavailable, heuristics are used.
  - B Corp status only flips to TRUE when GPT (or deterministic fallback) finds evidence in the official B Lab directory listing or the company’s own statement claiming Certified B Corp status.
  - Crawls careers pages and common ATS job boards (Greenhouse, Lever, Ashby, Workday, etc.) for active PM/PM-adjacent listings; if none exist but the company clearly builds software, records a theorized PM role; otherwise leaves roles empty.
- Airtable writes are idempotent via name-based upserts for companies and (company, role name) for roles.
- `jobhunt refresh-company` removes the existing company + role records in Airtable before running a fresh research cycle, ensuring stale data can be replaced cleanly.
- Extend `src/research/companyResearch.js` plus helpers in `src/research/` if you need even richer data sources (Crunchbase, LinkedIn Jobs, etc.).
