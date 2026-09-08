import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import http from 'node:http';
import { server } from '../src/server.js';

interface InvokeResult {
  status: number;
  body: Record<string, unknown>;
}

function invokeServer(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<InvokeResult> {
  return new Promise((resolve) => {
    const req = Object.assign(new Readable(), {
      method,
      url: urlPath,
      headers: { host: 'localhost', 'content-type': 'application/json' },
      _read() {},
    });

    if (body !== undefined) {
      req.push(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.push(null);

    let statusCode = 200;
    let resBody = '';

    const res = Object.assign(
      new http.ServerResponse(req as unknown as http.IncomingMessage),
      {
        writeHead(status: number) {
          statusCode = status;
          return this;
        },
        end(chunk?: string | Buffer) {
          if (chunk) resBody += chunk.toString();
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(resBody);
          } catch {
            parsed = { raw: resBody };
          }
          resolve({ status: statusCode, body: parsed });
          return this;
        },
        write(chunk: string | Buffer) {
          if (chunk) resBody += chunk.toString();
          return true;
        },
      },
    );

    server.emit('request', req, res);
  });
}

describe('POST /api/explain validation', () => {
  test('returns 400 when postId is missing', async () => {
    const res = await invokeServer('POST', '/api/explain', {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'postId is required');
  });

  test('returns 400 when postId is not a string', async () => {
    const res = await invokeServer('POST', '/api/explain', { postId: 12345 });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'postId is required');
  });

  test('returns 400 when body is empty string', async () => {
    const res = await invokeServer('POST', '/api/explain', '');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'postId is required');
  });
});
