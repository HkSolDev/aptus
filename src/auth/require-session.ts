import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AppAuth } from './auth.js';
import { logSecurityEvent } from '../lib/logging.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUserId?: string;
  }
}

export function requireSession(auth: AppAuth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    request.authUserId = undefined;
    reply.header('cache-control', 'no-store');

    try {
      // Read authoritative storage without renewing or trusting a cached cookie.
      const result = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
        query: { disableCookieCache: true, disableRefresh: true },
      });

      if (!result || result.session.expiresAt.getTime() <= Date.now()) {
        logSecurityEvent(
          request,
          'session_rejected',
          result ? 'expired' : 'session_not_found',
        );
        return reply.code(401).send({ error: 'Please sign in again.' });
      }

      request.authUserId = result.user.id;
    } catch {
      logSecurityEvent(request, 'session_check_failed', 'verification_failed');
      return reply.code(503).send({
        error: 'We could not check your sign-in. Please try again shortly.',
      });
    }
  };
}
