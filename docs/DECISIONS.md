# Project Decisions Log

This file captures important choices made during development so they remain discoverable.

## 2023-12-13
1. **Repository Initialization & Structure**
   - Created Git repo, added `.gitignore`, `README.md`, `.env.example`, and organized docs into `docs/` with `AGENTS.md` + resume file.
   - Added `.env` (gitignored) storing Airtable token/base ID as per spec.
2. **CLI + Airtable Integration**
   - Established Node-based CLI (`jobhunt`) with commands `add-company`, `add-companies`, and `--dry-run` support.
   - Implemented Airtable client for Companies/Roles tables with idempotent upserts.
3. **Enhanced Research Pipeline**
   - Added DuckDuckGo search helpers, company site scraping, job board scanning (Greenhouse/Lever/etc.), Glassdoor/B-Corp fetchers, and heuristics for type/local flags.
   - Implemented fallback theory for PM roles: if no listing found but company clearly builds software, create a theorized PM role; otherwise return zero roles.
4. **README Commitments**
   - README now documents setup, CLI usage, and current capabilities (site crawl + ATS scan + theorized roles). Will update whenever capabilities change.
5. **Aggressive Website Resolution**
   - Resolver now probes likely domains (e.g., `company.com`, `company.io`), aggregates multiple DuckDuckGo queries, and finally falls back to Instant Answer data to lock onto official websites before scraping.
6. **Rigorous B Corp Verification**
   - B Corp detection now fetches candidate pages (B Lab directory or similar) and confirms the company name plus “Certified B Corporation” cues are present before setting the flag and evidence URL; acceptable evidence is limited to B Lab directory listings or explicit claims on the official company site.
7. **Re-Research Workflow**
   - Added `jobhunt refresh-company` command: deletes the target company and its roles from Airtable prior to re-running research to ensure clean, up-to-date records.
8. **GPT-Powered Research Enhancements**
   - Integrated OpenAI (optional via `OPENAI_API_KEY`) so GPT crafts company descriptions, infers type/local presence, and evaluates B Corp evidence using scraped context; deterministic heuristics remain as fallback.
