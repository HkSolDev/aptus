import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getSchema } from 'better-auth/db';
import { Prisma } from '../generated/prisma/index.js';

const schema = await readFile(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const tables = getSchema({
  user: { modelName: 'AuthUser' },
  session: { modelName: 'AuthSession' },
  account: { modelName: 'AuthAccount' },
  verification: { modelName: 'AuthVerification' },
});

await test('all core models match the pinned Better Auth schema', () => {
  const types: Record<string, string> = {
    string: 'String',
    boolean: 'Boolean',
    date: 'DateTime',
  };
  for (const [name, table] of Object.entries(tables)) {
    const model = Prisma.dmmf.datamodel.models.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(model, `Missing model: ${name}`);
    const block: string | undefined = schema.match(
      new RegExp(`model ${name} \\{([^}]+)\\}`),
    )?.[1];
    assert.ok(block);
    for (const [fieldName, field] of Object.entries(table.fields)) {
      const actual: Prisma.DMMF.Field | undefined = model.fields.find(
        (candidate) => candidate.name === fieldName,
      );
      assert.ok(actual, `Missing ${name}.${fieldName}`);
      assert.ok(typeof field.type === 'string');
      assert.equal(actual.type, types[field.type]);
      const declared: string | undefined = block.match(
        new RegExp(`^\\s*${fieldName}\\s+(\\w+\\??)`, 'm'),
      )?.[1];
      assert.ok(declared);
      assert.equal(!declared.endsWith('?'), field.required ?? false);
      if (field.unique)
        assert.match(block, new RegExp(`${fieldName}\\s+\\w+\\s+@unique`));
      if (field.references) {
        assert.match(block, /references: \[id\], onDelete: Cascade/);
        assert.match(block, /user\s+AuthUser\s+@relation/);
      }
    }
  }
});

await test('provider identity cannot belong to two Aptus accounts', () => {
  assert.match(schema, /@@unique\(\[providerId, accountId\]\)/);
});
