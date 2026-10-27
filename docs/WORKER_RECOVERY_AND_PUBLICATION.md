# Worker recovery and reviewed publication

<!-- aptus-checkpoint-2026-10-24 -->

**Current checkpoint — 24 October 2026:** [Production, worker results and review-system next steps](PRODUCTION_REVIEW_CHECKPOINT_2026-10-24.md). Frontend `d577942`, backend/worker `94ccc9d` deployed. Worker saves drafts but has published zero new jobs in the observed runs. Earlier snapshots below are historical.

Stages 6 and 7 are implemented locally. Publication remains an explicit operator
action; scheduling the generic worker only creates review artifacts.

## DeepSeek off-peak scheduling

Set `LLM_PROVIDER=deepseek` and `DEEPSEEK_OFF_PEAK_ONLY=true` in the worker's
runtime configuration. Production uses **host cron** to launch a one-shot
`aptus-worker-cron` container at **04:00, 10:00, 16:00 and 22:00 IST** with
`--once` and Docker restart policy `no`. The container exits after each batch;
there is no always-running production scheduler. A host `flock` prevents
overlapping batches. The old managed worker is stopped and retained for rollback,
and both images reuse the existing `aptus-worker-data:/work` volume.

On a server whose system timezone is UTC, the cron expression is
`30 4,10,16,22 * * *` (04:30, 10:30, 16:30, 22:30 UTC). On an IST server it
is `0 4,10,16,22 * * *`. Verify the server timezone before installing cron;
do not assume a `CRON_TZ` setting is supported by its cron implementation.
Cron calls `docker start --attach aptus-worker-cron`; credentials remain in
Docker's private runtime configuration, never in the cron command or a release
checkout. Existing unrelated cron entries are preserved.

Startup during peak hours defers instead of extracting; `--once` reports the
deferral and exits without running the pipeline. Prepare-only inspection remains
available at any time. The legacy daemon mode remains supported for other users.

The provider boundary checks the clock before every DeepSeek request, including
calls outside the scheduler, so a long batch cannot begin new requests in peak
hours. It stops five minutes early to leave room for a bounded generation.
Deferred notices keep their evidence and do not consume provider retry attempts.
Existing successful checkpoints and drafts remain reusable without provider calls.

[DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) lists peak
windows as Monday–Friday **01:00–04:00 and 06:00–10:00 UTC**; other hours are
half-price. Decisions use UTC weekdays, not server local time. Weekends are
off-peak. No holiday calendar is required: weekday holidays follow the same
conservative schedule. This rule uses the published October 2026 windows and
must be reviewed if the provider changes pricing.

## Stage 6: resume the failed stage

- Capture failures have durable, URL-scoped attempts under
  `state/stages/capture/`. Transient failures wait 30, then 60 seconds, with at
  most three attempts. The next scheduler invocation performs due work; no
  worker sleeps while holding a retry slot. Permanent failures require review.
- Each source has a SQLite missing-document recovery queue. Up to five due
  dependencies are recovered on the next preparation run. Recovered documents
  rejoin current notices through the existing conservative grouping rules.
- Extraction attempts are keyed by the evidence fingerprint, including the
  extraction version. Numeric provider `Retry-After` is respected, capped at one
  day. Failed connection establishment and transient HTTP errors can retry.
- Read timeouts and a crash with an uncertain provider result require review:
  the provider might already have charged for that generation.
- A checksum-bound response checkpoint is written before validation/storage.
  Interrupted storage resumes from that checkpoint, with exact evidence bytes
  checked again. Once a durable outcome exists, Stage 1 owns reuse and the
  temporary checkpoint is removed. Invalid output is retained for review, not
  blindly regenerated. Normal provider responses are retained in `responses/`.
- Changing evidence/version creates a new extraction attempt identity. There is
  no automatic override of a terminal review decision.

## Stage 7: approve exact bytes, then deliver

Review the draft and its source citations before running these commands. Replace
the illustrative paths with the actual worker root and recruitment draft path.
Use the existing Python environment and runtime configuration; never put an
ingestion credential in a command argument or URL.

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python \
  services/ai/review_publication.py approve /path/to/worker \
  /path/to/worker/drafts/NOTICE.json \
  --reviewer 'Operator name' --note 'Checked facts against source evidence'

PYTHONPATH=services/ai services/ai/.venv/bin/python \
  services/ai/review_publication.py publish /path/to/worker \
  /path/to/worker/drafts/NOTICE.json
```

Delivery uses the existing `BASE_URL` and `INGEST_TOKEN` or `INGEST_TOKEN_FILE`
configuration. Production transport must use HTTPS or the existing trusted
private service network. Only grounded recruitment drafts can be approved.
Amendments, results, unclear outcomes, and validation failures cannot publish.

Approval records in `publication/approvals/` bind the exact draft SHA-256.
Editing even one byte requires a new review. The internal ingestion endpoint
still requires its server-verified bearer credential. It validates the approval
and storage schema before accessing the database, then calls the existing
immutable candidate store and transactional reviewed publisher.

Receipts in `publication/receipts/` bind candidate ID, content hash, draft hash
and published post IDs. Retrying identical approved bytes, including after a
lost response/receipt, returns the same database rows. Changed drafts never
silently replace previously published posts. Publication retries do not invoke
an AI provider. Review/receipt directories must remain writable only by trusted
operators and the worker; these are local approval records, not digital signatures.

The legacy raw-post ingestion contract remains available to existing producers.
The generic worker's former injectable `persist` callback can no longer bypass
review. This bridge does not deploy the worker or approve public jobs by itself.

## Verification on 24 October 2026

- 81 focused Python checks passed, covering retries, queue recovery, provider
  uncertainty, checkpoint integrity, draft reuse, approval and delivery.
- Exact Stage 6 commit: all 367 Python tests passed. Exact Stage 7 commit:
  all 370 passed. The working tree's preserved local `sources.json` changes
  produce one registry-selection expectation failure; those changes are excluded
  from these checkpoints.
- Seven TypeScript/PostgreSQL integration checks passed using an isolated local
  database. Python approval and delivery crossed a real authenticated HTTP
  socket into PostgreSQL. Removing the receipt and repeating delivery produced
  the same post IDs and exactly one candidate/post.
- TypeScript checks for server and web passed; repository ESLint passed.
- Broader TypeScript regression run: 89 passed, 13 skipped, zero failures. The
  Stage 7 database checks were additionally run with the isolated database as
  described above. The existing CSS-loader hook fails under this local Node
  runtime; the regression run used `node --import tsx --test` successfully.
- Fresh SarkariResult capture: two readable documents and two prepared inputs.
  One live DeepSeek generation failed fact decoding. The next two runs held it
  for review with zero further provider calls. This is safe failure handling,
  not proof of reliable model output.
- Replaying the previously validated real DU result proved storage interruption
  recovery: one replay, then checkpoint reuse, then durable draft reuse; zero
  live AI calls and zero public-job publication.
- No production deployment, Git commit/push, or public-job publication occurred.

Remaining limits: local-host locks/state, manual review for uncertain provider
completion, no automatic amendment application or published-job replacement,
and model output quality remains a separate acceptance concern. Old database
drafts hashed with nonpersisted worker metadata may need re-storing/re-review;
the bridge now hashes exactly the fields PostgreSQL retains.
