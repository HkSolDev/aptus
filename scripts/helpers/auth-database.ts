import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/index.js';

export async function authDatabase(t: TestContext, connectionString: string) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  const schema = `auth_flow_test_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString }, { schema }),
  });
  t.after(async () => {
    await database.$disconnect();
    // Remove only the random schema this test created, never application tables.
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  });
  await client.query(`SET search_path TO "${schema}"`);
  const directory = new URL('../../prisma/migrations/', import.meta.url);
  for (const migration of (await readdir(directory)).sort()) {
    if (migration === 'migration_lock.toml') continue;
    await client.query(
      await readFile(new URL(`${migration}/migration.sql`, directory), 'utf8'),
    );
  }
  return { database, client };
}
