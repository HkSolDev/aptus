import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchProfile, saveProfileApi } from '../frontend/profile-api.js';
import {
  fetchSavedJobs,
  fetchSavedStatus,
  saveJobApi,
  unsaveJobApi,
} from '../frontend/saved-jobs-api.js';

function mockFetch(status: number, body: unknown) {
  const jsonStr = typeof body === 'string' ? body : JSON.stringify(body);
  return async () =>
    new Response(jsonStr, {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

test('fetchProfile rejects malformed success envelopes and wrong types', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const malformedPayloads = [
    {}, // missing profile key
    { profile: 'not-an-object' },
    { profile: 12345 },
    { profile: { dob: 'not-a-date' } },
    { profile: { dob: '2000-01-01', category: 'InvalidCategory', educations: [] } },
    {
      profile: {
        dob: '2000-01-01',
        category: null,
        educations: [{ level: 'INVALID_LEVEL', marksPercent: null }],
      },
    },
    {
      profile: {
        dob: '2000-01-01',
        category: null,
        educations: [{ level: 'TENTH', marksPercent: 150 }],
      },
    },
    {
      profile: {
        dob: '2000-01-01',
        category: null,
        educations: [{ level: 'TENTH', marksPercent: '80' }],
      },
    },
  ];

  for (const payload of malformedPayloads) {
    globalThis.fetch = mockFetch(200, payload);
    await assert.rejects(
      () => fetchProfile(),
      /Aptus returned an (unexpected|invalid)/,
      `Should reject malformed payload: ${JSON.stringify(payload)}`,
    );
  }
});

test('fetchProfile preserves legitimate null and valid profile responses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Legitimate null (user has no saved profile yet)
  globalThis.fetch = mockFetch(200, { profile: null });
  const nullProfile = await fetchProfile();
  assert.equal(nullProfile, null);

  // Valid profile with null category and null marksPercent
  const validProfile = {
    dob: '2000-02-29',
    category: null,
    educations: [{ level: 'BACHELORS' as const, marksPercent: null }],
  };
  globalThis.fetch = mockFetch(200, { profile: validProfile });
  const loadedProfile = await fetchProfile();
  assert.deepEqual(loadedProfile, validProfile);

  // Valid profile with category and marksPercent
  const validProfileWithMarks = {
    dob: '1998-05-15',
    category: 'OBC',
    educations: [
      { level: 'TWELFTH' as const, marksPercent: 88.5 },
      { level: 'BACHELORS' as const, marksPercent: 74.2 },
    ],
  };
  globalThis.fetch = mockFetch(200, { profile: validProfileWithMarks });
  const loadedWithMarks = await fetchProfile();
  assert.deepEqual(loadedWithMarks, validProfileWithMarks);
});

test('saveProfileApi rejects malformed success envelopes and null profile', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const payload = {
    dob: '2000-01-01',
    category: null,
    educations: [{ level: 'TENTH' as const, marksPercent: null }],
  };

  // Malformed {}
  globalThis.fetch = mockFetch(200, {});
  await assert.rejects(
    () => saveProfileApi(payload),
    /Aptus returned an unexpected response/,
  );

  // Malformed null profile on save
  globalThis.fetch = mockFetch(200, { profile: null });
  await assert.rejects(
    () => saveProfileApi(payload),
    /Aptus returned an unexpected response/,
  );

  // Malformed invalid education
  globalThis.fetch = mockFetch(200, {
    profile: { dob: '2000-01-01', category: null, educations: 'invalid' },
  });
  await assert.rejects(
    () => saveProfileApi(payload),
    /Aptus returned an (unexpected|invalid)/,
  );

  // Valid save response
  globalThis.fetch = mockFetch(200, { profile: payload });
  const saved = await saveProfileApi(payload);
  assert.deepEqual(saved, payload);
});

