import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { TestContext } from 'node:test';

// Prisma delegates are proxies, so node:test's method lookup cannot patch them.
export function stub(
  t: TestContext,
  target: object,
  key: string,
  implementation: (...args: never[]) => unknown,
) {
  const original = Reflect.get(target, key);
  const fn = t.mock.fn(implementation);
  Object.defineProperty(target, key, { configurable: true, value: fn });
  t.after(() =>
    Object.defineProperty(target, key, { configurable: true, value: original }),
  );
  return fn;
}

export function fixture(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../contracts/${name}`, import.meta.url), 'utf8'),
  );
}

export function worker(command: string, input?: unknown) {
  return JSON.parse(
    execFileSync(
      'services/ai/.venv/bin/python',
      ['contracts/worker-probe.py', command],
      {
        encoding: 'utf8',
        input: input === undefined ? undefined : JSON.stringify(input),
        env: { ...process.env, PYTHONPATH: 'services/ai' },
        timeout: 30_000,
      },
    ),
  );
}

// Use the existing Fastify/Ajv validator; no hand-written JSON Schema engine.
// Responses are validated as request bodies to avoid response-schema stripping.
export async function contractChecker() {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
  });
  const schema = fixture('http.schema.json');
  app.addSchema(fixture('legacy-post.schema.json'));
  app.addSchema(schema);
  for (const name of Object.keys(schema.definitions)) {
    app.post(`/${name}`, {
      schema: { body: { $ref: `${schema.$id}#/definitions/${name}` } },
      handler: (request) => request.body,
    });
  }
  await app.ready();
  return {
    close: () => app.close(),
    async accepts(name: string, value: unknown) {
      const result = await app.inject({
        method: 'POST',
        url: `/${name}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(value),
      });
      return result.statusCode === 200;
    },
    async assert(name: string, value: unknown) {
      const result = await app.inject({
        method: 'POST',
        url: `/${name}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(value),
      });
      assert.equal(result.statusCode, 200, `${name}: ${result.body}`);
      assert.deepEqual(
        result.json(),
        value,
        'Validation must not rewrite data',
      );
    },
  };
}
