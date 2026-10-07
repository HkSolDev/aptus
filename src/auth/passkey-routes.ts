import { empty, operations } from './passkey-schema.js';
import type { FastifyInstance } from 'fastify';
import type { AppAuth } from './auth.js';
import {
  authFailure,
  authRequest,
  forwardCookies,
  publicSession,
} from './http.js';
import { supportsPasskeys } from './passkeys.js';
import { proofLifetime } from './recent-proof.js';
import { logSecurityEvent } from '../lib/logging.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerPasskeyRoutes(
  app: FastifyInstance,
  auth: AppAuth,
  origin: string,
) {
  app.get(
    '/api/auth/passkey/status',
    { schema: { querystring: empty } },
    async (request, reply) => {
      const enabled = supportsPasskeys(origin);
      if (!enabled) return reply.send({ enabled, recent: false });
      try {
        // Use the HTTP handler so status checks share the normal session-read rate budget.
        const response = await auth.handler(
          new Request(
            `${origin}/api/auth/get-session?disableCookieCache=true&disableRefresh=true`,
            { headers: authRequest(request, origin).headers },
          ),
        );
        if (!response.ok) {
          const retry =
            response.headers.get('retry-after') ??
            response.headers.get('x-retry-after');
          if (retry) reply.header('retry-after', retry);
          return authFailure(
            reply,
            response.status >= 500 ? 503 : response.status,
          );
        }
        const value: unknown = await response.json();
        const session =
          isRecord(value) && isRecord(value.session) ? value.session : null;
        const createdAt =
          session && typeof session.createdAt === 'string'
            ? Date.parse(session.createdAt)
            : NaN;
        return reply.send({
          enabled,
          recent:
            Number.isFinite(createdAt) &&
            Date.now() - createdAt < proofLifetime * 1000,
        });
      } catch {
        return authFailure(reply, 503);
      }
    },
  );
  if (!supportsPasskeys(origin)) return;

  for (const [operation, method, body] of operations) {
    app.route({
      method: operation === 'list-user-passkeys' ? 'GET' : 'POST',
      url: `/api/auth/passkey/${operation}`,
      bodyLimit: 32_768,
      schema: {
        querystring: empty,
        ...(operation === 'list-user-passkeys' ? {} : { body }),
      },
      handler: async (request, reply) => {
        try {
          const input = authRequest(
            request,
            origin,
            method === 'POST' ? request.body : undefined,
          );
          const response = await auth.handler(
            method === 'GET'
              ? new Request(input.url, { method, headers: input.headers })
              : input,
          );
          if (!response.ok) {
            logSecurityEvent(
              request,
              response.status === 429 ? 'rate_limit_reached' : 'auth_rejected',
              response.status === 429
                ? 'too_many_attempts'
                : 'verification_failed',
            );
            const retry =
              response.headers.get('retry-after') ??
              response.headers.get('x-retry-after');
            if (retry) reply.header('retry-after', retry);
            return response.status === 403
              ? reply.code(403).send({
                  error:
                    'Please verify your account again, then try the passkey action.',
                })
              : authFailure(
                  reply,
                  response.status >= 500 ? 503 : response.status,
                );
          }
          const value: unknown = await response.json();
          forwardCookies(response, reply);
          if (operation === 'verify-authentication') {
            const session = publicSession(value);
            if (!session) return authFailure(reply, 401);
            logSecurityEvent(request, 'sign_in_completed', 'completed');
            return reply.send(session);
          }
          if (operation === 'list-user-passkeys') {
            if (!Array.isArray(value)) return authFailure(reply, 503);
            return reply.send(
              value.filter(isRecord).map((key) => ({
                id: key.id,
                name: key.name ?? 'Passkey',
                createdAt: key.createdAt,
              })),
            );
          }
          if (!isRecord(value)) return authFailure(reply, 503);
          if (operation === 'verify-registration') {
            logSecurityEvent(request, 'passkey_added', 'completed');
            return reply.send({ id: value.id, name: value.name ?? 'Passkey' });
          }
          if (operation === 'update-passkey') {
            if (!isRecord(value.passkey)) return authFailure(reply, 503);
            return reply.send({
              id: value.passkey.id,
              name: value.passkey.name ?? 'Passkey',
            });
          }
          if (operation === 'delete-passkey')
            logSecurityEvent(request, 'passkey_removed', 'completed');
          if (operation === 'generate-authenticate-options')
            value.userVerification = 'required';
          return reply.send(value);
        } catch {
          logSecurityEvent(request, 'auth_unavailable', 'verification_failed');
          return authFailure(reply, 503);
        }
      },
    });
  }
}
