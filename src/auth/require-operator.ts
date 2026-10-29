import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AppAuth } from './auth.js';
import { logSecurityEvent } from '../lib/logging.js';

declare module 'fastify' {
  interface FastifyRequest {
    operatorEmail?: string;
    operatorName?: string;
  }
}

export function parseOperatorAllowlist(envValue?: string): Set<string> {
  if (!envValue || !envValue.trim()) return new Set();
  return new Set(
    envValue
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

export function isOperatorEmail(
  email: string | undefined | null,
  verified: boolean | undefined | null,
  allowlistEnv = process.env.APTUS_REVIEW_OPERATOR_EMAILS,
): boolean {
  if (!email || !verified) return false;
  const allowlist = parseOperatorAllowlist(allowlistEnv);
  return allowlist.has(email.trim().toLowerCase());
}

export function requireOperator(
  auth: AppAuth,
  env: NodeJS.ProcessEnv = process.env,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    request.authUserId = undefined;
    request.operatorEmail = undefined;
    request.operatorName = undefined;
    reply.header('cache-control', 'no-store, private');
    reply.header('pragma', 'no-cache');

    const allowlist = parseOperatorAllowlist(env.APTUS_REVIEW_OPERATOR_EMAILS);
    if (allowlist.size === 0) {
      logSecurityEvent(
        request,
        'auth_rejected',
        'request_rejected',
      );
      return reply.code(403).send({
        error: 'Review operator access is not configured on this server.',
      });
    }

    try {
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

      const user = result.user;
      if (!user.emailVerified) {
        logSecurityEvent(
          request,
          'auth_rejected',
          'request_rejected',
        );
        return reply.code(403).send({
          error: 'Your email address must be verified to access job review.',
        });
      }

      const normalizedEmail = user.email.trim().toLowerCase();
      if (!allowlist.has(normalizedEmail)) {
        logSecurityEvent(
          request,
          'auth_rejected',
          'request_rejected',
        );
        return reply.code(403).send({
          error: 'You are not authorized to access the job review queue.',
        });
      }

      request.authUserId = user.id;
      request.operatorEmail = user.email;
      request.operatorName = user.name;
    } catch {
      logSecurityEvent(request, 'session_check_failed', 'verification_failed');
      return reply.code(503).send({
        error: 'We could not verify your sign-in. Please try again shortly.',
      });
    }
  };
}
