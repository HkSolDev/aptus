import { passkey } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';
import { isIP } from 'node:net';

export function supportsPasskeys(origin: string) {
  const url = new URL(origin);
  return (
    !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
    (url.protocol === 'https:' || url.hostname === 'localhost')
  );
}

export function passkeyPlugin(origin: string) {
  return passkey({
    rpID: new URL(origin).hostname,
    rpName: 'Aptus',
    origin,
    schema: { passkey: { modelName: 'AuthPasskey' } },
    advanced: { webAuthnChallengeCookie: 'passkey_challenge' },
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    registration: {
      requireSession: true,
      afterVerification: ({ verification }) => {
        // The pinned plugin verifies signatures but makes user verification optional.
        if (!verification.registrationInfo?.userVerified)
          throw new APIError('FORBIDDEN', {
            message: 'Device verification is required.',
          });
        return Promise.resolve();
      },
    },
    authentication: {
      afterVerification: ({ verification }) => {
        if (!verification.authenticationInfo.userVerified)
          throw new APIError('FORBIDDEN', {
            message: 'Device verification is required.',
          });
        return Promise.resolve();
      },
    },
  });
}
