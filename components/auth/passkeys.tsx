'use client';

import { useState, useEffect, useCallback } from 'react';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request(operation: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/auth/passkey/${operation}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(15000),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : 'Could not complete the passkey action. Please try again.',
    );
  }
  return result;
}

function descriptors(value: unknown): PublicKeyCredentialDescriptorJSON[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Unsupported passkey options.');
  return value.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.type !== 'public-key'
    )
      throw new Error('Unsupported passkey options.');
    return { id: entry.id, type: 'public-key' };
  });
}

async function ceremony(register: boolean): Promise<void> {
  const options = await request(
    register ? 'generate-register-options' : 'generate-authenticate-options',
    {},
  );
  if (!isRecord(options) || typeof options.challenge !== 'string')
    throw new Error('Could not start the passkey prompt.');

  let credential: Credential | null;
  if (register) {
    const { rp, user, pubKeyCredParams } = options;
    if (
      !isRecord(rp) ||
      typeof rp.id !== 'string' ||
      typeof rp.name !== 'string' ||
      !isRecord(user) ||
      typeof user.id !== 'string' ||
      typeof user.name !== 'string' ||
      typeof user.displayName !== 'string' ||
      !Array.isArray(pubKeyCredParams)
    )
      throw new Error('Could not start the passkey prompt.');

    const algorithms: PublicKeyCredentialParameters[] = pubKeyCredParams.map(
      (parameter: unknown) => {
        if (
          !isRecord(parameter) ||
          parameter.type !== 'public-key' ||
          typeof parameter.alg !== 'number'
        )
          throw new Error('Unsupported passkey options.');
        return { type: 'public-key', alg: parameter.alg };
      },
    );

    credential = await navigator.credentials.create({
      publicKey: PublicKeyCredential.parseCreationOptionsFromJSON({
        challenge: options.challenge,
        rp: { id: rp.id, name: rp.name },
        user: { id: user.id, name: user.name, displayName: user.displayName },
        pubKeyCredParams: algorithms,
        excludeCredentials: descriptors(options.excludeCredentials),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        attestation: 'none',
        timeout: 60000,
      }),
    });
  } else {
    if (typeof options.rpId !== 'string')
      throw new Error('Could not start the passkey prompt.');

    credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON({
        challenge: options.challenge,
        rpId: options.rpId,
        allowCredentials: descriptors(options.allowCredentials),
        userVerification: 'required',
        timeout: 60000,
      }),
    });
  }

  if (!(credential instanceof PublicKeyCredential))
    throw new Error('No passkey was selected.');

  await request(register ? 'verify-registration' : 'verify-authentication', {
    response: credential.toJSON(),
    ...(register ? { name: 'My passkey' } : {}),
  });
}

interface PasskeyItem {
  id: string;
  name?: string;
}

interface PasskeysProps {
  signedIn: boolean;
  onVerifyGoogle: () => void;
  onError: (msg: string) => void;
  onSuccess: () => void;
}

export function Passkeys({
  signedIn,
  onVerifyGoogle,
  onError,
  onSuccess,
}: PasskeysProps) {
  const [enabled, setEnabled] = useState(false);
  const [recent, setRecent] = useState(false);
  const [keys, setKeys] = useState<PasskeyItem[]>([]);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    if (
      typeof window === 'undefined' ||
      typeof PublicKeyCredential === 'undefined' ||
      typeof PublicKeyCredential.parseCreationOptionsFromJSON !== 'function' ||
      typeof PublicKeyCredential.parseRequestOptionsFromJSON !== 'function' ||
      typeof PublicKeyCredential.prototype.toJSON !== 'function'
    ) {
      setEnabled(false);
      return;
    }
    try {
      const status = await request('status');
      if (isRecord(status) && status.enabled === true) {
        setEnabled(true);
        setRecent(status.recent === true);
        if (signedIn) {
          const list = await request('list-user-passkeys');
          if (Array.isArray(list)) {
            setKeys(
              list.filter(
                (k): k is PasskeyItem =>
                  isRecord(k) && typeof k.id === 'string',
              ),
            );
          }
        } else {
          setKeys([]);
        }
      } else {
        setEnabled(false);
      }
    } catch {
      setEnabled(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleAction = async (action: () => Promise<void>) => {
    setBusy(true);
    onError('');
    try {
      await action();
      onSuccess();
      await loadStatus();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        onError(
          'The passkey prompt was cancelled or timed out. Nothing was changed.',
        );
      } else if (
        error instanceof DOMException &&
        error.name === 'InvalidStateError'
      ) {
        onError(
          'This device already has a passkey for Aptus. Try signing in with it, or choose another device.',
        );
      } else {
        onError(
          error instanceof Error
            ? error.message
            : 'Could not complete passkey action.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <section aria-label="Passkeys" className="passkeys-section">
      {!signedIn ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() =>
            handleAction(async () => {
              await ceremony(false);
              window.location.reload();
            })
          }
        >
          Sign in with a passkey
        </button>
      ) : (
        <>
          {recent ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() =>
                handleAction(async () => {
                  await ceremony(true);
                  window.location.reload();
                })
              }
            >
              Add a passkey
            </button>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={onVerifyGoogle}
            >
              Verify with Google to manage passkeys
            </button>
          )}

          {keys.length > 0 && (
            <ul>
              {keys.map((key) => (
                <li key={key.id}>
                  {key.name || 'Passkey'}{' '}
                  {recent && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        handleAction(async () => {
                          if (
                            !window.confirm(
                              'Remove this passkey? You can still sign in with Google.',
                            )
                          )
                            return;
                          await request('delete-passkey', { id: key.id });
                          window.location.reload();
                        })
                      }
                    >
                      Remove passkey
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
