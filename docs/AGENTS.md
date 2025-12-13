# Job Search Helper: Codex Agent Spec (Airtable Research + Ingestion)

This file is written for Codex. It defines the exact behavior, data model, and edge cases for a project that:
1) researches a company and its Product Management (or PM-adjacent) roles, and
2) writes structured results into an Airtable base.

## Primary goal

Given a company name (or a list of names), Codex should:
- research company facts (website, type, location, B Corp status, Glassdoor),
- infer the best matching "Area of Interest" (AOI) from existing Airtable records,
- find the company's public careers listings and identify any listings for software Product Management or PM-like roles that would be well-served by the skillset described in the attached resume (sibling file "Art Bath CV.pdf"),
- discover and attach active job listings when available and within location constraints (remote or local to San Diego county, CA),
- upsert all data into Airtable in a consistent, idempotent way (safe to run repeatedly).

## Non-goals

- Do not edit any Airtable formula fields.
- Do not fabricate facts. If unknown, leave null and record a note in logs.
- Do not store secrets in this repo.

---

## Airtable schema

This project assumes the Airtable base has exactly these tables and fields. If, when reading from the production Airtable database, Codex finds fields whose names do not match the schema described here (either updated or newly-added fields), treat the production databse as the source of truth, inform the user, and update the fields described in this document.

### 1) Areas of Interest (AOI) table

Values are user-provided (do not modify). Codex must read these to classify companies.

Fields:
- Name (text) — AOI name
- Level of Interest (single select): "Lowest" | "Low" | "Medium" | "High" | "Highest"
- Candidate Pool Size (single select): "Small" | "Medium" | "Large"

### 2) Companies table (Codex writes these)

Fields Codex must populate (when possible):
- Name (text) REQUIRED — provided by invoker
- Website (url) REQUIRED
- Careers Page (url)
- Area of Interest (link to AOI record) — Codex's best guess as to which AOI the company fits into, if any (may be null)
- Description (long text) REQUIRED — 2 sentences describing the company and its major products
- Local (checkbox / boolean) REQUIRED — TRUE if Codex can find evidence of offices in San Diego County, FALSE otherwise
- Type (single select) REQUIRED:
  - Corporate
  - Nonprofit
  - Foundation
  - Education
  - Government
  - Startup: Seed
  - Startup: Series A
  - Startup: Series B
  - Startup: Series C
  - Startup: Other/Unknown
- B Corp (checkbox / boolean) REQUIRED
- B Corp Evidence (url)
- Glassdoor Page (url)
- Glassdoor Rating (number)

Also present (read-only):
- Lookups of AOI characteristic fields (do not edit)

### 3) Roles table (Codex writes these)

Each Role record represents one role "type" at a company, optionally backed by an active listing.

Fields Codex must populate (when possible):
- Name (text) REQUIRED — e.g., "Product Manager", "Technical Program Manager"
- Company (link to Companies) REQUIRED
- Candidate Fit (single select) REQUIRED: "Low" | "Medium" | "High" - Codex's best guess as to whether the role would be a good match for the background/skills described in the attached resume (sibling file "Art Bath CV.pdf")
- Active Listing (url) — if an active listing for such a role was found, print the URL to the page where it can be viewed
- Location (single select): "San Diego" | "Remnote" | "Other" — describes whether the job listing is for in-office/hybrid in  San Diego county, a remote-only position, or "Other", meaning in-office/hybrid outside of San Diego county; only print if Active Listing exists
- Codex Commentary (long text): A place where Codex may desribe any other aspects of the company/role that it thinks I might find interesting or isues that it ran into finding information about the given company/role

Also present (read-only; never edit):
- Lookups of AOI characteristic fields
- Lookups of Company characteristic fields
- Formua fields
  - Role Candidate Fit Score
  - Role Active Listing Score
  - Role Location Score
  - Company Local Score
  - Company Type Score
  - Company Glassdoor Rating Score
  - Company B Corp Score
  - Company AOI Level of Interest Score
  - Company AOI Candidate Pool Size Score
  - Triage Score (sum)

---

## Input / output contracts

### Input

Supported inputs:
- Single company name string
- List of company names (batch)
- Single company role job listing URL

Optional hints:
- Company website (if user provides it)
- Known alternate names (e.g., "ACME Inc." vs "ACME")

### Output

- Companies table updated/created per company
- Roles table updated/created per role per company

Additionally, the program should print structured logs to stdout:
- company: string
- status: "created" | "updated" | "skipped"
- sources: list of urls used
- warnings: list of strings

---

## Research rules (must follow)

### Sources priority (most reliable first)

1) Company's official site (About, Careers, Locations)
2) Official filings/registries (where relevant)
3) Trusted business directories (Crunchbase, PitchBook snippets if accessible, Bloomberg profile pages)
4) B Lab directory for B Corp verification
5) Glassdoor for rating and link
6) Reputable news sources (for funding stage signals)

