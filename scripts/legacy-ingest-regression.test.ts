import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authDatabase } from './helpers/auth-database.js';
import { prisma } from '../src/db.js';
import { buildApp } from '../src/app.js';

const connection = process.env.TEST_DATABASE_URL;
const token = 'fictional-ingest-credential-for-tests-only';

test(
  'isolated database: unusable nonempty batches cannot overwrite source metadata or delete posts',
  { skip: !connection },
  async (t) => {
    const { database } = await authDatabase(t, connection!);

    for (const key of ['post', 'source', '$transaction'] as const) {
      const original = Reflect.get(prisma, key);
      const value =
        key === '$transaction'
          ? database.$transaction.bind(database)
          : database[key];
      Object.defineProperty(prisma, key, { configurable: true, value });
      t.after(() =>
        Object.defineProperty(prisma, key, {
          configurable: true,
          value: original,
        }),
      );
    }

    const app = buildApp(undefined, {
      AUTH_ENABLED: 'false',
      INGEST_TOKEN: token,
    });
    t.after(() => app.close());

    const postPayload = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/internal/ingest',
        headers: { authorization: `Bearer ${token}` },
        payload: payload as object,
      });

    // 1. Seed an illustrative source with two posts and a known hash/metadata.
    const sourceUrl = 'https://example.test/notices/illustrative-legacy-guard';
    const seededSource = await database.source.create({
      data: {
        url: sourceUrl,
        name: 'Illustrative State Service Commission',
        rawHash: 'hash-initial-good-state-v1',
        notificationPdfUrl: 'https://example.test/notices/v1.pdf',
        officialSiteUrl: 'https://example.test',
        applyUrl: 'https://example.test/apply',
      },
    });

    const seededPost1 = await database.post.create({
      data: {
        sourceId: seededSource.id,
        postName: 'Illustrative Assistant Engineer',
        vacancies: 10,
        minAge: 21,
        maxAge: 32,
      },
    });

    const seededPost2 = await database.post.create({
      data: {
        sourceId: seededSource.id,
        postName: 'Illustrative Junior Officer',
        vacancies: 5,
        minAge: 18,
        maxAge: 28,
      },
    });

    const takeSnapshot = async () => {
      const source = await database.source.findUniqueOrThrow({
        where: { id: seededSource.id },
      });
      const posts = await database.post.findMany({
        where: { sourceId: seededSource.id },
        orderBy: { id: 'asc' },
      });
      return { source, posts };
    };

    const initialSnapshot = await takeSnapshot();
    assert.equal(initialSnapshot.posts.length, 2);
    assert.deepEqual(
      initialSnapshot.posts.map((p) => p.id),
      [seededPost1.id, seededPost2.id],
    );

    // 2 & 3. Submit nonempty batches containing null, empty, whitespace, and omitted names; assert HTTP 400.
    const unusableBatches = [
      [{}],
      [{ post_name: null }],
      [{ post_name: '' }],
      [{ post_name: '   \t\n  ' }],
      [{ post_name: null }, { post_name: '' }, { post_name: '   ' }],
    ];

    for (const posts of unusableBatches) {
      const res = await postPayload({
        source_url: sourceUrl,
        source_name: 'Attempted Overwrite Name',
        raw_hash: 'hash-unusable-overwrite-attempt',
        notification_pdf_url: 'https://example.test/notices/corrupt.pdf',
        posts,
      });

      assert.equal(
        res.statusCode,
        400,
        `Expected HTTP 400 for unusable batch ${JSON.stringify(posts)}, got ${res.statusCode}`,
      );
      const body = res.json<{ error: string }>();
      assert.match(body.error, /at least one nonblank post_name is required/i);

      // 4. Read back source and posts; compare all stored fields, IDs, and timestamps.
      // They must be unchanged.
      const current = await takeSnapshot();
      assert.deepEqual(
        current.source,
        initialSnapshot.source,
        'Source row must not be modified by unusable batch',
      );
      assert.deepEqual(
        current.posts,
        initialSnapshot.posts,
        'Existing posts must not be deleted or modified by unusable batch',
      );
    }

    // 5. Submit an unusable batch for an unknown source; assert no source is created.
    const unknownSourceUrl =
      'https://example.test/notices/unknown-never-created';
    const unknownRes = await postPayload({
      source_url: unknownSourceUrl,
      source_name: 'Unknown Never Created',
      raw_hash: 'hash-unknown-source',
      posts: [{ post_name: '   ' }],
    });
    assert.equal(unknownRes.statusCode, 400);
    const createdUnknown = await database.source.findUnique({
      where: { url: unknownSourceUrl },
    });
    assert.equal(
      createdUnknown,
      null,
      'No source must be created for unusable batch',
    );

    // 6. Verify malformed name types return 400 without writes.
    const malformedBatches = [
      [{ post_name: 12345 }],
      [{ post_name: true }],
      [{ post_name: ['Clerk'] }],
      [{ post_name: { nested: 'Clerk' } }],
    ];

    for (const posts of malformedBatches) {
      const res = await postPayload({
        source_url: sourceUrl,
        source_name: 'Malformed Attempt',
        raw_hash: 'hash-malformed-attempt',
        posts,
      });

      assert.equal(
        res.statusCode,
        400,
        `Expected HTTP 400 for malformed post_name type, got ${res.statusCode}`,
      );

      const current = await takeSnapshot();
      assert.deepEqual(
        current.source,
        initialSnapshot.source,
        'Source row must remain untouched after malformed name type',
      );
      assert.deepEqual(
        current.posts,
        initialSnapshot.posts,
        'Posts must remain untouched after malformed name type',
      );
    }

    // 7. Verify a valid replacement succeeds with the expected posts and hash.
    const validReplacementRes = await postPayload({
      source_url: sourceUrl,
      source_name: 'Updated Illustrative State Service Commission',
      source_text:
        'Illustrative Valid Engineer: vacancies 15, age 20 to 35. Illustrative Valid Specialist: vacancies 3, age 25 to 40.',
      raw_hash: 'hash-replacement-v2',
      notification_pdf_url: 'https://example.test/notices/v2.pdf',
      posts: [
        {
          post_name: 'Illustrative Valid Engineer',
          vacancies: 15,
          min_age: 20,
          max_age: 35,
        },
        {
          post_name: 'Illustrative Valid Specialist',
          vacancies: 3,
          min_age: 25,
          max_age: 40,
        },
      ],
    });
    assert.equal(validReplacementRes.statusCode, 200);
    const replacementBody = validReplacementRes.json<{ created: number }>();
    assert.equal(replacementBody.created, 2);

    const afterReplacement = await takeSnapshot();
    assert.equal(afterReplacement.source.rawHash, 'hash-replacement-v2');
    assert.equal(
      afterReplacement.source.name,
      'Updated Illustrative State Service Commission',
    );
    assert.equal(afterReplacement.posts.length, 2);

    const engineer = afterReplacement.posts.find(
      (p) => p.postName === 'Illustrative Valid Engineer',
    );
    assert(engineer, 'Expected Illustrative Valid Engineer post to exist');
    assert.equal(engineer.vacancies, 15);
    assert.equal(engineer.minAge, 20);
    assert.equal(engineer.maxAge, 35);

    const specialist = afterReplacement.posts.find(
      (p) => p.postName === 'Illustrative Valid Specialist',
    );
    assert(specialist, 'Expected Illustrative Valid Specialist post to exist');
    assert.equal(specialist.vacancies, 3);
    assert.equal(specialist.minAge, 25);
    assert.equal(specialist.maxAge, 40);

    // 8. Cover mixed named/unnamed input and the existing empty-array behavior.
    // Mixed input: 1 valid named entry + 2 unnamed entries -> accepts valid, skips unnamed.
    const mixedRes = await postPayload({
      source_url: sourceUrl,
      source_name: 'Updated Illustrative State Service Commission',
      raw_hash: 'hash-mixed-v3',
      posts: [
        { post_name: 'Illustrative Sole Valid Post', vacancies: 1 },
        { post_name: null, vacancies: 2 },
        { post_name: '   ', vacancies: 3 },
      ],
    });
    assert.equal(mixedRes.statusCode, 200);
    const mixedBody = mixedRes.json<{ created: number; skipped: string[] }>();
    assert.equal(mixedBody.created, 1);
    assert.equal(mixedBody.skipped.length, 2);

    const afterMixed = await takeSnapshot();
    assert.equal(afterMixed.posts.length, 1);
    assert.equal(afterMixed.posts[0].postName, 'Illustrative Sole Valid Post');
    assert.equal(afterMixed.posts[0].vacancies, 1);
    assert.equal(afterMixed.source.rawHash, 'hash-mixed-v3');

    // Existing empty-array behavior with unchanged hash: skippedAsUnchanged: true, full snapshot preserved.
    const beforeEmptyUnchangedSnapshot = await takeSnapshot();
    const emptyUnchangedRes = await postPayload({
      source_url: sourceUrl,
      source_name: 'Updated Illustrative State Service Commission',
      raw_hash: 'hash-mixed-v3',
      posts: [],
    });
    assert.equal(emptyUnchangedRes.statusCode, 200);
    const unchangedBody = emptyUnchangedRes.json<{
      skippedAsUnchanged?: boolean;
      created: number;
    }>();
    assert.equal(unchangedBody.skippedAsUnchanged, true);
    assert.equal(unchangedBody.created, 0);

    const afterEmptyUnchanged = await takeSnapshot();
    assert.deepEqual(
      afterEmptyUnchanged.source,
      beforeEmptyUnchangedSnapshot.source,
      'Full source snapshot must be identical after unchanged-hash empty send',
    );
    assert.deepEqual(
      afterEmptyUnchanged.posts,
      beforeEmptyUnchangedSnapshot.posts,
      'Complete post snapshot including IDs must be identical after unchanged-hash empty send',
    );

    // Existing empty-array behavior with changed hash: updates source, preserves complete post snapshot including IDs.
    const beforeEmptyChangedPosts = afterEmptyUnchanged.posts;
    const emptyChangedRes = await postPayload({
      source_url: sourceUrl,
      source_name: 'Updated Name After Empty Send',
      raw_hash: 'hash-empty-changed-v4',
      posts: [],
    });
    assert.equal(emptyChangedRes.statusCode, 200);
    const emptyChangedBody = emptyChangedRes.json<{
      skippedAsUnchanged?: boolean;
      created: number;
    }>();
    assert.equal(emptyChangedBody.skippedAsUnchanged, undefined);
    assert.equal(emptyChangedBody.created, 0);

    const afterEmptyChanged = await takeSnapshot();
    assert.equal(afterEmptyChanged.source.rawHash, 'hash-empty-changed-v4');
    assert.equal(
      afterEmptyChanged.source.name,
      'Updated Name After Empty Send',
    );
    assert.deepEqual(
      afterEmptyChanged.posts,
      beforeEmptyChangedPosts,
      'Complete post snapshot including IDs must be preserved when empty posts array is submitted with changed hash',
    );
  },
);
