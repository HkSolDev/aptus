# Aptus — Project Roadmap & Next Steps

## Current Sprint: SarkariResult Ingestion & End-to-End Extraction

- [ ] **1. LLM Structured Extraction in Python (`services/ai/extract.py`)**
  - Define Pydantic schema for `ExtractedPost` (`post_name`, `vacancies`, `min_age`, `max_age`, `education_required`, `min_education_level`, `min_marks_percent`, `category_relaxation_applies`, `category_relaxation_rules`).
  - Call LLM with structured output mode (Gemini Flash-Lite / GPT-4o-mini) to extract structured posts from the raw page text.
  - Wire extracted posts into `services/ai/pipeline.py` (replacing `posts: []`).

- [ ] **2. Python-Side Source Text Validation**
  - Verify extracted numeric fields (min/max age, marks percentage) exist in the raw source text before payload submission to catch LLM hallucinations early.

- [ ] **3. End-to-End Pipeline Testing**
  - Run TS server (`pnpm serve`) and trigger the ingestion pipeline (`python services/ai/pipeline.py`).
  - Verify that live jobs from SarkariResult are parsed, checked against hash cache, and upserted into PostgreSQL `Source` and `Post` tables.
  - Test `/api/match` against the newly ingested posts with candidate profiles.

- [ ] **4. Server Observability & Crash Logging (`src/server.ts`)**
  - Add request tracing and stage logs with timestamps.
  - Add global crash handlers (`uncaughtException`, `unhandledRejection`, `SIGTERM`/`SIGINT`) with synchronous disk write (`crash.log`) and optional alert webhook.

---

## Next Milestones

- [ ] **5. Docker Compose & Deployment on Oracle Cloud VM**
  - Add the TS server and Python AI service containers to `docker-compose.yml`.
  - Set up environment variables and verify memory consumption fits within the Always Free VM tier.

- [ ] **6. Scheduled Ingestion (Cron / Background Runner)**
  - Configure periodic execution (e.g., hourly/daily) of the fetch pipeline.
  - Verify hash checks skip unchanged pages without incurring LLM API cost.

- [ ] **7. Second Official Source Adapter**
  - Following the scope discipline rule (expand one source at a time), add a second source adapter once SarkariResult is running reliably in production.
