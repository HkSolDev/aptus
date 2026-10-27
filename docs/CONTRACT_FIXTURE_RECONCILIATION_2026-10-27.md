# Contract fixture reconciliation — 27 October 2026

Owner: main coordinator, taking over Agent 1's authorized local integration.

## Reason

The integration snapshot was based on an older checkout. Comparing it with
released revision `7e974cc098f405475f7093567bcf26cde4c40a4a` exposed omitted
security pins/overrides, CI checks, mobile changes, profile checks and concurrent
Save protection. The candidate now incorporates that released revision locally.

The frozen Save test adapter assumed an older implementation: it discarded the
client request body and stubbed `savedJob.upsert`. Released clients send `{}`
with JSON Content-Type; released storage uses duplicate-safe `createMany` and
`findUniqueOrThrow`. Reverting these would regress deployed behavior.

## Bounded adapter change

- Forward the actual client body into Fastify injection.
- Stub the released storage calls, asserting the exact account/job IDs and
  `skipDuplicates: true`.
- Preserve all original response-schema, ownership, Origin and result assertions.
- No schema, wire response, eligibility policy, publication gate or allowed
  input definition is changed. This is a test adapter reconciliation, not a
  semantic revision of local-v1.

Only `scripts/contracts/frontend-backend.test.ts` changes among the 19 locked
artifacts. Its SHA-256 changes from
`c27c2d04be713ca2014bc2c467afdae3664db580734f75d6612c06b561f99493` to
`83439e2d13b7f6455927877199b56c05e5c5f0330c7945b968fa26150a0fcde3`.
The coordinator explicitly updates that one lock entry; automatic lock
regeneration is not introduced.

Before adaptation, the real client/route test failed with HTTP 400 because its
adapter sent JSON Content-Type without the actual body. After adaptation all
three tests in that file pass. Logs are in
`/private/tmp/aptus-verification-logs-20261027/32-production-fixture-before.log`
and `33-production-fixture-after.log`.

Review this fixture and lock diff together. Rollback both together if the adapter
change is rejected; retain the released implementation and report the obsolete
fixture rather than changing production behavior to satisfy its old mocks.

No push, merge into main, deployment or production mutation is authorized here.
