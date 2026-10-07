import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { authDatabase } from './helpers/auth-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);

async function passkeyMigration() {
  const files = (await readdir(migrationDirectory)).filter((file) =>
    /add_auth_passkeys/i.test(file),
  );
  assert.equal(
    files.length,
    1,
    'Expected one additive auth-passkeys migration.',
  );
  return {
    name: files[0],
    sql: await readFile(
      new URL(`${files[0]}/migration.sql`, migrationDirectory),
      'utf8',
    ),
  };
}

async function assertSqlState(
  client: pg.Client,
  query: string,
  values: unknown[],
  expectedCode: string,
) {
  await client.query('SAVEPOINT expected_constraint_failure');
  await assert.rejects(
    client.query(query, values),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === expectedCode,
  );
  await client.query('ROLLBACK TO SAVEPOINT expected_constraint_failure');
}

await test(
  'additive passkey migration preserves existing accounts, sessions, profiles, education and jobs',
  {
    skip:
      !databaseUrl &&
      'Requires TEST_DATABASE_URL; uses a disposable PostgreSQL schema.',
  },
  async () => {
    if (!databaseUrl) throw new Error('Missing test database.');
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    await client.connect().catch(() => {
      throw new Error('Test database connection failed.');
    });
    const schema = `passkey_preservation_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      const migration = await passkeyMigration();
      for (const file of (await readdir(migrationDirectory)).sort()) {
        if (file >= migration.name || file === 'migration_lock.toml') continue;
        await client.query(
          await readFile(
            new URL(`${file}/migration.sql`, migrationDirectory),
            'utf8',
          ),
        );
      }

      await client.query(
        'INSERT INTO "Source" (id, name, url, "fetchedAt") VALUES ($1, $2, $3, $4)',
        [
          'fixture-source',
          'Example Board',
          'https://example.invalid/jobs',
          '2026-01-01T00:00:00Z',
        ],
      );
      await client.query(
        'INSERT INTO "Post" (id, "sourceId", "postName") VALUES ($1, $2, $3)',
        ['fixture-job', 'fixture-source', 'Example Clerk'],
      );
      await client.query(
        'INSERT INTO "User" (id, dob, category) VALUES ($1, $2, $3)',
        ['fixture-profile', '2000-01-01', 'General'],
      );
      await client.query(
        'INSERT INTO "Education" (id, "userId", level, "marksPercent") VALUES ($1, $2, $3, $4)',
        ['fixture-education', 'fixture-profile', 'BACHELORS', 65],
      );
      await client.query(
        'INSERT INTO "AuthUser" (id, name, email, "updatedAt") VALUES ($1, $2, $3, $4)',
        [
          'fixture-account',
          'Example Account',
          'account@example.invalid',
          '2026-01-01T00:00:00Z',
        ],
      );
      await client.query(
        'INSERT INTO "AuthSession" (id, "userId", token, "expiresAt", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
        [
          'fixture-session',
          'fixture-account',
          'illustrative-session-token',
          '2027-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        ],
      );

      const tables = [
        'AuthUser',
        'AuthSession',
        'User',
        'Education',
        'Source',
        'Post',
      ];
      const before = new Map<string, unknown[]>();
      for (const table of tables) {
        before.set(
          table,
          (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows,
        );
      }

      await client.query(migration.sql);

      for (const table of tables) {
        assert.deepEqual(
          (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows,
          before.get(table),
          `${table} records must survive the additive migration unchanged.`,
        );
      }
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  },
);

await test(
  'passkeys persist Better Auth fields, belong to accounts, allow multiple credentials and reject duplicates or unknown accounts',
  {
    skip:
      !databaseUrl &&
      'Requires TEST_DATABASE_URL; uses a disposable PostgreSQL schema.',
  },
  async (t) => {
    if (!databaseUrl) throw new Error('Missing test database.');
    const { client } = await authDatabase(t, databaseUrl);
    const insert = `INSERT INTO "AuthPasskey" (id, name, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp", transports, "createdAt", aaguid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const publicKey = 'AAECAwQFBgcICQ==';
    const fields = [
      'name',
      'publicKey',
      'userId',
      'credentialID',
      'counter',
      'deviceType',
      'backedUp',
      'transports',
      'createdAt',
      'aaguid',
    ];

    await client.query(
      'INSERT INTO "AuthUser" (id, name, email, "updatedAt") VALUES ($1, $2, $3, $4)',
      [
        'fixture-passkey-owner',
        'Passkey Owner',
        'passkey-owner@example.invalid',
        createdAt,
      ],
    );
    await client.query(
      'INSERT INTO "AuthUser" (id, name, email, "updatedAt") VALUES ($1, $2, $3, $4)',
      [
        'fixture-other-owner',
        'Other Owner',
        'other-owner@example.invalid',
        createdAt,
      ],
    );

    const credential = (id: string, credentialId: string) => [
      id,
      'Example device',
      publicKey,
      'fixture-passkey-owner',
      credentialId,
      7,
      'multiDevice',
      true,
      'internal,hybrid',
      createdAt,
      '00000000-0000-0000-0000-000000000001',
    ];
    await client.query(
      insert,
      credential('fixture-passkey-one', 'credential-one'),
    );
    await client.query(
      insert,
      credential('fixture-passkey-two', 'credential-two'),
    );
    await client.query(insert, [
      'fixture-passkey-other',
      'Other device',
      publicKey,
      'fixture-other-owner',
      'credential-other',
      2,
      'singleDevice',
      false,
      'internal',
      createdAt,
      null,
    ]);

    const rows = await client.query(
      'SELECT id, name, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp", transports, "createdAt", aaguid FROM "AuthPasskey" ORDER BY id',
    );
    assert.equal(rows.rowCount, 3);
    assert.deepEqual(rows.rows[0], {
      id: 'fixture-passkey-other',
      name: 'Other device',
      publicKey,
      userId: 'fixture-other-owner',
      credentialID: 'credential-other',
      counter: 2,
      deviceType: 'singleDevice',
      backedUp: false,
      transports: 'internal',
      createdAt,
      aaguid: null,
    });
    assert.deepEqual(
      (
        await client.query(
          'SELECT "userId", count(*)::int AS count FROM "AuthPasskey" GROUP BY "userId" ORDER BY "userId"',
        )
      ).rows,
      [
        { userId: 'fixture-other-owner', count: 1 },
        { userId: 'fixture-passkey-owner', count: 2 },
      ],
    );

    await assertSqlState(
      client,
      insert,
      [
        'fixture-duplicate-credential',
        'Duplicate',
        publicKey,
        'fixture-other-owner',
        'credential-one',
        0,
        'singleDevice',
        false,
        null,
        createdAt.toISOString(),
        null,
      ],
      '23505',
    );
    await assertSqlState(
      client,
      insert,
      [
        'fixture-missing-owner',
        'Unknown account',
        publicKey,
        'missing-account',
        'credential-missing-owner',
        0,
        'singleDevice',
        false,
        null,
        createdAt.toISOString(),
        null,
      ],
      '23503',
    );

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'AuthPasskey'
       ORDER BY ordinal_position`,
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ['id', ...fields],
    );
    assert.doesNotMatch(
      columns.rows.map((row) => row.column_name).join(' '),
      /private.?key|fingerprint|pin/i,
    );
  },
);
