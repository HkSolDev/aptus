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

describe('POST /api/match validation', () => {
  test('returns 400 when dob is missing or invalid', async () => {
    const res = await invokeServer('POST', '/api/match', {
      educations: [{ level: 'BACHELORS' }],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'A valid Date of Birth (dob) is required',
    );
  });

  test('returns 400 when educations is empty', async () => {
    const res = await invokeServer('POST', '/api/match', {
      dob: '1998-05-15',
      educations: [],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'At least one education entry is required',
    );
  });

  test('returns 400 when education level is invalid', async () => {
    const res = await invokeServer('POST', '/api/match', {
      dob: '1998-05-15',
      educations: [{ level: 'INVALID_LEVEL' }],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Invalid education level: INVALID_LEVEL');
  });
});
