import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { TestContext } from 'node:test';
import { buildApp } from '../../src/app.js';
import { createAuth } from '../../src/auth/auth.js';
import { authDatabase } from './auth-database.js';

export const passkeyConfig = {
  origin: 'https://aptus.example',
  secret: 'fictional-passkey-test-secret-01234567890123456789',
  googleClientId: 'example.apps.googleusercontent.com',
  googleClientSecret: 'fictional-client-secret',
};

export async function passkeyFixture(t: TestContext, browser = false) {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection) throw new Error('TEST_DATABASE_URL is required.');
  const { database } = await authDatabase(t, connection);
  let origin = passkeyConfig.origin;
  let port = 0;
  if (browser) {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port.');
    port = address.port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    origin = `http://localhost:${port}`;
  }
  const auth = createAuth({ ...passkeyConfig, origin }, database);
  const app = buildApp(auth);
  t.after(() => app.close());
  if (browser) {
    app.get('/passkey-test', (_request, reply) =>
      reply
        .type('text/html')
        .send(
          '<button id="google-sign-in">Sign in with Google</button><p id="auth-error" role="alert" hidden></p>' +
            '<script type="module">import {setupAuth} from "/js/auth.js";setupAuth();</script>',
        ),
    );
    await app.listen({ port, host: '127.0.0.1' });
  }
  const seed = async (name: string) => {
    const user = await database.authUser.create({
      data: {
        name,
        email: `${randomUUID()}@example.invalid`,
        emailVerified: true,
      },
    });
    await database.authAccount.create({
      data: {
        userId: user.id,
        providerId: 'google',
        accountId: user.id,
      },
    });
    const session = await database.authSession.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    // Only illustrative test sessions; production cookies are made by Better Auth.
    const signature = createHmac('sha256', passkeyConfig.secret)
      .update(session.token)
      .digest('base64');
    const nameCookie = origin.startsWith('https:')
      ? '__Secure-aptus.session_token'
      : 'aptus.session_token';
    const value = encodeURIComponent(`${session.token}.${signature}`);
    return {
      user,
      session,
      cookie: `${nameCookie}=${value}`,
      nameCookie,
      value,
    };
  };
  const call = (operation: string, cookie = '', payload: unknown = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/auth/passkey/${operation}`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
  return { app, auth, database, seed, call, origin };
}
