import type { FastifyInstance } from 'fastify';
import type { AppAuth } from './auth.js';
import { logSecurityEvent } from '../lib/logging.js';
import { registerPasskeyRoutes } from './passkey-routes.js';
import {
  authFailure,
  authRequest,
  forwardCookies,
  publicSession,
} from './http.js';

export function registerAuthRoutes(app: FastifyInstance, auth: AppAuth) {
  const origin = auth.options.baseURL;
  if (typeof origin !== 'string')
    throw new Error('Auth requires a fixed canonical origin.');
  const empty = { type: 'object', additionalProperties: false, properties: {} };
  const noQuery = { querystring: empty };
  const post = { bodyLimit: 4096, schema: { ...noQuery, body: empty } };

  // Exact route allowlist: library credential/link/token endpoints stay unavailable.
  app.register((scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (request.method === 'POST' && request.headers.origin !== origin) {
        logSecurityEvent(request, 'origin_rejected', 'origin_mismatch');
        return authFailure(reply, 403);
      }
    });
    registerPasskeyRoutes(scope, auth, origin);
    const handle = async (
      request: Parameters<typeof authRequest>[0],
      reply: Parameters<typeof forwardCookies>[1],
    ) => {
      const body = request.url.startsWith('/api/auth/sign-in/social')
        ? {
            provider: 'google',
            callbackURL: `${origin}/`,
            errorCallbackURL: `${origin}/auth/error`,
          }
        : request.body;
      try {
        const response = await auth.handler(authRequest(request, origin, body));
        if (!response.ok && response.status !== 302) {
          logSecurityEvent(
            request,
            response.status === 429
              ? 'rate_limit_reached'
              : response.status >= 500
                ? 'auth_unavailable'
                : 'auth_rejected',
            response.status === 429 ? 'too_many_attempts' : 'request_rejected',
          );
          const retryAfter =
            response.headers.get('retry-after') ??
            response.headers.get('x-retry-after');
          if (retryAfter) reply.header('retry-after', retryAfter);
          if (
            request.routeOptions.url === '/api/auth/callback/google' &&
            response.status !== 429
          )
            return reply.redirect(`${origin}/auth/error`);
          return authFailure(
            reply,
            response.status >= 500 ? 503 : response.status,
          );
        }
        forwardCookies(response, reply);
        const location = response.headers.get('location');
        if (location) {
          const target = new URL(location, origin);
          if (target.origin === origin && target.pathname === '/auth/error') {
            logSecurityEvent(request, 'auth_rejected', 'provider_rejected');
            return reply.redirect(`${origin}/auth/error`);
          }
          if (
            target.href !== `${origin}/` &&
            !(
              request.url === '/api/auth/sign-in/social' &&
              target.origin === 'https://accounts.google.com'
            )
          ) {
            logSecurityEvent(request, 'auth_rejected', 'unsafe_redirect');
            return authFailure(reply, 400);
          }
          reply.header('location', target.href);
          if (request.routeOptions.url === '/api/auth/callback/google')
            logSecurityEvent(request, 'sign_in_completed', 'completed');
        }
        if (request.url.startsWith('/api/auth/get-session')) {
          const value: unknown = await response.json();
          const session = publicSession(value);
          if (!session)
            logSecurityEvent(request, 'session_rejected', 'session_not_found');
          return session ? reply.send(session) : authFailure(reply, 401);
        }
        if (request.routeOptions.url === '/api/auth/sign-out')
          logSecurityEvent(request, 'sign_out_completed', 'completed');
        return reply
          .code(response.status)
          .type('application/json')
          .send(await response.text());
      } catch {
        logSecurityEvent(request, 'auth_unavailable', 'verification_failed');
        if (request.url.startsWith('/api/auth/callback/google'))
          return reply.redirect(`${origin}/auth/error`);
        return authFailure(reply, 503);
      }
    };
    scope.post(
      '/api/auth/sign-in/social',
      {
        ...post,
        schema: {
          ...noQuery,
          body: {
            ...empty,
            required: ['provider'],
            properties: { provider: { type: 'string', const: 'google' } },
          },
        },
      },
      handle,
    );
    scope.get('/api/auth/get-session', { schema: noQuery }, handle);
    scope.post('/api/auth/get-session', post, handle);
    scope.post('/api/auth/sign-out', post, handle);
    scope.get(
      '/api/auth/callback/google',
      {
        schema: {
          querystring: {
            ...empty,
            properties: Object.fromEntries(
              [
                'code',
                'state',
                'error',
                'error_description',
                'iss',
                'scope',
                'authuser',
                'prompt',
              ].map((key) => [key, { type: 'string', maxLength: 4096 }]),
            ),
          },
        },
      },
      handle,
    );
    scope.get('/auth/error', (_request, reply) =>
      reply.code(400).send({
        error:
          'Sign-in could not be completed or the attempt expired. Please start again from Aptus.',
      }),
    );
  });
}
