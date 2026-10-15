import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createDesignReviewApi } from './design-review-api.js';

function parseReviewResponse(value: unknown) {
  assert(value && typeof value === 'object');
  assert('designReview' in value && value.designReview === true);
  assert('data' in value && Array.isArray(value.data));
  return value.data.map((job: unknown) => {
    assert(job && typeof job === 'object');
    assert('postName' in job && typeof job.postName === 'string');
    assert('applicationLastDate' in job);
    return {
      postName: job.postName,
      applicationLastDate: job.applicationLastDate,
    };
  });
}

void test('local review serves the approved examples, filters and sorts without accepting writes', async (t) => {
  const api = createDesignReviewApi();
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise<void>((resolve) => api.close(() => resolve())));
  const address = api.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const all = parseReviewResponse(
    await (await fetch(`${origin}/api/jobs`)).json(),
  );
  assert.equal(all.length, 4);
  assert.match(all[0].postName, /^Technical Assistant/);
  assert.equal(all[3].applicationLastDate, null);
  const filtered = parseReviewResponse(
    await (
      await fetch(`${origin}/api/jobs?qualification=DIPLOMA&sort=furthest`)
    ).json(),
  );
  assert.equal(filtered.length, 2);
  assert.equal(filtered[1].applicationLastDate, null);
  const furthest = parseReviewResponse(
    await (await fetch(`${origin}/api/jobs?sort=furthest`)).json(),
  );
  assert.match(furthest[0].postName, /^Assistant Engineer/);
  assert.equal(
    (await fetch(`${origin}/api/jobs?qualification=UNKNOWN`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${origin}/api/auth/sign-in/social`, { method: 'POST' }))
      .status,
    405,
  );
  assert.equal((await fetch(`${origin}/api/profile`)).status, 404);
});