### No hallucinations

If a fact cannot be verified with a source URL:
- leave the Airtable field blank/null,
- include a warning in logs.

### Local (San Diego County) logic

Set a compmany's Local to TRUE only if you find evidence of:
- an office address in San Diego County, OR
- a company page explicitly listing "San Diego" (or a San Diego County city) as an office location.

### Startup stage classification

Only assign a specific series stage when there is clear evidence (e.g., reputable coverage or a reliable database entry).
If the org is clearly a startup but stage is unclear, use "Startup: Other/Unknown".

## Role discovery rules

For each company, search for active listings for PM and PM-adjacent roles including (non-exhaustive):
- Product Manager (PM), Senior PM, Group PM, Principal PM
- Product Operations / Product Ops
- Technical Program Manager (TPM)
- Program Manager (where it's product/tech adjacent)
- Solutions Engineer / Solutions Consultant (if product-facing and fits PM background)
- Implementation Manager / Onboarding / Customer Success (only if strongly product/ops oriented)

If no active listing can be found, theorize whether the company would require software PM or PM-like roles and describe them instead.

Identify between 0-2 roles per company. If the company does not need PM or PM-like roles, it's perfectly fine to not identify any roles.

### Candidate Fit heuristic (Codex guess)

See attached resume in the sibling file "Art Bath CV.pdf".

High:
- Product Manager, Product Ops, TPM, Solutions roles with strong product + technical requirements

Medium:
- Program Manager (ambiguous), Implementation Manager, Customer Success roles with technical/ops focus

Low:
- Pure sales, pure marketing, roles requiring certifications the user likely doesn't have

---

### Active Listing constraints

Only populate Roles.Active Listing if the listing is currently active (not archived/expired). Otherwise leave blank.

If Active Listing is present, set the role's Location value:
- to "San Diego" if the job listing indicates that the position is explicitly in-office/hybrid in San Diego County or if it is listed as in-office/hybrid and the role's associated company is located in San Diego County
- to Remote if the job listing is described as a remote position, even if the company is located in San Diego County.

---

## AOI matching algorithm

Codex must:
1) Fetch all AOI records from Airtable.
2) Compare company mission/product description against AOI names and meanings.
3) Choose at most one AOI link:
   - If a strong match exists, link it.
   - If ambiguous or no match, leave null.

IMPORTANT: Never create new AOI records.

---

## Airtable write behavior (idempotent + dedupe)

### Companies upsert key

Use a case-insensitive match on Companies.Name.
- If a record exists, update it.
- If not, create it.

### Roles upsert key

Use (CompanyRecordId + Role.Name) as a compound key.
- If a role exists for that company with same normalized name, update it.
- Else, create it.

Normalization: trim whitespace, collapse multiple spaces, lowercase.

---

## Error handling

- If Airtable API returns 429, retry with exponential backoff.
- If a field value violates Airtable schema (e.g., invalid single-select), log warning and skip that field.
- If a company has no trustworthy website found, still create the Companies record with Name + Description (best effort) and leave other fields blank.

---

## Agent model (parallelization)

When given N companies:
- Spawn 1 agent per company (logical concurrency).
- Each agent independently:
  1) resolves canonical company identity,
  2) gathers sources,
  3) builds a structured "CompanyResult" and "RoleResult[]" objects,
  4) writes to Airtable.

Agents must not write partial/fragmented data. Write company first, then roles.

---

## Data shapes (for implementation)

### CompanyResult

- name: string
- website: string | null
- careersPage: string | null
- description2Sentences: string | null
- local: boolean | null
- type: string | null  (must match allowed selects)
- bcorp: boolean | null
- glassdoorPage: string | null
- glassdoorRating: number | null
- aoiRecordId: string | null
- sources: string[]   (urls)

### RoleResult

- name: string
- candidateFit: "Low" | "Medium" | "High"
- activeListing: string | null
- localOnly: boolean | null
- sources: string[]   (urls)

---

## CLI behavior (recommended)

Example:
- `jobhunt add-company "Station A"`
- `jobhunt add-companies companies.txt`
- `jobhunt sync --dry-run`

Dry-run prints what would be written without writing.

---

## Quality bar checklist (must pass)

For each company:
- [ ] Company Name present
- [ ] Description is maximum 3 sentences
- [ ] Type is one of the allowed values or null
- [ ] Local is only TRUE with explicit SD County evidence
- [ ] If B Corp is TRUE, there is a B Lab directory source URL
- [ ] If Glassdoor Rating is filled, there is a Glassdoor source URL
- [ ] AOI is linked only if a strong match exists
- [ ] Roles have reasonable Candidate Fit values
- [ ] Active Listing only when it meets constraints
