import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import { contractChecker, fixture } from './support.js';

test('protected contract artifacts match the coordinator-reviewed lock', () => {
  const lock = fixture('lock.json');
  assert.equal(lock.revision, 'local-v1.1');
  for (const [path, hash] of Object.entries(lock.sha256)) {
    assert.equal(
      createHash('sha256').update(readFileSync(path)).digest('hex'),
      hash,
      `${path}: contract drift; request review rather than regenerating expectations`,
    );
  }
});

test('OpenAPI and JSON Schema local references resolve to concrete definitions', () => {
  const seen = new Set<string>();
  function inspect(file: string) {
    file = resolve(file);
    if (seen.has(file)) return;
    seen.add(file);
    const root: unknown = JSON.parse(readFileSync(file, 'utf8'));
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (key !== '$ref' || typeof item !== 'string') {
          visit(item);
          continue;
        }
        assert.ok(
          !item.includes('://'),
          'Boundary references must resolve offline',
        );
        const [relative, pointer] = item.split('#');
        const target = relative ? resolve(dirname(file), relative) : file;
        let node: unknown = JSON.parse(readFileSync(target, 'utf8'));
        for (const part of (pointer ?? '').split('/').slice(1)) {
          assert.ok(node && typeof node === 'object');
          node = Reflect.get(
            node,
            part.replaceAll('~1', '/').replaceAll('~0', '~'),
          );
          assert.notEqual(node, undefined, `${item} must exist`);
        }
        inspect(target);
      }
    }
    visit(root);
  }
  inspect('contracts/http.openapi.json');
});

test('required response keys stay required while explicitly unknown values remain valid', async (t) => {
  const check = await contractChecker();
  t.after(() => check.close());
  const profile = {
    profile: {
      dob: '2000-02-29',
      category: null,
      educations: [{ level: 'TENTH', marksPercent: null }],
    },
  };
  await check.assert('ProfileResponse', profile);
  await check.assert('ProfileResponse', { profile: null });
  assert.equal(await check.accepts('ProfileResponse', {}), false);
  assert.equal(await check.accepts('SaveResponse', {}), false);
  assert.equal(await check.accepts('SaveResponse', { saved: false }), false);
  assert.equal(await check.accepts('SavedStatus', { savedIds: [null] }), false);
  assert.equal(await check.accepts('SavedStatus', { savedIds: [123] }), false);
  assert.equal(
    await check.accepts('Pagination', {
      page: '1',
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    }),
    false,
  );
  await check.assert('Pagination', {
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
});
