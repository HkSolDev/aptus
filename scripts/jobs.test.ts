import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prisma } from '../src/db.js';
import { server } from '../src/server.js';

// Prisma is a Proxy, so node:test mock.method cannot find its method descriptor.
function replaceTransaction(run: unknown) {
  const original = prisma.$transaction;
  Object.defineProperty(prisma, '$transaction', {
    value: run,
    configurable: true,
    writable: true,
  });
  return {
    restore: () =>
      Object.defineProperty(prisma, '$transaction', {
        value: original,
        configurable: true,
        writable: true,
      }),
  };
}

type FakeDatabase = {
  post: {
    count: () => Promise<number>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
};
type RunQuery = (database: FakeDatabase) => Promise<unknown>;

await test('public jobs HTTP contract', async (t) => {
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());

  await t.test(
    'rejects invalid pagination before database access',
    async () => {
      for (const query of [
        'page=0',
        'page=-1',
        'page=1.5',
        'page=10001',
        'pageSize=0',
        'pageSize=101',
        'pageSize=abc',
        'page=',
        'page=1&page=2',
      ]) {
        const response = await fetch(`${origin}/api/jobs?${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(typeof (await response.json()).error, 'string');
      }
    },
  );

  await t.test('rejects writes with Allow: GET', async () => {
    const response = await fetch(`${origin}/api/jobs`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
  });

  await t.test(
    'anonymous requests use bounded database pagination and public fields',
    async () => {
      let query: Record<string, unknown> = {};
      const transaction = replaceTransaction(async (run: RunQuery) =>
        run({
          post: {
            count: async () => 21,
            findMany: async (args: Record<string, unknown>) => {
              query = args;
              return [
                {
                  id: 'job-21',
                  postName: 'Assistant',
                  applicationLastDate: null,
                },
              ];
            },
          },
        }),
      );
      try {
        const response = await fetch(`${origin}/api/jobs?page=2&pageSize=20`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data[0].id, 'job-21');
        assert.equal(body.data[0].applicationLastDate, null);
        assert.deepEqual(body.pagination, {
          page: 2,
          pageSize: 20,
          totalItems: 21,
          totalPages: 2,
        });
        assert.equal(query.skip, 20);
        assert.equal(query.take, 20);
        assert.deepEqual(query.orderBy, [{ postName: 'asc' }, { id: 'asc' }]);
        const selection = JSON.stringify(query.select);
        assert(!selection.includes('rawHash'));
        assert(!selection.includes('user'));
        assert(selection.includes('notificationPdfUrl'));
      } finally {
        transaction.restore();
      }
    },
  );

  await t.test(
    'empty catalogue has zero pages; default page size is 20',
    async () => {
      const transaction = replaceTransaction(async (run: RunQuery) =>
        run({
          post: { count: async () => 0, findMany: async () => [] },
        }),
      );
      try {
        const response = await fetch(`${origin}/api/jobs`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          data: [],
          pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
        });
      } finally {
        transaction.restore();
      }
    },
  );

  await t.test(
    'database errors return 503 without leaking connection details',
    async () => {
      const transaction = replaceTransaction(async () => {
        throw new Error('private connection details');
      });
      try {
        const response = await fetch(`${origin}/api/jobs`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          error: 'Jobs are temporarily unavailable. Please try again.',
        });
      } finally {
        transaction.restore();
      }
    },
  );
});
