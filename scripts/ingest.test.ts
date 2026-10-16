import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

const token = 'fictional-ingest-credential-for-tests-only';

await test('ingestion rejects malformed rules before accessing the database', async (t) => {
  const server = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => server.close());
  for (const post of [
    null,
    { post_name: 'Example', eligibility_rules: 'invalid shape' },
    { post_name: 'Example', eligibility_rules: { age_rules: [] } },
  ]) {
    const result = await server.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        source_url: 'https://example.invalid/notice',
        source_name: 'Fixture',
        posts: [post],
      },
    });
    const response = {
      status: result.statusCode,
      body: result.json<{ error: string }>(),
    };
    assert.equal(response.status, 400);
    assert.match(response.body.error, /posts\[0\]/);
  }
});
