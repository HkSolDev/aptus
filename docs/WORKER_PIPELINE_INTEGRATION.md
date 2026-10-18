# Worker pipeline integration

18 October 2026. Branch: `codex/worker-pipeline-integration`.
Local worktree: `/private/tmp/aptus-worker-pipeline-integration`.
Base: GitHub main `e7ddbd0`, including the 17 October source adapters.
The original checkout and its uncommitted work are preserved.

## Confirmed failure and intended behavior

The running scheduler executes every six hours. Its 18 October noon India-time
run published no jobs. PDF snapshots from SSC, HSSC and MySarkariNaukri enter
`run_scheduled_pipeline.py`, which decodes their bytes as UTF-8 and calls the
SarkariResult HTML parser. This produces meaningless text, not PDF extraction.
Three failures for the same hash block later attempts. UPSC/JKSSB collection
and UPPSC extraction failures still require separate diagnosis.

The original scheduled worker already used that HTML-only path. The 17 October
adapters added PDF destinations without connecting the newer document flow.
`recover_documents.py` does route HTML/PDF to their respective normalizers;
the scheduler does not invoke it. Discovery, verification/bundling, coverage and
evidence-backed extraction also exist separately and are not a completed shared run.

Target: enabled source URL → bounded deeper discovery → capture related HTML
and PDFs → normalize each → verify campaign relationships → bundle relevant
evidence with source locations → structured AI extraction → validation → ingest.
Keep useful HTML alongside related PDFs. Do not mix different campaigns or
silently publish unsupported facts. Missing/unreadable/conflicting evidence
must remain visible for review. Eligibility remains deterministic application code.

## Implementation sequence

1. **Source registry (current slice):** one validated `services/ai/sources.json`,
   read afresh for each collection run. Preserve the seven active sources and
   25 disabled candidates. Disabling/removing stops future collection without
   deleting saved state or public jobs. Include the file in the worker image.
2. **Document processing:** reproduce the PDF bug, connect real normalizers,
   retain HTML structure and PDF page evidence, and block unusable text before
   any provider call. Existing PDF diagnostics require quality/coverage review;
   simply calling the normalizer does not establish extraction completeness.
3. **Shared discovery and campaign flow:** connect link context/scoring to a
   bounded durable queue, follow bridge/detail/notification links, group related
   HTML/PDF/update documents and check coverage before extraction. Prove one
   source end to end before expanding. Keep source-specific transport exceptions
   (such as SSC JSON) isolated from shared document processing.
4. **Extraction/publication/recovery:** feed the combined evidence contract into
   extraction and validation, use protected ingestion, preserve published jobs,
   retain pending deliveries and safe stage-specific error reasons. Revisit
   previously blocked documents only after fixing and versioning processing.
5. **Local acceptance then release:** fixtures for multi-hop discovery, HTML +
   PDF evidence, different campaigns, amendments, unreadable PDFs, partial crawls,
   retries/restarts and unchanged runs; then representative live source/provider
   and isolated persistence checks. Commit/push reviewed changes, pull that exact
   commit on the server, build a new worker image and verify publication.
   No direct server code fixes. No sub-agents.

## Source file usage and current limits

Each entry has `id` (stable storage key), `url`, `enabled`, `kind`
(`official` or `third_party`), and nullable `reason` for an operator note.
Edit the URL or enabled flag here rather than in the collector/catalog.
Do not rename an existing ID: it identifies that source's persistent state.
Invalid configuration fails before collection writes or fetches. Public URL
and redirect checks remain enforced by capture; URL shape validation alone
is not an SSRF guarantee, and existing DNS rebinding protection remains open.

The source registry does **not yet** implement generic discovery. Enabling a
new source ID reports `discovery_not_connected` without fetching it. Existing
adapters remain connected temporarily; the PDF bug is not fixed in this slice.
Adapter URL constants still describe their existing site-specific parsing bases.

For an offline custom-list run: `collect_sources.py STORAGE --sources FILE`.
The scheduler uses the packaged default source file on each run. A future private
admin page will manage database-backed source records and stage/run/document
status using the same processing flow; it is outside this change.

## Verification

Five new registry tests cover custom URLs, disabled/removed-source history,
invalid configuration, preserved defaults and unconnected-source reporting.
The tests first failed because the registry module did not exist, then passed.
Full offline Python suite: **221 tests passed** (including the five new tests).
Changed JSON/Markdown formatting passes. `pnpm typecheck` and `pnpm lint` were
attempted but fail in this new worktree: generated Prisma client is absent,
and the reused local node_modules lacks current-main `openai`/`pdf-parse`.
No TypeScript source was changed. Resolve those local setup gaps before the
release gate; neither check is reported as passed. Docker build and live
end-to-end publication have not been run. Manual review checked source-ID path
safety, URL credentials rejection, no-delete behavior, default selection and
runtime reload. No independent agent review (user requested one agent).
No paid provider call, production write, deployment or live scraping in this slice.
