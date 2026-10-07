import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { getSchema } from 'better-auth/db';
import { Prisma } from '../generated/prisma/index.js';

// Prisma 7's compact runtime metadata omits required/default/unique attributes.
const schema = await readFile(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = await readFile(
  new URL(
    '../prisma/migrations/20261006100000_add_auth_identity/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const identityBlock = schema.match(/model AuthUser \{([^}]+)\}/)?.[1];
assert.ok(identityBlock);

await test('login identity matches the installed Better Auth user fields', () => {
  const identity = Prisma.dmmf.datamodel.models.find(
    (model) => model.name === 'AuthUser',
  );
  assert.ok(identity);
  const expected = getSchema({ user: { modelName: 'AuthUser' } }).AuthUser;
  for (const [name, field] of Object.entries(expected.fields)) {
    const actual: Prisma.DMMF.Field | undefined = identity.fields.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(actual, `Missing auth field: ${name}`);
    const types: Record<string, string> = {
      string: 'String',
      boolean: 'Boolean',
      date: 'DateTime',
    };
    assert.ok(typeof field.type === 'string');
    assert.equal(actual.type, types[field.type]);
    const declaredType: string | undefined = identityBlock.match(
      new RegExp(`^\\s*${name}\\s+(\\w+\\??)`, 'm'),
    )?.[1];
    assert.ok(declaredType);
    assert.equal(!declaredType.endsWith('?'), field.required ?? false);
  }
  assert.match(identityBlock, /email\s+String\s+@unique/);
  assert.match(migration, /CREATE UNIQUE INDEX "AuthUser_email_key"/);
  assert.equal(
    identity.fields.find((field) => field.name === 'dob'),
    undefined,
  );
  assert.equal(
    identity.fields.find((field) => field.name === 'category'),
    undefined,
  );
});

await test('profile ownership is optional, unique and has no automatic default', () => {
  const profile = Prisma.dmmf.datamodel.models.find(
    (model) => model.name === 'User',
  );
  assert.ok(profile);
  const owner = profile.fields.find((field) => field.name === 'authUserId');
  assert.ok(owner);
  const declaration = schema.match(/^\s*authUserId[^\n]+/m)?.[0];
  assert.ok(declaration);
  assert.match(declaration, /String\?\s+@unique/);
  assert.doesNotMatch(declaration, /@default/);
  const relation = profile.fields.find((field) => field.name === 'authUser');
  assert.equal(relation?.type, 'AuthUser');
  assert.match(
    schema,
    /@relation\(fields: \[authUserId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(migration, /ADD COLUMN "authUserId" TEXT;/);
  assert.match(migration, /CREATE UNIQUE INDEX "User_authUserId_key"/);
  assert.match(migration, /REFERENCES "AuthUser"\("id"\)\s+ON DELETE RESTRICT/);
  assert.doesNotMatch(
    migration,
    /\b(UPDATE\s+"User"|DELETE\s+FROM|DROP\s+TABLE)\b/i,
  );
});
