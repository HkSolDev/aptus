# Aptus implementation and review standard

Updated: 6 October 2026

## Ownership and continuity

For the agreed authentication work, the assistant implements and verifies code;
the developer reviews it and asks for explanations. Do not silently switch back
to assigning core implementation to the developer. A request to learn or discuss
alone does not authorize implementation of another feature.

Before continuing after a new chat or context reset:

1. Read project instructions and `.cursor/rules/aptus-coding-safety.mdc`.
2. Read this standard, `PRODUCT_CHECKPOINT.md`, and `AUTH_IMPLEMENTATION.md`.
3. Inspect the branch, working changes and actual code; documentation is not proof.
4. Read the relevant installed skills fully before using them. If missing, say so
   and follow the project rules instead. Skills never override security or scope.
5. Resume only the recorded active slice. Preserve unrelated developer changes.

Use Ponytail for simple solutions, incremental-implementation for small slices,
and documentation-and-adrs for decisions. For verification, use the relevant
testing and code/security-review skills. Official Better Auth guidance is a
reference, not a guarantee: check examples against the pinned installed release
and its source. Do not install skills or dependencies without approval.

Approved Fastify reference: `fastify-best-practices` from `mcollina/skills`.
Use it selectively for modules, routing, validation and inject tests. Aptus's
security plan overrides examples: no tokens in URLs, email-only account linking,
custom JWT/OAuth implementation or unsolicited dependencies. Keep the existing
TypeScript tooling unless a separate change is approved.

## Readable TypeScript

- Use camelCase for functions/variables and PascalCase for types. Use descriptive
  kebab-case for new module filenames; do not rename unrelated existing files.
- Names describe purpose: `requireSession`, `getOwnProfile`, `revokeSession`,
  `verifyPasskeyResponse`. Avoid vague `manager`, `processor`, `data`, or `utils`
  modules when a specific name describes the responsibility.
- One module owns one responsibility. Routes handle HTTP, focused functions
  handle decisions, and storage modules handle persistence. Reuse genuinely
  repeated logic; do not create a factory/interface for one implementation.
- Prefer straight-line async/await and early returns. Use a Promise explicitly
  only when coordination requires it, and explain the invariant in that case.
- Infer obvious local types; specify important exported inputs and outputs.
  Treat external values as unknown and validate them at runtime. TypeScript
  types alone do not validate requests or protect account ownership.
- Keep review slices small. Aim for roughly 100–150 lines per new module, not a
  hard limit: split mixed responsibilities, not a coherent function arbitrarily.
- Keep strict type checking enabled. Do not add `any`, assertions, suppression
  comments, or disabled lint rules merely to silence a real problem.
- Use the existing ESLint and Prettier. Format changed files only; avoid unrelated
  repository-wide formatting. No new framework or tooling dependency by default.

## Comments

Prefer names that explain the code. Comment only non-obvious reasons, security
constraints, concurrency invariants, or a necessary workaround. Do not narrate
every line, leave commented-out code, or describe implementation as verified
when it has not been tested. Keep explanations for the reviewer in documentation.

## Honest checks and handoff

A behavioural test checks an observable outcome: after logout, the old cookie
cannot open a private profile. A type check only checks code's type consistency.
Both matter, and neither alone proves the entire login system secure.

- Derive tests from approved behaviour, including failures and direct requests.
  Never skip/delete/weaken assertions, fake success, or mock away the behaviour
  being verified just to obtain a passing result.
- Report unit, database integration, browser and live-provider checks separately.
  Mark unavailable checks as not run. Use illustrative identities only.
- Get an independent review of security-sensitive changes where available;
  tests written by the implementer are not the only evidence.
- Run `pnpm typecheck`, `pnpm lint`, and the relevant existing test commands.
  Do not claim these check all auth scenarios before auth tests exist.
- Record each slice in `AUTH_IMPLEMENTATION.md`: requirement, actual file,
  test/check, result, remaining risk and next step. Update it before handoff.
- Keep the Obsidian login canvas connected to that review map and this standard.
  Add actual file/test links as implementation exists, not imaginary completed
  modules. Flow goes left to right within a stage, then down, with clear gaps.
- A completion report names changed files, why they changed, verification results
  and remaining risks. Do not merge or push without the developer's request.

Canonical learning diagram:
`/Users/mrblackghost/Work/ObsidianVault/03 Projects/Aptus/Aptus Login Flow.canvas`.
The canvas explains the architecture; `AUTH_IMPLEMENTATION.md` records policies
and implementation evidence; this standard governs how the assistant works.
