import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { server } from '../src/server.js';

test('ingestion rejects malformed rules before accessing the database', async () => {
  for (const post of [
    null,
    { post_name: 'Example', eligibility_rules: 'invalid shape' },
    { post_name: 'Example', eligibility_rules: { age_rules: [] } },
  ]) {
    const req = Object.assign(
      Readable.from([
        JSON.stringify({
          source_url: 'https://example.invalid/notice',
          source_name: 'Fixture',
          posts: [post],
        }),
      ]),
      {
        method: 'POST',
        url: '/api/internal/ingest',
        headers: { host: 'localhost' },
      },
    );
    const response = await new Promise<{
      status: number;
      body: { error: string };
    }>((resolve) => {
      const res = {
        status: 0,
        writeHead(status: number) {
          this.status = status;
        },
        end(text: string) {
          resolve({ status: this.status, body: JSON.parse(text) });
        },
      };
      server.emit('request', req, res);
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /posts\[0\]/);
  }
});
