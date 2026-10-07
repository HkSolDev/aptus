import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supportsPasskeys } from '../src/auth/passkeys.js';
import { passkeyFixture, passkeyConfig } from './helpers/passkey-fixture.js';
import { mockGoogle } from './helpers/google-fixture.js';

await test('passkeys require a domain and a secure browser context', () => {
  assert.equal(supportsPasskeys('http://localhost:8080'), true);
  assert.equal(supportsPasskeys('https://aptus.example'), true);
  for (const origin of [
    'http://127.0.0.1:8080',
    'https://127.0.0.1',
    'http://aptus.example',
    'http://[::1]',
  ])
    assert.equal(supportsPasskeys(origin), false);
});

await test(
  'passkey account-management security boundaries',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { app, database, seed, call, origin } = await passkeyFixture(t);
    const owner = await seed('Illustrative Owner');
    const other = await seed('Illustrative Other');
    const key = await database.authPasskey.create({
      data: {
        userId: owner.user.id,
        credentialID: 'fictional-credential',
        publicKey: 'fictional-public-key',
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
        name: 'Illustrative passkey',
      },
    });

    await t.test(
      'credential IDs are unique and missing owners cannot be persisted',
      async () => {
        const fields = { ...key, id: undefined };
        await assert.rejects(
          database.authPasskey.create({
            data: { ...fields, userId: other.user.id },
          }),
          (error) =>
            error instanceof Error && 'code' in error && error.code === 'P2002',
        );
        await assert.rejects(
          database.authPasskey.create({
            data: {
              ...fields,
              userId: 'nonexistent-account',
              credentialID: 'new-fictional-credential',
            },
          }),
          (error) =>
            error instanceof Error && 'code' in error && error.code === 'P2003',
        );
        assert.equal(await database.authPasskey.count(), 1);
      },
    );

    await t.test(
      'registration requires a session, exact origin and bounded inputs',
      async () => {
        assert.equal((await call('generate-register-options')).statusCode, 401);
        for (const forgedOrigin of [undefined, 'https://attacker.example']) {
          const response = await app.inject({
            method: 'POST',
            url: '/api/auth/passkey/delete-passkey',
            headers: {
              cookie: owner.cookie,
              ...(forgedOrigin ? { origin: forgedOrigin } : {}),
            },
            payload: { id: key.id },
          });
          assert.equal(response.statusCode, 403);
        }
        assert.equal(
          (
            await call('generate-register-options', owner.cookie, {
              userId: other.user.id,
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (await call('delete-passkey', owner.cookie, { id: 'x'.repeat(129) }))
            .statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              url: '/api/auth/passkey/generate-register-options',
              headers: { cookie: owner.cookie },
            })
          ).statusCode,
          404,
        );
        assert.equal(await database.authPasskey.count(), 1);
      },
    );

    await t.test(
      'own list hides key material and another account cannot alter credentials',
      async () => {
        const response = await app.inject({
          url: '/api/auth/passkey/list-user-passkeys',
          headers: { cookie: owner.cookie },
        });
        assert.equal(response.statusCode, 200);
        assert.match(String(response.headers['cache-control']), /no-store/);
        const listed: Array<Record<string, unknown>> = response.json();
        assert.deepEqual(Object.keys(listed[0]).sort(), [
          'createdAt',
          'id',
          'name',
        ]);
        for (const operation of ['delete-passkey', 'update-passkey']) {
          const result = await call(operation, other.cookie, {
            id: key.id,
            ...(operation === 'update-passkey' ? { name: 'Changed' } : {}),
          });
          assert.ok(result.statusCode >= 400 && result.statusCode < 500);
        }
        assert.equal(
          (
            await database.authPasskey.findUniqueOrThrow({
              where: { id: key.id },
            })
          ).name,
          key.name,
        );
      },
    );

    await t.test(
      'renewal does not turn an old session into recent proof',
      async () => {
        await database.authSession.update({
          where: { id: owner.session.id },
          data: {
            createdAt: new Date(Date.now() - 6 * 60000),
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
        for (const [operation, payload] of [
          ['generate-register-options', {}],
          ['verify-registration', {}],
          ['delete-passkey', { id: key.id }],
          ['update-passkey', { id: key.id, name: 'Changed' }],
        ] as const) {
          const response = await call(operation, owner.cookie, payload);
          // Malformed verification cannot bypass either validation or recent proof.
          assert.ok(
            response.statusCode === 403 ||
              (operation === 'verify-registration' &&
                response.statusCode === 400),
          );
        }
        assert.equal(await database.authPasskey.count(), 1);
      },
    );

    await t.test(
      'same-account Google reauthentication succeeds but cannot switch accounts',
      async () => {
        const google = mockGoogle(t, passkeyConfig.googleClientId);
        const reauthenticate = async (subject: string, email: string) => {
          google.subject = subject;
          google.email = email;
          const start = await app.inject({
            method: 'POST',
            url: '/api/auth/sign-in/social',
            headers: { cookie: owner.cookie, origin },
            payload: { provider: 'google' },
          });
          assert.equal(start.statusCode, 200);
          const started: { url: string } = start.json();
          const redirect = new URL(started.url);
          google.nonce = redirect.searchParams.get('nonce') ?? '';
          google.challenge = redirect.searchParams.get('code_challenge') ?? '';
          const values = start.headers['set-cookie'];
          const cookies = (Array.isArray(values) ? values : [values]).filter(
            (entry): entry is string => typeof entry === 'string',
          );
          return app.inject({
            url: `/api/auth/callback/google?code=fictional-code&state=${encodeURIComponent(redirect.searchParams.get('state') ?? '')}`,
            headers: {
              cookie: [
                owner.cookie,
                ...cookies.map((entry) => entry.split(';')[0]),
              ].join('; '),
            },
          });
        };
        const before = await database.authSession.count();
        assert.equal(
          (await reauthenticate(other.user.id, other.user.email)).headers
            .location,
          `${origin}/auth/error`,
        );
        assert.equal(await database.authSession.count(), before);
        const success = await reauthenticate(owner.user.id, owner.user.email);
        assert.equal(success.headers.location, `${origin}/`);
        assert.equal(await database.authSession.count(), before + 1);
      },
    );

    await t.test(
      'Google recovery must remain and logout revokes management access',
      async () => {
        await database.authSession.update({
          where: { id: owner.session.id },
          data: { createdAt: new Date() },
        });
        await database.authAccount.deleteMany({
          where: { userId: owner.user.id },
        });
        assert.equal(
          (await call('delete-passkey', owner.cookie, { id: key.id }))
            .statusCode,
          403,
        );
        assert.equal(await database.authPasskey.count(), 1);
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-out',
          headers: { origin, cookie: owner.cookie },
          payload: {},
        });
        assert.equal(
          (await call('generate-register-options', owner.cookie)).statusCode,
          401,
        );
      },
    );
  },
);
