# Authentication module boundary

Read [the review map](../../docs/AUTH_IMPLEMENTATION.md).
Google and PostgreSQL sessions are implemented, disabled unless `AUTH_ENABLED=true`.
Public jobs stay available. Historical profiles remain unclaimed.

Implemented reading order:

- `config.ts`: validate backend configuration; never print its values.
- `auth.ts`: configure Better Auth and the existing Prisma adapter.
- `routes.ts`: mount the library handler with the configured canonical origin.
- `http.ts`: safe request/response conversion and limited public session fields.
- `require-session.ts`: authoritative session checks for protected routes.
- `rate-limit.ts`: per-peer-IP endpoint limits and increasing waits.
- `passkeys.ts`, `recent-proof.ts`: WebAuthn configuration and recent account proof.
- `passkey-schema.ts`, `passkey-routes.ts`: bounded credential operations.
- `../lib/logging.ts`: privacy-safe request and security-event logs.
- `../app.ts`: registers auth alongside existing Fastify routes.

The browser gets one opaque Aptus session cookie, not JWT access/refresh tokens.
PostgreSQL remains authoritative. Google credentials are not retained after login.
Seven-day rolling expiry renews at most daily via protected POST get-session;
GET is read-only. A separate absolute cap is deferred. Logout revokes this session.

Matching and explanation use the verified account's own profile. Profile writes
require the exact configured Origin. Passkey changes require recent account proof;
Google remains the recovery method. Redis/local session caching, all-device logout
and production proxy configuration remain pending. Internal ingestion still needs
authorization before public deployment. No email-based account merging or custom crypto.
