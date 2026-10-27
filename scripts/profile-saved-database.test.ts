import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authDatabase } from './helpers/auth-database.js';
import { prisma } from '../src/db.js';
import { createAuth } from '../src/auth/auth.js';
import { buildApp } from '../src/app.js';

const connection = process.env.TEST_DATABASE_URL;
test(
  'isolated database: profile round-trip, account ownership, matching and idempotent saved jobs',
  { skip: !connection },
  async (t) => {
    const { database } = await authDatabase(t, connection!);
    for (const key of [
      'user',
      'education',
      'savedJob',
      'post',
      'source',
      '$transaction',
    ] as const) {
      const original = Reflect.get(prisma, key);
      const value =
        key === '$transaction'
          ? database.$transaction.bind(database)
          : database[key];
      Object.defineProperty(prisma, key, { configurable: true, value });
      t.after(() =>
        Object.defineProperty(prisma, key, {
          configurable: true,
          value: original,
        }),
      );
    }
    for (const id of ['fixture-a', 'fixture-b'])
      await database.authUser.create({
        data: { id, name: 'Fixture', email: `${id}@example.test` },
      });
    const source = await database.source.create({
      data: { name: 'Fixture source', url: 'https://example.test/notice' },
    });
    const post = await database.post.create({
      data: {
        sourceId: source.id,
        postName: 'Fixture job',
        minAge: 18,
        maxAge: 60,
        minEducationLevel: 'TENTH',
      },
    });
    const auth = createAuth({
      origin: 'https://aptus.example',
      secret: 'fictional-test-only-secret-not-for-production-0123456789',
      googleClientId: 'example.apps.googleusercontent.com',
      googleClientSecret: 'fictional-client-secret',
    });
    let identity: string | null = 'fixture-a';
    t.mock.method(auth.api, 'getSession', async () =>
      identity
        ? {
            user: { id: identity },
            session: { expiresAt: new Date(Date.now() + 60000) },
          }
        : null,
    );
    const app = buildApp(auth);
    t.after(() => app.close());
    const request = (
      method: 'GET' | 'PUT' | 'POST' | 'DELETE',
      url: string,
      payload?: object,
    ) =>
      app.inject({
        method,
        url,
        headers: { origin: 'https://aptus.example' },
        ...(payload ? { payload } : {}),
      });
    const profile = {
      dob: '1995-01-02',
      category: null,
      educations: [{ level: 'BACHELORS', marksPercent: 70 }],
    };
    assert.equal(
      (await request('PUT', '/api/profile', profile)).statusCode,
      200,
    );
    assert.deepEqual(
      (await request('GET', '/api/profile')).json().profile,
      profile,
    );
    const updated = {
      ...profile,
      educations: [{ level: 'DIPLOMA', marksPercent: 80 }],
    };
    assert.equal(
      (await request('PUT', '/api/profile', updated)).statusCode,
      200,
    );
    assert.deepEqual(
      (await request('GET', '/api/profile')).json().profile,
      updated,
    );
    assert.equal(await database.education.count(), 1);
    const beforeMatch = await database.user.findUniqueOrThrow({
      where: { authUserId: 'fixture-a' },
      include: { educations: true },
    });
    assert.equal((await request('POST', '/api/match', {})).statusCode, 200);
    assert.deepEqual(
      await database.user.findUniqueOrThrow({
        where: { authUserId: 'fixture-a' },
        include: { educations: true },
      }),
      beforeMatch,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await request('PUT', `/api/saved-jobs/${post.id}`)).statusCode,
        200,
      );
    assert.equal(await database.savedJob.count(), 1);
    assert.equal(
      (await request('GET', '/api/saved-jobs')).json().pagination.totalItems,
      1,
    );
    identity = 'fixture-b';
    assert.equal((await request('GET', '/api/profile')).json().profile, null);
    assert.deepEqual(
      (await request('GET', `/api/saved-jobs/status?ids=${post.id}`)).json()
        .savedIds,
      [],
    );
    assert.equal(
      (await request('GET', '/api/saved-jobs')).json().pagination.totalItems,
      0,
    );
    await request('DELETE', `/api/saved-jobs/${post.id}`);
    assert.equal(await database.savedJob.count(), 1);
    identity = null;
    for (const [method, url] of [
      ['GET', '/api/profile'],
      ['GET', '/api/saved-jobs'],
      ['PUT', `/api/saved-jobs/${post.id}`],
    ] as const)
      assert.equal((await request(method, url)).statusCode, 401);
    identity = 'fixture-a';
    assert.equal(
      (
        await request('PUT', '/api/profile', {
          ...profile,
          authUserId: 'fixture-b',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/saved-jobs/${post.id}`,
          headers: { origin: 'https://untrusted.example' },
        })
      ).statusCode,
      403,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await request('DELETE', `/api/saved-jobs/${post.id}`)).statusCode,
        200,
      );
    assert.equal(await database.savedJob.count(), 0);
  },
);
