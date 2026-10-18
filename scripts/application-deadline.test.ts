import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeApplicationWhere } from '../src/lib/application-deadline.js';
import { authDatabase } from './helpers/auth-database.js';
import { prisma } from '../src/db.js';
import { listPublicJobs } from '../src/lib/public-jobs.js';
import { getMatchesForUser } from './match.js';

await test('deadline dates stay visible through their final day in India', () => {
  for (const now of ['2026-10-18T00:00:00Z', '2026-10-18T18:29:59Z']) {
    assert.deepEqual(activeApplicationWhere(new Date(now)), {
      OR: [
        { applicationLastDate: null },
        { applicationLastDate: { gte: new Date('2026-10-18T00:00:00Z') } },
      ],
    });
  }
  assert.deepEqual(activeApplicationWhere(new Date('2026-10-18T18:30:00Z')), {
    OR: [
      { applicationLastDate: null },
      { applicationLastDate: { gte: new Date('2026-10-19T00:00:00Z') } },
    ],
  });
});

await test(
  'expired jobs are excluded before database counts and pagination',
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async (t) => {
    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-10-18T18:29:59Z'),
    });
    const connection = process.env.TEST_DATABASE_URL;
    assert(connection);
    const { database } = await authDatabase(t, connection);
    const original: unknown = Reflect.get(prisma, '$transaction');
    Object.defineProperty(prisma, '$transaction', {
      configurable: true,
      value: database.$transaction.bind(database),
    });
    t.after(() =>
      Object.defineProperty(prisma, '$transaction', {
        configurable: true,
        value: original,
      }),
    );
    const source = await database.source.create({
      data: {
        name: 'Example source',
        url: 'https://example.invalid/deadlines',
        rawHash: 'fictional',
      },
    });
    await database.post.createMany({
      data: [
        {
          id: 'expired',
          sourceId: source.id,
          postName: 'Example expired',
          applicationLastDate: new Date('2026-10-17T00:00:00Z'),
        },
        {
          id: 'today',
          sourceId: source.id,
          postName: 'Example today',
          applicationLastDate: new Date('2026-10-18T00:00:00Z'),
        },
        {
          id: 'future',
          sourceId: source.id,
          postName: 'Example future',
          applicationLastDate: new Date('2026-10-19T00:00:00Z'),
        },
        {
          id: 'unknown',
          sourceId: source.id,
          postName: 'Example unknown',
          applicationLastDate: null,
        },
      ],
    });
    const profile = await database.user.create({
      data: {
        dob: new Date('1998-01-01'),
        category: 'UNSPECIFIED',
      },
    });
    const originalPosts: unknown = Reflect.get(prisma.post, 'findMany');
    const originalUser: unknown = Reflect.get(prisma.user, 'findUniqueOrThrow');
    Object.defineProperty(prisma.post, 'findMany', {
      configurable: true,
      value: database.post.findMany.bind(database.post),
    });
    Object.defineProperty(prisma.user, 'findUniqueOrThrow', {
      configurable: true,
      value: database.user.findUniqueOrThrow.bind(database.user),
    });
    t.after(() => {
      Object.defineProperty(prisma.post, 'findMany', {
        configurable: true,
        value: originalPosts,
      });
      Object.defineProperty(prisma.user, 'findUniqueOrThrow', {
        configurable: true,
        value: originalUser,
      });
    });
    assert.deepEqual(
      (await getMatchesForUser(profile.id)).map((job) => job.id).sort(),
      ['future', 'today', 'unknown'],
    );
    const filters = {
      q: 'Example',
      qualification: '',
      sort: 'soonest',
    } as const;
    const first = await listPublicJobs(1, 1, filters);
    assert.equal(first.pagination.totalItems, 3);
    assert.equal(first.pagination.totalPages, 3);
    assert.equal(first.data[0].id, 'today');
    assert.equal((await listPublicJobs(3, 1, filters)).data[0].id, 'unknown');
    t.mock.timers.setTime(new Date('2026-10-18T18:30:00Z').getTime());
    const nextDay = await listPublicJobs(1, 10, filters);
    assert.equal(nextDay.pagination.totalItems, 2);
    assert.deepEqual(
      nextDay.data.map((job) => job.id),
      ['future', 'unknown'],
    );
    assert.deepEqual(
      (await getMatchesForUser(profile.id)).map((job) => job.id).sort(),
      ['future', 'unknown'],
    );
  },
);
