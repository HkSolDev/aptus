# Aptus: what I should learn, own, and delegate

<!-- aptus-checkpoint-2026-10-24 -->

**Learning priority — 24 October 2026:** [Evidence-based review and publication](PRODUCTION_REVIEW_CHECKPOINT_2026-10-24.md#learning-before-implementation). Learn contracts, semantic grounding, review states and reliable publication before implementing the private inbox and optional AI reviewer. These are planned extensions, not deployed features.

Created: 2 October 2026. Companion: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

## The goal

Become able to own an applied AI feature end-to-end: understand the problem,
design a small system, integrate an LLM, verify its output, handle failures,
store correct data, and explain the tradeoffs. Aptus is the practical exercise.
This plan is not a guarantee of a job, salary, or interview result.

I do not need to memorize every line or implement everything without help.
I do need to understand and verify the core behaviour I claim on my resume.

## The most important focus

**Turn uncertain model output into a tested, reliable application contract.**

For each field, ask: Where did it come from? Is its shape valid? Is it supported
by the source? Did it survive storage? What happens if it is wrong or missing?

This connects Python, LLM APIs, validation, databases, and system design through
one real problem. Do not substitute collecting frameworks for solving it.

## What I own versus what the assistant handles

Auth-specific agreement (6 October 2026): the assistant implements the agreed
authentication work; I review and learn from the code. Follow
[CODING_STANDARD.md](CODING_STANDARD.md) and [AUTH_IMPLEMENTATION.md](AUTH_IMPLEMENTATION.md)
for that work. The practice split below remains guidance for other learning tasks.

| Area            | I should own and practise                                           | Assistant can handle                                              |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Architecture    | Explain stages, boundaries, alternatives, and failure policy        | Present tradeoffs, draw the flow, review my decision              |
| Schema          | Decide what each field means; model alternatives and uncertainty    | Pydantic/TypeScript syntax and repetitive field scaffolding       |
| Parsing         | Write section boundaries and understand row alignment               | Small examples, fixtures, unfamiliar syntax explanations          |
| LLM integration | Understand prompts, request/response schema, timeouts, cost         | Provider HTTP plumbing and repetitive adapter setup               |
| Validation      | Write the comparisons and decide null/reject/manual-check behaviour | Suggest counterexamples, review logic, build test scaffolding     |
| Persistence     | Trace every field from JSON to saved row; define update behaviour   | Migration boilerplate and mapping scaffolding after my decision   |
| Reliability     | Decide retry versus skip, success criteria, and safe resends        | Logging/config plumbing and failure simulation                    |
| Matching        | Write and test eligibility comparisons and uncertainty handling     | Test cases and review; never replace exact rules with LLM guesses |
| Documentation   | Explain what I built and its limitations in my own words            | Organize notes, improve clarity, maintain file maps               |
| Tooling/UI      | Verify results and learn tools only as needed                       | Repetitive setup, formatting, basic layout work                   |

Delegation does not mean ignoring the code. I should read the generated change,
run it, and explain what enters, what leaves, and what happens on failure.
If I explicitly ask the assistant to implement core logic, it may help, but
should explain the decision and give me a small verification exercise.

## Learning priorities, in order

### 1. Python fluency through this pipeline

Understand functions, dictionaries, lists, loops, return values, type hints,
exceptions, imports, and objects. Practise `None`, `str | None`, and `list[AgeRule]`:
`age_rules` is a variable whose value is a list; `AgeRule` is the element type.

Understand regex named groups (`(?P<gender>...)` defines the name used by
`match.group("gender")`), `.casefold()`, `.strip()`, and generator expressions.
Learn how to print a small intermediate result and write an assertion before
trying the whole pipeline. A lambda is a small function, not a special scraper.

### 2. Structured output and data contracts

Understand JSON versus Python dictionaries versus Pydantic objects.
Know why `model_validate_json()` parses/checks responses and why
`model_dump(mode="json")` prepares a payload. Understand required-but-nullable
fields and `extra="forbid"`. Know why a Protocol describes an interface while
the factory chooses a concrete provider.

### 3. Evaluation and source grounding

Distinguish schema validity, factual correctness, completeness, persistence,
and eligibility correctness. A response can pass the first and fail the rest.

Build a small evaluation set of real notification examples with manually
checked expected fields. Include missing values, repeated headings, empty cells,
multiple roles, different male/female limits, category conditions, education
alternatives, and confusing application/fee dates. Use saved fixtures for
repeatable tests; use live tests separately to detect source changes.

Keep a short error record: expected value, actual value, source evidence,
failure stage, fix, and regression test. Measure field-level correctness on
that set before claiming that a prompt improvement worked.

### 4. API and storage consistency

Trace a field across Python schema -> JSON -> TypeScript request -> Prisma ->
saved row -> matcher. Learn migrations, transactions, updates, and idempotency
through real changes. A field present in an LLM response but absent from the
database is an integration bug, not necessarily a model bug.

### 5. Failure handling and observability

Understand status codes, timeouts, bounded retries, and backoff. Retry a
temporary failure; do not blindly retry invalid credentials or unsafe writes.
An ingestion timeout may mean the database write succeeded but the response
was lost. Resends therefore need well-defined update behaviour.

Track run ID, source URL, stage, duration, status, created/skipped counts, and
error reason. Do not log API keys or unnecessarily expose user data. A crash
handler cannot reliably send a final message after a hard kill or machine loss:
process supervision and an external heartbeat/monitor are separate concerns.

### 6. Deployment and security

Learn environment variables, secret handling, migrations, protected internal
endpoints, scheduling, process restarts, and database backups. Confirm that
multiple users checking jobs do not trigger repeated extraction calls.

Study RAG, embeddings, queues, or orchestration when a concrete requirement
needs them, or separately when a particular interview asks about them. Do not
add them to Aptus merely to name them on a resume. Eligibility itself remains
deterministic, not similarity search.

## Completed slice: preserve the extracted rule object

**Carry `eligibility_rules` from Pydantic through TypeScript into PostgreSQL.**

Before code, I explain:

1. Which extracted rules must survive storage?
2. What storage representation should we choose, and what is its tradeoff?
3. What happens if a changed notification has no rules or extraction fails?
4. How will we prove a rule survived the handoff unchanged?

The chosen representation is nullable PostgreSQL JSONB on each post: it keeps
the nested shape and allows existing rows to remain valid, while matching still
uses flat fields. The assistant can prepare migration/setup boilerplate. I
should own the field mapping and verification, with small hints and review if
needed.

Done means: a fixture with conditional age/education rules reaches storage,
can be read back with those conditions intact, and has a regression test.
It does not yet mean the matcher supports those rules.

The object now survives ingestion and PostgreSQL storage. Runtime shape checks
have regression tests, and local database verification confirmed intact rules,
rejection without writes, and legacy compatibility. Practise explaining why
nullable JSONB supports older rows and why TypeScript interfaces alone cannot
validate HTTP JSON.

After that: connect age validation, test one live notification end-to-end,
then improve failure isolation. Keep each session to one useful slice.

## Authentication learning path

Learn the security decisions before adding authentication code. The assistant
explains each small topic first and implements agreed scaffolding; I review
the changes, run the flows, investigate failures, and practise explaining the
behavior. Keep job browsing public while protecting saved profiles and matches.

1. Google sign-in: OAuth/OIDC roles, callback allowlists, state, nonce, PKCE,
   client ID versus client secret, and minimal scopes.
2. Sessions and cookies: server-side session checks, Secure/HttpOnly/SameSite,
   CSRF risks, logout, and revoking one or all sessions.
3. Passkeys: registration after account proof, what public data is stored,
   device loss, recovery, and account linking.
4. Account safety: when Google email verification matters, abuse controls and
   rate limits, privacy-safe audit events, and whether MFA or password hashing
   applies to a passwordless setup.
5. Aptus authorization: derive identity from the server-verified session,
   enforce profile ownership, preserve public job routes, and test direct API
   requests plus missing-session and wrong-owner failures.

Do not treat a concept as understood because it was described once. Before
implementation, I should be able to explain the happy path and one failure
case in my own words. Authentication code and runtime flows have not yet been
implemented or verified.

### Learning checkpoint — 4 October 2026

Discussed: Google redirect flow, state/browser binding, PKCE, nonce and its
limits, ID-token signature/issuer/audience/expiry, scopes, session ownership,
logout/revocation, JWT access/refresh tokens, rotation, and caching trade-offs.
Discussion is not proof of implementation or complete mastery.

Current preference: PostgreSQL is the authoritative session store; Redis,
if introduced, is a cache. Start with one server and defer further lookup
optimisation until there is a measured need. Cache invalidation must accompany
revocation. Verify library support before implementing this preference.

Remaining lessons, one topic and one failure scenario at a time:

- [ ] Cookie settings: Secure, HttpOnly, SameSite, domain/path and expiry.
- [ ] CSRF protection for authenticated state-changing requests.
- [ ] OAuth configuration: callback allowlists, client ID versus secret,
      secret storage, and safe post-login redirects.
- [ ] Account linking and recovery, including changed email/lost access.
- [ ] Rate limiting and privacy-safe authentication audit events.
- [ ] Passkey registration, sign-in, device loss and recovery.
- [ ] Verify the chosen session/cache design: expiry, logout, cache failure,
      stale cache entries, and one-device versus all-device revocation.

Resume at safe redirects and client-secret handling. Learn first; implement
only after the developer says they are ready.

### Learning checkpoint — 5 October 2026

Core cookie and CSRF concepts have now been discussed; the checklist above is
the historical 4 October checkpoint, not a claim that these are still untouched.
Discussion is not proof of production implementation or mastery.

- HttpOnly prevents page JavaScript reading the session cookie, not the browser
  sending it. Injected scripts inside Aptus can still act as the user (XSS);
  a random external site cannot normally read Aptus responses.
- Secure excludes the cookie from ordinary HTTP requests; it does not upgrade
  HTTP to HTTPS. Redirects/HSTS are separate. SameSite is per cookie: explicit
  Lax permits normal top-level GET navigation but excludes cross-site POST;
  Strict can affect incoming navigation/sign-in; None requires Secure.
- Same-site is not same-origin. Browser origin isolation normally blocks an
  external script reading private responses, not all sending. HTTPS encrypts
  transport. A compromised browser breaks assumptions; CSRF alone is not a
  defense against a compromised device or XSS.
- Prefer host-only session cookies (omit Domain); Path controls delivery, not
  authorization. Logout clears matching name/domain/path and revokes server
  state. Cookie expiry and backend session expiry are independent. Tabs usually
  share one session. An expired server session must reject even a copied cookie.
- Sliding renewal can extend a still-valid session and cookie periodically;
  it need not rotate the token. Absolute lifetime/fresh-auth requirements limit
  indefinite activity-based renewal. Ordinary renewal cannot revive both an
  expired cookie and an expired session. No assumption about YouTube internals.
- CSRF: an attacker-controlled page can submit a form to a known Aptus endpoint
  with attacker-selected values. It need not inject a form into Aptus or read
  the response. Applicable cookies may accompany the request automatically.
- Illustrative synchronizer-token design: backend generates unpredictable proof
  tied to session, stores expected value server-side, supplies copy in a form or
  same-origin API response, and verifies explicitly submitted field/header on
  state-changing requests. SSR is not required; session-wide reuse is possible.
  The session identifies login; CSRF proof does not prove a human click or replace
  ownership checks. GET must not mutate. Use library CSRF/origin controls,
  appropriate SameSite and safe CORS; do not invent an auth protocol.
- The proposed local Map with roughly one-minute TTL caches VALID sessions to
  reduce Redis reads; it is not a revocation list. PostgreSQL remains primary,
  Redis/local caches optional. Server-managed record means stored in the database,
  not necessarily process memory. Token hashes are fingerprints, not new tokens.
- A per-session lock can coordinate every relevant cache fill/check and logout
  inside one process: previous fill finishes, revoke authoritative record, clear
  caches, release. Not a lock around the whole profile request. An already
  authorized request may finish. Cache failures need an explicit safe policy.
- Redis Pub/Sub broadcasts invalidation; it cannot alone stop late cache writes
  and disconnected subscribers miss messages. It is not a mutex or durable
  revocation store. Skip it for the current single-process proposal; measure
  before adding another cache layer. No separate denylist necessarily required
  for database-backed opaque sessions.

Canonical diagram: `/Users/mrblackghost/Work/ObsidianVault/03 Projects/Aptus/Aptus Login Flow.canvas`.
It is organized left-to-right across rows, then downward, with connected reasons
and limitations. Only documentation was changed in this learning update.

### Latest continuation — redirects, linking and passkeys

Safe redirects and client-secret handling are now discussed: returnTo is an app
parameter, not an automatic browser redirect. Google returns to the registered
callback; Aptus chooses the optional after-login destination. Allow approved
internal paths or use a fixed destination. Client ID is public; client secret
authenticates the backend at code exchange and is not Google's returned token.
Keep secrets in protected backend configuration, never frontend builds/Git/logs.
Local .env is plaintext and ignored; an exposed secret must be rotated.

Current user choice: Google and passkey are TWO METHODS for ONE Aptus account,
not two profiles. Add passkey after authenticated Google sign-in, requiring
sufficiently recent proof for sensitive credential management. Matching email
text alone is not enough to link methods. No email-link login in the current
choice; magic links remain an optional experiment.

Passkey creation and authentication are understood conceptually: authenticator
creates keys, provider retains private key (possibly synced), backend stores
credential ID/public key/account relation plus library metadata. Biometric/PIN
is local verification, not sent to Aptus. Fresh short-lived challenges identify
attempts; consume successful attempts. Authentication signs authenticator data
and a hash of clientDataJSON containing challenge/origin. Backend verifies proof
and expected values, not "unhashing". Credential ID alone cannot authenticate.
Successful passkey login creates the normal app session without Google.

RP ID is credential domain scope, not display name; expected origin includes
scheme/host/port. Local localhost testing and actual production HTTPS domain
need environment-specific configuration. Localhost passkeys do not transfer to
the production RP ID: use Google there, then register anew. Browser domain rules
and backend origin checks protect against phishing; use established library.

Proposed fallback: lost passkey -> Google -> remove lost credential/add new one.
Allow multiple credentials; synced passkeys may survive loss of a single device.
If Google access AND all passkeys are lost, recovery is not defined yet. Do not
promise an unverified support override or account merge.

Latest review: rate limits, privacy-safe audit logs, fresh authentication and
XSS/CSP basics now discussed; selected failure scenarios explained correctly.
This is not exhaustive mastery or runtime verification. Detailed Promise/cache
coordination and timeouts remain parked, not prerequisites to continue.
Auth implementation must wait for explicit readiness; verify library support
and repository state before coding.

### Latest security review — 5 October 2026

- Recovery choice: Google fallback only for now; recovery beyond Google is
  deferred. Loss of Google plus all passkeys has no defined recovery route.
- Backend enforces request allowances and immediate 429 cooldown responses;
  frontend countdown only displays them. User prefers count limits plus capped
  exponential escalation with decay/reset on repeated violations. Exact rates
  and windows are NOT approved yet; distinguish cancellation from failure.
- Before identity is verified, IP is a signal, not a person. Shared-IP users and
  rotating-IP bots require careful layered controls. Verified-account quotas,
  gateway protection and optional server-verified bot challenges were discussed,
  not installed. Forwarded IP headers must come from trusted, sanitizing proxies.
- Structured audit events include time, event, safe outcome/reason and a
  backend-generated request reference; never dump whole requests or credentials.
  Account reference only if justified. Exclude applicant fields, cookies, tokens,
  secrets and callback query strings. Access/retention/volume restrictions needed.
- Preferred viewer to evaluate is Dozzle, not installed. App emits safe logs,
  Docker captures output, viewer filters/searches. Restrict Docker API access,
  keep dashboard private, disable unnecessary actions/shell. Durable history is
  a separate retention decision, deferred until needed.
- Sensitive credential changes need sufficiently recent existing-account proof.
  New passkey approval itself cannot establish account ownership. Google reauth
  must match linked provider sub; a fresh redirect may reuse Google SSO without
  new human verification. Final recent-auth/step-up guarantees need provider and
  library verification. Cancelled/failed proof does not attach credentials.
- XSS basics: scraped/LLM text is untrusted; use textContent or escaped templates,
  validate link schemes/destinations separately. CSP restricts approved scripts
  as an additional layer, not a replacement for safe rendering. Passkey prompts
  need legitimate browser JavaScript; arbitrary external sites cannot read all
  tabs, while injected Aptus scripts can act with Aptus permissions.
- Final review passed selected explanations: Google verified but session DB
  unavailable -> no successful Aptus session; wrong profile owner -> deny;
  expired attempt/nonce mismatch -> reject/restart; cancelled passkey creation
  -> unchanged account; required CSRF missing -> no mutation.

Next: agree on implementation checklist and policies (models/library/dependencies,
session and fresh-auth lifetimes, rate thresholds, actual RP/origin/proxy config,
cache outage/revocation guarantees, one/all-device logout, final-passkey removal,
concurrent/replayed attempts), then explicitly authorize small tested slices.
The canvas records discussed edge cases, not every possible security edge case.
Only learning documentation was changed in this update.

Canvas updated into connected main-flow, security, passkey and parked-reference
panels, left-to-right then downward with spaced continuation lanes. Documentation
only; no authentication code was implemented by this update.

Passkey references: [registration](https://developers.google.com/identity/passkeys/developer-guides/server-registration),
[authentication](https://developers.google.com/identity/passkeys/developer-guides/server-authentication),
[RP/origin configuration](https://simplewebauthn.dev/docs/packages/server).

References: [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie),
[Redis Pub/Sub](https://redis.io/docs/latest/develop/use-cases/pub-sub/).

### Current auth implementation findings (4 October 2026)

- `src/server.ts` is a native Node HTTP server; Better Auth is not installed.
- Better Auth's current docs support its Prisma adapter with Prisma 7 and
  PostgreSQL. Its CLI generates the Prisma models; Prisma applies the
  migration. The native Node server can mount the auth handler without
  Express. Passkeys use the separate `@better-auth/passkey` package.
- With Better Auth's default route and Aptus's default local port, Google's
  authorized redirect URI will be `http://localhost:8080/api/auth/callback/google`.
  Register the exact deployed HTTPS equivalent for production. This provider
  callback is different from the page Aptus sends the user to after login.
- `POST /api/match` currently accepts `userId` from the request body and can
  create or update that profile. After auth is added, identity must come from
  the server-verified session, never from a submitted ID.
- `POST /api/explain` also accepts a submitted `userId` to load a profile.
  Decide and enforce whether it should use only the signed-in user's profile
  or remain public without personalized profile data.
- `frontend/api.ts` sends `userId` from the browser for explanations, while
  `frontend/profile-storage.ts` persists DOB, category, and education in
  `localStorage`. This is not an auth-token issue, but it is sensitive applicant
  data and conflicts with the project checklist's browser-storage privacy rule.
  The auth migration must replace this with session-owned profile reads/writes
  and handle any existing browser copy deliberately rather than silently
  trusting or deleting it.
- Prisma's current `User` is actually the applicant-profile record: DOB and
  category are required. A Google account must be creatable before the user
  enters eligibility details. Decide whether to keep one user model with
  nullable profile fields or separate Better Auth's account from a 1:1
  `ApplicantProfile`; the latter cleanly separates login identity from DOB,
  category, and education, at the cost of another relation to manage.
- Keep `GET /api/jobs` and public job pages available without signing in.
- Before implementation, decide whether email links are a normal sign-in
  option for people without Google or recovery only. Project rules also require
  explicit approval before adding Better Auth and its passkey package.
- No authentication behavior has been changed or runtime-tested yet.
- Better Auth's passkey plugin requires an authenticated session for
  registration by default. Plan the first passkey as an account-security step
  after Google/email-link sign-in; do not enable pre-auth passkey creation
  unless its `resolveUser` context has a separate proof-of-ownership design.

Reference: [Better Auth + Prisma](https://better-auth.com/docs/adapters/prisma),
[Node handler](https://better-auth.com/docs/integrations/express),
[passkey plugin](https://better-auth.com/docs/1.6/plugins/passkey),
[Google provider setup](https://better-auth.com/docs/1.6/authentication/google),
[Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server).

For sign-in only, review the scope list and request no Google API access. The
OIDC `email` scope shares the account's email address; it does not grant access
to Gmail messages. Gmail and Drive access require separate scopes. Tentative
least-privilege choice: `openid` + `email`; add `profile` only if Aptus decides
it needs Google's name/photo rather than asking the user itself.

Reference: [Google OIDC scopes](https://developers.google.com/identity/openid-connect/openid-connect),
[Google API scopes](https://developers.google.com/identity/protocols/oauth2/scopes).

### OAuth values to tell apart

- `state` ties Google's callback to the login attempt started in this browser;
  it helps stop login-CSRF/request-forgery attacks.
- `nonce` is echoed inside the OIDC ID token and checked there to bind that
  token to this login attempt and reduce replay.
- PKCE's `code_challenge` is sent at the start; the original `code_verifier`
  is kept for the code exchange. Google checks the verifier so someone who
  only stole the temporary authorization code cannot redeem it.

The auth library should generate and validate these values; Aptus should not
invent its own protocol implementation. References: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[RFC 7636 (PKCE)](https://www.rfc-editor.org/rfc/rfc7636.html).

### Session identity model

The browser automatically sends Aptus's session cookie with same-site requests.
The server asks Better Auth to validate that session; protected routes then use
the returned `session.user.id`, not an ID submitted in JSON. Missing, expired,
or revoked session means no profile access. Keep database-backed sessions for
the first version; optional cookie caching can delay revocation until its cache
expires. Test a missing session, a forged body `userId`, a revoked session, and
public job browsing separately.

Reference: [Better Auth sessions](https://better-auth.com/docs/concepts/session-management),
[Better Auth cookies](https://better-auth.com/docs/concepts/cookies).

## Fun / Experiment list

When I ask for my "fun list", "Exp list", or "experiment list", show the
pending items here. These are optional learning experiments, not changes to
the active product checkpoint.

- [ ] **Understand how frontend checks can be bypassed.** On local Aptus,
      send an HTTP request directly without using the webpage's JavaScript.
      Use illustrative data to demonstrate why frontend validation is only a
      convenience and why the backend must independently validate inputs,
      verify sessions, and enforce profile ownership. Check that protected
      requests fail when authentication or ownership is missing.

- [ ] **Learn how to implement magic-link login.** Understand how the app
      creates and emails a temporary login link, verifies its token, and creates
      a session. Practise locally with illustrative accounts; test expired links,
      reused links, and invalid tokens. Learn first, then implement when requested.

- [ ] **Revisit Promises, session locks and cache race conditions.** Parked
      on 5 October 2026 because the Promise code is not yet fully understood.
      Later, walk through one small TypeScript example: Promise versus await,
      per-session completion signals, concurrent cache fill versus logout, and
      finally/lock cleanup. Then cover bounded waits, cancellation versus merely
      timing out, and preventing late writes after a timeout. Discussion so far
      does not mean mastery. Do not block the current login-learning path on this
      optional cache design or implement it before it is understood and requested.

Added: 4 October 2026; updated: 5 October 2026. Practise later, when requested.

## Working agreement for this chat and future sessions

Assistants should read this guide alongside the architecture snapshot when
working on Aptus, and follow these defaults unless I explicitly ask otherwise:

- Start a coding session by naming one task and the core logic I will practise.
- Label the division briefly: "You own X; I can scaffold Y."
- Ask me for the reasoning before implementing a new architectural choice.
- Give hints or a small example first when I am practising core logic.
- Explain unfamiliar syntax in plain language, without a long theory detour.
- Ask "What can fail here, and what should happen?" before the happy path.
- Review my attempt and fix one misunderstanding at a time.
- End with a test result, one thing learned, and a short interview explanation.
- Remind me at task boundaries, not repeatedly during every small question.
- If I ask for full implementation, help without withholding it; still explain
  what I must verify and what remains incomplete.

These files preserve the agreement when chat context is compacted. They are
not automatic reminders or a scheduled task. Future sessions need to read them;
update them when a task is completed or a decision changes.

## A session that fits my pace

Use this as a flexible routine, not a deadline:

1. Explain the goal and failure case in a few sentences.
2. Inspect one relevant file and trace its input/output.
3. Implement one small behaviour myself; delegate agreed boilerplate.
4. Test normal, missing-data, and incorrect-data cases.
5. Write a short explanation in my own words.

If I cannot explain the change yet, stop expanding the feature and work through
a smaller example. Understanding one reliable slice is better than accepting
a large block unread.

## Interview and resume checklist

For every feature I mention, I should be able to answer:

- What real problem did it solve?
- Why this language, boundary, schema, or tool?
- What alternative did I consider and why not use it now?
- How does it fail, and how do we recover?
- What test or live evidence proves it works?
- What limitations remain?
- Which parts did I write, and which did AI help generate?

An honest current resume description:

> Built a Python pipeline for government-job notification extraction using
> structured LLM output and Pydantic, with a TypeScript ingestion API and
> PostgreSQL persistence; added section parsing and regression tests for
> nested tables and neighboring-field boundaries.

Only claim deployment, extraction accuracy, complete rule support, or real-user
impact after verifying it. Do not present passing unit tests as production
evidence. Apply while improving the project; finishing every future feature
is not a prerequisite for describing the working parts honestly.

## Interview explanation template

"The problem was ____. I considered ____ and ____. I chose ____ because ____.
The main failure case was ____. I handled/tested it by ____. The current
limitation is ____, and the next small improvement is ____."

For Aptus specifically, practise explaining why structured JSON is not factual
validation, why null is safer than guessing, why extraction happens before user
requests, and why the LLM does not decide whether a person is eligible.
