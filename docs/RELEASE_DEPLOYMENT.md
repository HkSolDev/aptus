# Release packaging — 16 October 2026

This branch starts at merged release `4289bcf` and retains its organization
migration. It adds the existing deployment packaging and ingestion protection;
do not replace it with the older `codex/coolify-api-build` branch.

## Build three independent images

From a clean checkout of this branch, use the current short commit SHA as TAG:

```sh
git rev-parse --short HEAD
docker build -f deployment/frontend.Dockerfile --build-arg BACKEND_INTERNAL_URL=http://aptus-api:8080 -t aptus-frontend:TAG .
docker build -f deployment/api.Dockerfile -t aptus-api:TAG .
docker build -f deployment/worker.Dockerfile -t aptus-worker:TAG .
```

Replace TAG with the printed SHA. Build-time secrets are unnecessary. The
frontend includes the redesigned components and their shared filter helpers;
Next standalone output packages its Node runtime dependencies. The API retains
the established Node address-family flags. The worker uses the existing pinned
Python dependencies and non-root scheduler, with no HTTP service or exposed port.
`.dockerignore` excludes environment files, generated output and local data.

The frontend Dockerfile runs `pnpm next:build --webpack`, the locally verified
build command. It copies `app`, `components`, `frontend`, and `public/css`, then
copies standalone output, static chunks and public assets into the runtime.
The API copies all `src` modules, both runtime script dependencies (`match.ts`
and `validate-post.ts`), shared `frontend` filter helpers, generated Prisma
client, production dependencies, and compiled legacy browser assets. The worker copies Python modules plus provider
and source adapters, including the collector and scheduler entrypoints. The
migration image includes the complete Prisma migration directory and config.
No Dockerfile uses a broad `COPY .`; runtime credentials are never build inputs.

The release lacked the running worker's collector/scheduler modules. Those
modules and their offline tests are now included alongside the release's latest
organization extraction schema. The worker still uses immediate startup and
six-hour India-time scheduling, durable hashes, locks and pending deliveries.
Gemini supports the existing runtime key names; credentials are sent in a header
and provider error bodies are not logged.

## Safe verification and deployment boundaries

Never start the default worker command merely to inspect the image: it runs the
pipeline immediately and may call Gemini. `docker run --rm --network none
aptus-worker:TAG --help` only displays scheduler help. Reuse its persistent
`aptus-worker-data:/work` volume during deployment; it prevents needless repeat
extraction. A successful duplicate ingestion response with zero created posts
still remains pending in the restored scheduler; that existing retry behavior
has not been redesigned here.

Frontend/API have their existing Docker healthchecks. Process health does not
prove database connectivity. All three services use independent Coolify resources;
Git pushes do not update the separately built worker image automatically.

Keep API/worker ingestion secrets in private runtime configuration. Verify
unauthenticated ingestion is denied, and configure the same credential in both.
Do not expose the API publicly or introduce additional host ports.

Required runtime configuration (names only; supply values privately):

| Resource       | Configuration                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | `BACKEND_INTERNAL_URL=http://aptus-api:8080` is the runtime default and build-time rewrite target. If the private alias changes, set both the build argument and runtime variable to that same origin.                              |
| API            | `DATABASE_URL`; `INGEST_TOKEN` or `INGEST_TOKEN_FILE`, never both. File credentials must be mounted read-only and readable by the non-root `node` user.                                                                             |
| API sign-in    | `AUTH_ENABLED=true`, exact public HTTPS `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. Without enabled auth, private routes return unavailable.                                           |
| Worker         | `BASE_URL=http://aptus-api:8080`; the same ingestion credential as the API; `LLM_PROVIDER=gemini`, `LLM_MODEL`, and `GEMINI_API_KEY` (or existing `GEMINI_API_KEY_1`). The default provider is OpenAI if `LLM_PROVIDER` is omitted. |
| Worker storage | Mount the persistent volume at `/work`, writable by UID 10001. Ingestion credential files must also be readable by that user.                                                                                                       |
| Migration      | `DATABASE_URL` for the explicitly selected database. Run only as a separate approved operator action.                                                                                                                               |

API and migration commands disable dotenv file loading with
`DOTENV_CONFIG_PATH=/dev/null`; inject environment variables or mounted credential
files at runtime. The worker does not load dotenv files. Frontend/API ports are
internal container ports; retain the existing HTTPS proxy and private network.

`deployment/migrate.Dockerfile` is an operator-only migration image; application
startup does not apply migrations. Confirm the production database, verified
backup and rollback image references before applying the organization migration
or changing live services. Existing organization values remain null until an
explicit re-extraction or content change; no bulk backfill is authorized here.

## Local verification results

The previous agent completed 19 focused Node checks, all 199 offline Python
tests, project lint/type checks, legacy frontend compilation, and the Next
production build using webpack. The finishing pass additionally verified:

- Full `pnpm test`: 86 passed, 11 skipped, zero failures. Skips require a
  separately configured isolated PostgreSQL database; no database integration
  run is claimed. Tests used a dummy local database URL and disabled dotenv.
- Component rendering checks: all five passed (`job-card` and
  `job-detail-content`).
- All 199 offline Python tests passed again; no live source/provider calls.
- `pnpm lint`, `pnpm typecheck`, Prettier checks on changed TypeScript/Markdown,
  and `git diff --check` passed.
- Reviewed COPY inputs, required runtime modules, secret exclusions, non-root
  users, private API addressing, and migration separation.

The Node suite required local loopback permission and the existing Python
virtualenv linked into this worktree; neither setup issue required a source
change. No new browser run was performed in this finishing pass.

Docker image builds remain **unverified**: the local Docker daemon was
unavailable. Host builds do not verify Alpine/Linux dependency installation,
the pinned worker base image/dependencies, container startup, healthchecks, or
volume permissions. No server connection, migration, registry image push, or
deployment took place.

## API runtime packaging fix — 16 October 2026

The first `2463e23` API rollout failed because `src/routes/jobs.ts` imports
`frontend/public-job-filters.js` through tsx, but the final image omitted the
`frontend` directory. Coolify restored the previous healthy API. The runtime
now copies that directory and imports the helper during image construction
as the non-root runtime user, so this missing-module failure stops the build.

Build and deploy a fresh commit-tagged API image; do not overwrite `2463e23`.
The production organization migration was already applied during the previous
rollout; inspect migration status rather than repeating it. Continue frontend
and worker deployment only after the updated API passes its healthcheck.

Verification for this fix: runtime helper import, all six focused public-jobs
checks, project type checking, lint and changed-file formatting passed locally.
CI now also builds the API image and checks `/health` inside a container with
external networking disabled and authentication disabled, without production
configuration. This checks startup only, not database connectivity or sign-in.
Local container verification is unavailable because no Docker daemon is running.

## Worker runtime packaging fix — 17 October 2026

The `0d1994c` worker image flattened Python modules into `/app`. Importing
`hash_cache.py` then failed because its repository-relative cache path assumes
`services/ai` beneath the project root. The image now retains that source
hierarchy at `/app/services/ai`, with the matching Python path and entrypoint.
The scheduler and `/work` persistent-storage configuration are unchanged.

Image construction now runs scheduler `--help` as the worker user. CI also runs
the built image with `--help`, external networking disabled and a read-only
filesystem. This checks startup/imports without collection, extraction, ingestion
or production configuration. Build a new commit-tagged worker image; preserve
the existing `/work` volume when later deploying it.
