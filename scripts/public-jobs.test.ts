import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prisma } from '../src/db.js';
import { listPublicJobs } from '../src/lib/public-jobs.js';

await test('public job listing allows ten seconds to acquire its snapshot transaction', async (t) => {
  const original: unknown = Reflect.get(prisma, '$transaction');
  let transactionOptions: unknown;
  Object.defineProperty(prisma, '$transaction', {
    configurable: true,
    value: async (
      callback: (database: {
        post: {
          count: () => Promise<number>;
          findMany: () => Promise<[]>;
        };
      }) => Promise<unknown>,
      options: unknown,
    ) => {
      transactionOptions = options;
      return callback({
        post: {
          count: async () => 0,
          findMany: async () => [],
        },
      });
    },
  });
  t.after(() =>
    Object.defineProperty(prisma, '$transaction', {
      configurable: true,
      value: original,
    }),
  );

  await listPublicJobs(1, 10);

  assert.deepEqual(transactionOptions, {
    isolationLevel: 'RepeatableRead',
    maxWait: 10_000,
    timeout: 5000,
  });
});
