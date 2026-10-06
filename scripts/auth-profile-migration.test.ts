import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;

await test(
  'identity migration preserves profiles and education without claiming them',
  { skip: !databaseUrl && 'Requires a separate TEST_DATABASE_URL' },
  async () => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    // Never include connection errors, which may contain credentials, in output.
    await client.connect().catch(() => {
      throw new Error('Test database connection failed');
    });
    try {
      await client.query('BEGIN');
      const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      const directory = new URL('../prisma/migrations/', import.meta.url);
      const current = '20261006100000_add_auth_identity';
      for (const migration of (await readdir(directory)).sort()) {
        if (migration >= current || migration === 'migration_lock.toml')
          continue;
        await client.query(
          await readFile(
            new URL(`${migration}/migration.sql`, directory),
            'utf8',
          ),
        );
      }
      await client.query(
        `INSERT INTO "User" (id, name, dob, category) VALUES ($1, $2, $3, $4)`,
        ['fixture-profile', 'Example Applicant', '2000-01-01', 'General'],
      );
      await client.query(
        `INSERT INTO "Education" (id, "userId", level, "marksPercent") VALUES ($1, $2, $3, $4)`,
        ['fixture-education', 'fixture-profile', 'BACHELORS', 65],
      );
      const before = await client.query('SELECT * FROM "User"');
      const educationBefore = await client.query('SELECT * FROM "Education"');
      await client.query(
        await readFile(new URL(`${current}/migration.sql`, directory), 'utf8'),
      );
      const after = await client.query('SELECT * FROM "User"');
      assert.deepEqual(
        after.rows,
        before.rows.map((row: Record<string, unknown>) => ({
          ...row,
          authUserId: null,
        })),
      );
      assert.deepEqual(
        (await client.query('SELECT * FROM "Education"')).rows,
        educationBefore.rows,
      );
      assert.equal(
        (await client.query('SELECT * FROM "AuthUser"')).rowCount,
        0,
      );

      // A matching display name still must not claim an existing profile.
      await client.query(
        `INSERT INTO "AuthUser" (id, name, email, "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        ['fixture-account', 'Example Applicant', 'example@example.invalid'],
      );
      assert.equal(
        (
          await client.query<{ authUserId: string | null }>(
            'SELECT "authUserId" FROM "User"',
          )
        ).rows[0].authUserId,
        null,
      );
    } finally {
      // Test-created tables and fictional rows disappear together.
      await client.query('ROLLBACK');
      await client.end();
    }
  },
);