test('fetchSavedJobs rejects malformed success envelopes, wrong types and missing keys', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const malformedPayloads = [
    {}, // missing data and pagination
    { data: null, pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } },
    { data: [] }, // missing pagination
    { pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }, // missing data
    {
      data: [{ id: 'job-1' }], // missing required fields on item
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    },
    {
      data: [
        {
          id: 'job-1',
          postName: 'Post 1',
          educationRequired: 12345, // wrong type (number instead of string | null)
          vacancies: 1,
          applicationLastDate: null,
          source: { name: 'SSC' },
          savedAt: '2026-10-25T00:00:00Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    },
    {
      data: [],
      pagination: { page: '1', pageSize: 20, totalItems: 0, totalPages: 0 }, // string page
    },
  ];

  for (const payload of malformedPayloads) {
    globalThis.fetch = mockFetch(200, payload);
    await assert.rejects(
      () => fetchSavedJobs(1),
      /Aptus returned (an )?(unexpected|invalid)/,
      `Should reject malformed payload: ${JSON.stringify(payload)}`,
    );
  }
});

test('fetchSavedJobs preserves valid list envelopes including educationRequired:null', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Valid empty list
  const emptyResponse = {
    data: [],
    pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  };
  globalThis.fetch = mockFetch(200, emptyResponse);
  const emptyResult = await fetchSavedJobs(1);
  assert.deepEqual(emptyResult, emptyResponse);

  // Valid list with educationRequired: null
  const nullEducationResponse = {
    data: [
      {
        id: 'job-null-edu',
        postName: 'Field Officer',
        organization: 'DRDO',
        vacancies: 5,
        applicationLastDate: '2026-11-15T00:00:00Z',
        educationRequired: null,
        payLevel: 'Level 7',
        source: { name: 'DRDO' },
        savedAt: '2026-10-26T10:00:00Z',
      },
    ],
    pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  };
  globalThis.fetch = mockFetch(200, nullEducationResponse);
  const nullResult = await fetchSavedJobs(1);
  assert.equal(nullResult.data[0].educationRequired, null);
  assert.equal(nullResult.data[0].id, 'job-null-edu');

  // Valid list with string educationRequired
  const stringEducationResponse = {
    data: [
      {
        id: 'job-string-edu',
        postName: 'Junior Engineer',
        organization: 'SSC',
        vacancies: 100,
        applicationLastDate: null,
        educationRequired: 'Diploma in Civil Engineering',
        source: { name: 'SSC' },
        savedAt: '2026-10-26T12:00:00Z',
      },
    ],
    pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  };
  globalThis.fetch = mockFetch(200, stringEducationResponse);
  const stringResult = await fetchSavedJobs(1);
  assert.equal(stringResult.data[0].educationRequired, 'Diploma in Civil Engineering');
});

test('fetchSavedStatus validates item types and rejects malformed envelopes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Empty list returns immediately without network request
  assert.deepEqual(await fetchSavedStatus([]), []);

  // Malformed {}
  globalThis.fetch = mockFetch(200, {});
  await assert.rejects(
    () => fetchSavedStatus(['job-1']),
    /Couldn’t check saved jobs/,
  );

  // Malformed { savedIds: null }
  globalThis.fetch = mockFetch(200, { savedIds: null });
  await assert.rejects(
    () => fetchSavedStatus(['job-1']),
    /Couldn’t check saved jobs/,
  );

  // Malformed { savedIds: [123] } (wrong item type)
  globalThis.fetch = mockFetch(200, { savedIds: [123] });
  await assert.rejects(
    () => fetchSavedStatus(['job-1']),
    /Couldn’t check saved jobs/,
  );

  // Malformed { savedIds: ['job-1', null] }
  globalThis.fetch = mockFetch(200, { savedIds: ['job-1', null] });
  await assert.rejects(
    () => fetchSavedStatus(['job-1']),
    /Couldn’t check saved jobs/,
  );

  // Valid string[]
  globalThis.fetch = mockFetch(200, { savedIds: ['job-1', 'job-2'] });
  assert.deepEqual(await fetchSavedStatus(['job-1', 'job-2']), ['job-1', 'job-2']);
});

test('saveJobApi and unsaveJobApi reject malformed envelopes without silently defaulting', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // saveJobApi on HTTP 200 {} must reject, NOT return false
  globalThis.fetch = mockFetch(200, {});
  await assert.rejects(
    () => saveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // saveJobApi on { saved: false } must reject
  globalThis.fetch = mockFetch(200, { saved: false });
  await assert.rejects(
    () => saveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // saveJobApi on { saved: 'true' } must reject (wrong type)
  globalThis.fetch = mockFetch(200, { saved: 'true' });
  await assert.rejects(
    () => saveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // saveJobApi on { saved: true, savedAt: 12345 } must reject (wrong type for savedAt)
  globalThis.fetch = mockFetch(200, { saved: true, savedAt: 12345 });
  await assert.rejects(
    () => saveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // saveJobApi on valid response returns true
  globalThis.fetch = mockFetch(200, { saved: true, savedAt: '2026-10-27T00:00:00Z' });
  assert.equal(await saveJobApi('fixture'), true);

  // unsaveJobApi on HTTP 200 {} must reject, NOT silently return false
  globalThis.fetch = mockFetch(200, {});
  await assert.rejects(
    () => unsaveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // unsaveJobApi on { saved: true } must reject
  globalThis.fetch = mockFetch(200, { saved: true });
  await assert.rejects(
    () => unsaveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // unsaveJobApi on { saved: 'false' } must reject (wrong type)
  globalThis.fetch = mockFetch(200, { saved: 'false' });
  await assert.rejects(
    () => unsaveJobApi('fixture'),
    /Aptus returned an unexpected response/,
  );

  // unsaveJobApi on valid response returns false
  globalThis.fetch = mockFetch(200, { saved: false });
  assert.equal(await unsaveJobApi('fixture'), false);
});
