# aptus — project rules for AI coding assistants

## What this is

An eligibility-matching tool for Indian government job notifications (SSC, PSU,
state PSC, banking, defence). NOT a resume-builder. A user enters education +
category + DOB, and the app tells them which live notifications they're
eligible for. Real first user: the developer's brother — but built for any
number of real users, not scoped to a single person.

Secondary goal: this project is also how the developer demonstrates
production-level AI engineering skill to employers (job-ready target:
Diwali 2026). That means architecture decisions should match how real
companies structure this kind of system — but "production-grade" means
solving problems you've actually hit (measured, not guessed), never adding
infra speculatively because a company "might" use it. See
"No new tools/dependencies" below — that rule still applies at this goal too.

## Stack — best tool for the job, not locked to one language

- The split is "raw document vs. clean data," not "AI vs. everything else":
  - Python (`services/ai/`) owns the ENTIRE raw-to-clean pipeline for a
    notification: fetch/scrape → PDF/text parse → chunk & text-window
    slice → LLM extract (Pydantic structured output) → validate against
    source text → dedup. All of this runs as one continuous offline job
    per source (cron-triggered) — no HTTP hop between these steps. It
    outputs one clean, validated JSON list of posts.
  - TS (`src/`) owns everything from that clean JSON onward: one internal
    endpoint receives the list and does the Prisma write (hash-check,
    upsert), plus storage, the deterministic eligibility query, and
    serving the web form/API. Never touched by the AI service directly —
    Python hands off finished JSON, TS decides what to persist.
  - Reason for the boundary being "whole pipeline" not "just the LLM
    call": chunking/dedup/validation are plain string/object logic with no
    language ecosystem advantage either way, but splitting an offline
    batch job across a network hop per stage (TS chunks → HTTP to Python
    to extract → HTTP back to TS to dedup) is pure overhead for no
    benefit. One process owns the whole transformation, hands off once at
    the end. This also matches how ingestion/inference microservices are
    structured at real AI companies.
  - One fetch adapter per source (`services/ai/sources/<name>.py`), same
    tiny contract: `fetch() -> str`. Two shared helpers for the common
    cases (`pdf_to_text()`, `fetch_json()`) so a new source is usually
    10-15 lines of site-specific config, not a scraper written from
    scratch. Chunking, hash-check, LLM extraction, validation, and dedup
    are shared code, used by every source — never duplicated per source.
  - Scheduled fetches run concurrently (`asyncio.gather` across active
    sources), not sequentially — no task-queue framework (Celery/RQ) until
    the number of sources actually makes that necessary.
- Package manager (TS side): pnpm
- Database: PostgreSQL + Prisma ORM
- AI: direct LLM API calls (Gemini Flash-Lite / GPT-4o-mini class), structured
  output / function-calling mode — NOT free-text parsing
- Matching: plain SQL / rule-based filtering on indexed columns
  (`Post.minAge`, `maxAge`, `minEducationLevel`, etc.). No vector DB, no
  embeddings, no LangChain/LangGraph until a real multi-step flow demands
  it — do not add these speculatively. Vector search is the wrong tool for
  eligibility matching regardless of scale: eligibility is exact
  numeric/categorical comparison, not semantic similarity.
- Hosting: existing Oracle Cloud Always Free VM, Docker Compose (app +
  Postgres + the Python AI service as a third container)

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

- LLM extracts structured facts from messy text ONCE per notification, in
  the Python AI service, offline (cron-triggered, nobody waiting).
- Code (plain deterministic comparisons, in the TS backend) decides
  eligibility EVERY time a user checks. Never have the LLM compute
  eligibility itself — that's arithmetic/logic, not language understanding,
  and must be exact. The AI service and the live matching query never call
  each other — extraction and matching are separate phases that don't talk
  at request time.

## Scope discipline

- v1 = 1-2 real sources only. Do not scrape "all of India" — expand one
  source at a time, roughly every two weeks, only after the current one
  works end-to-end. Each new source surfaces a new failure mode; fixing it
  is the real skill-building, not a reason to slow the expansion cadence.
- One small site-specific "fetch" script per source (HTML scrape or PDF
  download — either way, output plain text) feeding one shared LLM "extract"
  function. Adding a source later = one small fetch script, not a rebuild.
- "Built for any number of users" does not mean pre-building
  caching/materialization layers, queues, or vector search now. It means:
  indexed columns on the match query, idempotent fetch/extract (a retry or
  re-fetch must never create duplicate Posts), and handling failure paths
  (source down, LLM returns garbage, two runs collide) — see "No new
  tools/dependencies" below. Add heavier infra only once a real, measured
  bottleneck shows up.

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
  frameworks) as much as ordinary packages — see "Stack" above. A different
  language for one isolated piece (e.g. Python for OCR) is fine when it's
  genuinely the best tool for that piece; it's not an excuse to pull in
  extra frameworks/libraries within it speculatively.
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
- Priority is real usefulness for real users, not resume/portfolio polish —
  never trade working functionality for demo polish. At the same time, the
  project doubles as proof of production-level AI engineering skill for
  hiring — architecture should match real company patterns, but only when
  driven by an actual problem in this project, never spec work. Before
  building a new feature, name what breaks it and what happens then
  (source down, LLM returns garbage, concurrent runs collide) — design the
  failure path before the happy path.
- On architecture decisions: present tradeoffs, then get his explicit call
  before implementing — don't just implement silently. He owns the
  architecture; the AI implements it.
- Keep responses concise; he is time-constrained (active job search alongside
  this build).

</content>
