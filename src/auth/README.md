# Authentication module boundary

Database identity migration applied locally on 6 October 2026. No auth handler,
sessions or credentials are active. `AuthUser` is the future login identity;
historical `User` remains the applicant profile with nullable `authUserId`.
Core tables also applied: `AuthSession`, `AuthAccount`, `AuthVerification`.
Later configuration must map Better Auth's four core model names to these names.
Provider token/password columns are library-compatible storage, not enabled
password login or an Aptus access/refresh-token design. Credential-storage,
expiry/revocation, metadata collection and cleanup policies need configuration.
Read [the review map](../../docs/AUTH_IMPLEMENTATION.md) before implementing.

Create each module only when its slice is being implemented:

- `config.ts`: validate backend configuration; never print its values.
- `auth.ts`: configure Better Auth and the existing Prisma adapter.
- `routes.ts`: mount the library handler with the configured canonical origin.
- `require-session.ts`: derive the signed-in account from the backend session.
- `recent-proof.ts`: gate credential changes using an existing linked method.

These names are a proposed reading order, not empty implementations. PostgreSQL
remains authoritative. Do not introduce JWT access/refresh tokens, email-based
account merging, Redis/local caching, or custom OAuth/WebAuthn cryptography.
