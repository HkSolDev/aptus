import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import type { TestContext } from 'node:test';

// Simulated Google HTTP responses, not a live-provider test. Real library crypto still verifies each JWT.
export function mockGoogle(t: TestContext, clientId: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'fictional-test-key',
    alg: 'RS256',
    use: 'sig',
  };
  const state = {
    nonce: '',
    challenge: '',
    subject: 'fictional-google-subject',
    email: 'example@example.invalid',
    invalidNonce: false,
    invalidAudience: false,
    invalidIssuer: false,
    expiredToken: false,
    invalidSignature: false,
  };
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json' },
    });
  const idToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({
      iss: state.invalidIssuer
        ? 'https://attacker.example'
        : 'https://accounts.google.com',
      aud: state.invalidAudience ? 'different-app' : clientId,
      sub: state.subject,
      email: state.email,
      email_verified: true,
      name: 'Example Learner',
      iat: now,
      exp: state.expiredToken ? now - 600 : now + 600,
      nonce: state.invalidNonce ? 'other-attempt' : state.nonce,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(privateKey, 'base64url');
    return `${unsigned}.${state.invalidSignature ? `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}` : signature}`;
  };
  t.mock.method(
    globalThis,
    'fetch',
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (
        url === 'https://accounts.google.com/.well-known/openid-configuration'
      )
        return Promise.resolve(
          json({
            issuer: 'https://accounts.google.com',
            authorization_endpoint:
              'https://accounts.google.com/o/oauth2/v2/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
            id_token_signing_alg_values_supported: ['RS256'],
          }),
        );
      if (url === 'https://www.googleapis.com/oauth2/v3/certs')
        return Promise.resolve(json({ keys: [jwk] }));
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = init?.body;
        const params = new URLSearchParams(
          typeof body === 'string' || body instanceof URLSearchParams
            ? body
            : '',
        );
        const verifier = params.get('code_verifier');
        if (
          !verifier ||
          createHash('sha256').update(verifier).digest('base64url') !==
            state.challenge ||
          params.get('code') !== 'fictional-code' ||
          params.get('grant_type') !== 'authorization_code' ||
          params.get('redirect_uri') !==
            'https://aptus.example/api/auth/callback/google' ||
          params.get('client_id') !== clientId
        ) {
          throw new Error('Invalid code exchange in Google fixture.');
        }
        return Promise.resolve(
          json({
            access_token: 'fictional-access-token',
            refresh_token: 'fictional-refresh-token',
            id_token: idToken(),
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid email profile',
          }),
        );
      }
      throw new Error('Unexpected upstream call in Google fixture.');
    },
  );
  return state;
}
