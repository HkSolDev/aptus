import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';

export function authRequest(
  request: FastifyRequest,
  origin: string,
  body?: unknown,
) {
  const headers = fromNodeHeaders(request.headers);
  // Rate limiting uses Fastify's peer IP, never a caller's forwarded-IP claim.
  headers.set('x-aptus-peer-ip', request.ip);
  for (const name of [
    'host',
    'forwarded',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-for',
    'content-length',
  ])
    headers.delete(name);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${origin}${request.url}`, {
    method: request.method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export function forwardCookies(response: Response, reply: FastifyReply) {
  const cookies = response.headers.getSetCookie();
  if (cookies.length) reply.header('set-cookie', cookies);
  reply.header('cache-control', 'no-store');
  reply.header('referrer-policy', 'no-referrer');
}

export function authFailure(reply: FastifyReply, status: number) {
  const error =
    status === 403
      ? 'This request could not be verified. Refresh Aptus and try again.'
      : status === 429
        ? 'Too many attempts. Please wait before trying again.'
        : status >= 500
          ? 'Sign-in is temporarily unavailable. Please try again shortly.'
          : 'Please sign in again to continue.';
  return reply.code(status).send({ error });
}

export function publicSession(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('user' in value) ||
    !('session' in value)
  )
    return null;
  const { user, session } = value;
  if (
    !user ||
    typeof user !== 'object' ||
    !('id' in user) ||
    typeof user.id !== 'string' ||
    !session ||
    typeof session !== 'object' ||
    !('expiresAt' in session) ||
    typeof session.expiresAt !== 'string'
  ) {
    throw new Error('Unexpected session response.');
  }
  // Never put the bearer session token or provider credentials in JSON.
  return {
    user: {
      id: user.id,
      name: 'name' in user && typeof user.name === 'string' ? user.name : '',
    },
    expiresAt: session.expiresAt,
    needsRefresh: 'needsRefresh' in value && value.needsRefresh === true,
  };
}
