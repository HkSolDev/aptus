import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;

await test(
  'core migration enforces ownership and uniqueness without changing profiles',
  { skip: !databaseUrl && 'Requires a separate TEST_DATABASE_URL' },
  async () => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
    await client.connect().catch(() => {
      throw new Error('Test database connection failed');
    });
    try {
      await client.query('BEGIN');
      const schema = `auth_core_test_${randomUUID().replaceAll('-', '')}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      const directory = new URL('../prisma/migrations/', import.meta.url);
      const current = '20261006110000_add_auth_core';
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
        `INSERT INTO "User" (id, dob, category) VALUES ($1, $2, $3)`,
        ['old-profile', '2000-01-01', 'General'],
      );
      await client.query(
        `INSERT INTO "Education" (id, "userId", level) VALUES ($1, $2, $3)`,
        ['old-education', 'old-profile', 'BACHELORS'],
      );
      await client.query(
        `INSERT INTO "AuthUser" (id, name, email, "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        ['owner', 'Example', 'example@example.invalid'],
      );
      const before = await client.query('SELECT * FROM "User"');
      const educationBefore = await client.query('SELECT * FROM "Education"');
      const sql = await readFile(
        new URL(`${current}/migration.sql`, directory),
        'utf8',
      );
      // The test owns the outer transaction, so it supplies BEGIN/ROLLBACK.
      await client.query(
        sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''),
      );
      assert.deepEqual(
        (await client.query('SELECT * FROM "User"')).rows,
        before.rows,
      );
      assert.deepEqual(
        (await client.query('SELECT * FROM "Education"')).rows,
        educationBefore.rows,
      );

      const insertSession = `INSERT INTO "AuthSession" (id, "userId", token, "expiresAt", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '1 day', CURRENT_TIMESTAMP)`;
      await client.query(insertSession, [
        'session-a',
        'owner',
        'illustrative-session-a',
      ]);
      const insertAccount = `INSERT INTO "AuthAccount" (id, "userId", "providerId", "accountId", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`;
      await client.query(insertAccount, [
        'provider-a',
        'owner',
        'google',
        'illustrative-google-id',
      ]);
      await client.query(
        `INSERT INTO "AuthUser" (id, name, email, "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        ['other-owner', 'Other Example', 'other@example.invalid'],
      );
      const mustReject = async (
        query: string,
        values: string[],
        code: string,
      ) => {
        await client.query('SAVEPOINT constraint_check');
        await assert.rejects(
          client.query(query, values),
          (error: unknown) =>
            error instanceof Error && 'code' in error && error.code === code,
        );
        await client.query('ROLLBACK TO SAVEPOINT constraint_check');
      };
      await mustReject(
        insertSession,
        ['session-b', 'owner', 'illustrative-session-a'],
        '23505',
      );
      await mustReject(
        insertSession,
        ['session-c', 'missing-owner', 'illustrative-session-c'],
        '23503',
      );
      await mustReject(
        insertAccount,
        ['provider-b', 'other-owner', 'google', 'illustrative-google-id'],
        '23505',
      );
      await mustReject(
        insertAccount,
        ['provider-c', 'missing-owner', 'google', 'another-id'],
        '23503',
      );
      await client.query(
        `INSERT INTO "AuthVerification" (id, identifier, value, "expiresAt", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP + interval '5 minutes', CURRENT_TIMESTAMP)`,
        ['attempt', 'illustrative-attempt', 'illustrative-proof'],
      );

      // Removing a session must leave its account intact.
      await client.query('DELETE FROM "AuthSession" WHERE id = $1', [
        'session-a',
      ]);
      assert.equal(
        (await client.query('SELECT id FROM "AuthAccount"')).rowCount,
        1,
      );
      await client.query(insertSession, [
        'session-d',
        'owner',
        'illustrative-session-d',
      ]);
      await client.query('DELETE FROM "AuthUser" WHERE id = $1', ['owner']);
      assert.equal(
        (await client.query('SELECT id FROM "AuthSession"')).rowCount,
        0,
      );
      assert.equal(
        (await client.query('SELECT id FROM "AuthAccount"')).rowCount,
        0,
      );
      assert.deepEqual(
        (await client.query('SELECT * FROM "User"')).rows,
        before.rows,
      );
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  },
);
