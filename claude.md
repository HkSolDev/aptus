# aptus — project rules for AI coding assistants

## What this is

An eligibility-matching tool for Indian government job notifications (SSC, PSU,
state PSC, banking, defence). NOT a resume-builder. A user enters education +
category + DOB, and the app tells them which live notifications they're
eligible for. Real first user: the developer's brother.

## Stack (locked — do not suggest alternatives without being asked)

- Language: Node.js + TypeScript end-to-end (no Python, no Bun runtime)
- Package manager: pnpm
- Scraping: Cheerio (static HTML) + Playwright (JS-heavy pages)
- Database: PostgreSQL + Prisma ORM
- AI: direct LLM API calls (Gemini Flash-Lite / GPT-4o-mini class), structured
  output / function-calling mode — NOT free-text parsing
- Matching: plain SQL / rule-based filtering. No vector DB, no embeddings,
  no LangChain/LangGraph until a real multi-step flow demands it — do not add
  these speculatively.
- Hosting: existing Oracle Cloud Always Free VM, Docker Compose

## Hard rules for extraction schema

- Every eligibility field that's a number (marks %, age, years) must be its
  own numeric field — never buried inside a text sentence — so matching code
  can do direct comparisons.
- Every field must allow null/not-specified. Never let the LLM guess a
  default (e.g. inferring "General" category when unstated). Null means
  "verify manually," not a hard yes/no.
- category_relaxation_applies is a boolean per notification — some job types
  (e.g. Army) give zero category relaxation. Never assume one uniform rule
  applies across all notification types.

## Division of labor: LLM vs code

- LLM extracts structured facts from messy text ONCE per notification.
- Code (plain deterministic comparisons) decides eligibility EVERY time a
  user checks. Never have the LLM compute eligibility itself — that's
  arithmetic/logic, not language understanding, and must be exact.

## Scope discipline

- v1 = 1-2 real sources only. Do not scrape "all of India" — expand one
  source at a time, only after the current one works end-to-end.
- One small site-specific "fetch" script per source (HTML scrape or PDF
  download — either way, output plain text) feeding one shared LLM "extract"
  function. Adding a source later = one small fetch script, not a rebuild.

## v1 architecture (decided)

```
cron → fetch script per source → hash check → changed?
                                    no  → skip
                                    yes → LLM: extract structured fields (AI is ONLY here)
                                          → Postgres: notifications table
Postgres: notifications → web form (edu/category/DOB) → SQL filter → matches + URLs
```

- Scraping/extraction runs on a schedule (cron), never on a user request —
  N users just read the same pre-populated Postgres table.
- Change detection: hash the raw fetched content per source; skip LLM
  extraction if hash is unchanged since last run. No Redis — Postgres's
  hash column is the cache.
- Before sending PDF/HTML text to the LLM: trim it. Keyword-search for
  section headers (Eligibility, Age Limit, Educational Qualification,
  Category) and slice out just that window — don't send full 100+ page
  documents. No RAG/embeddings/vector DB for this; it's one document, not
  search across many.
- This is not an "agent" product — no MCP, no LangChain/LangGraph, no
  autonomous tool loop. It's a script pipeline + a plain matching query.

## File organization

Applies everywhere in this repo — backend scripts, server routes, and any
future frontend code alike. Not a backend-only rule.

- One file = one responsibility. Split when a file mixes 2+ unrelated jobs
  (HTTP plumbing, business logic, external API calls, bootstrap).
- Pure/deterministic logic (no DB, no network) goes in its own file so it's
  testable without mocks.
- Don't split a single-purpose file just because it's long.
- Deletion test: before extracting something into its own file, check that
  doing so actually reduces complexity somewhere — not just relocates it.
- Only pull shared logic into its own file once it's duplicated in 2+ real
  call sites. One caller isn't a reason to pre-split.
- No duplicate logic — once the same calculation exists in 2+ files, it
  belongs in one shared function, imported by both.

## Comments

- Default to no comments. Well-named functions/variables should explain
  themselves.
- Only comment the WHY when it's non-obvious: a hidden constraint, a
  workaround for a specific bug, a subtle invariant a reader would get wrong
  otherwise. (Example already in this repo: the dotenv-import-order note.)
- Never comment WHAT the code does — that's what reading the code is for.
- Never write comments referencing the current task/PR/issue ("added for X
  feature", "fix for #123") — these rot as the code evolves.
- No multi-paragraph doc comments unless explicitly asked.

## No new tools/dependencies until a real need forces it

- Don't introduce a new AI technique, library, or dependency speculatively —
  wait until the project actually hits a wall that the current stack can't
  solve, then add exactly what's needed for that.
- This includes AI-specific additions (RAG, embeddings, agents, new
  frameworks) as much as ordinary packages — see "Stack (locked)" above.
- Reason: the developer is learning AI/ML just-in-time, from real problems he
  hits — not by pre-loading tools/theory he hasn't needed yet. Let him ask
  for something new once he feels the gap himself.

## How to work with this developer

- He is a 2.5-year fullstack/backend dev (Solana/Rust background) learning
  AI/ML just-in-time, only as the project needs it — do not front-load theory
  he hasn't asked for.
- Keep generated code SHORT per step — one small, self-contained piece at a
  time. He wants to read and verify every line, not review long AI-generated
  blocks he'd be tempted to accept unread. If a change is genuinely large,
  split it into stages rather than one big diff.
- Explain what changed and why in plain terms before/alongside the code.
- Priority is real usefulness for his brother, not resume/portfolio polish —
  never trade working functionality for demo polish.
- Keep responses concise; he is time-constrained (active job search alongside
  this build).

</content>
