import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppAuth } from '../auth/auth.js';
import { requireSession } from '../auth/require-session.js';
import { logSecurityEvent } from '../lib/logging.js';
import {
  getApplicantProfile,
  saveApplicantProfile,
  validateProfilePayload,
} from '../lib/applicant-profile.js';

export async function handleGetProfile(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.header('cache-control', 'no-store');
  const authUserId = request.authUserId;
  if (!authUserId) {
    return reply.code(401).send({ error: 'Please sign in again.' });
  }

  try {
    const profile = await getApplicantProfile(authUserId);
    return reply.code(200).send({ profile });
  } catch {
    request.log.error(
      { event: 'profile_read_failed', reason: 'storage_error' },
      'Profile read failed',
    );
    return reply.code(503).send({
      error: 'Your profile is temporarily unavailable. Please try again.',
    });
  }
}

export async function handlePutProfile(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.header('cache-control', 'no-store');
  const authUserId = request.authUserId;
  if (!authUserId) {
    return reply.code(401).send({ error: 'Please sign in again.' });
  }

  const validation = validateProfilePayload(request.body);
  if (!validation.ok) {
    return reply.code(400).send({ error: validation.error });
  }

  try {
    const profile = await saveApplicantProfile(authUserId, validation.data);
    return reply.code(200).send({ profile });
  } catch {
    request.log.error(
      { event: 'profile_write_failed', reason: 'storage_error' },
      'Profile write failed',
    );
    return reply.code(503).send({
      error: 'We could not save your profile. Please try again.',
    });
  }
}

export function registerProfileRoutes(
  app: FastifyInstance,
  auth: AppAuth | null,
): void {
  const sessionGuard = auth
    ? requireSession(auth)
    : async (_request: FastifyRequest, reply: FastifyReply) =>
        reply.code(503).send({
          error:
            'Sign-in is temporarily unavailable. Please try again later.',
        });

  app.get(
    '/api/profile',
    {
      preHandler: sessionGuard,
    },
    handleGetProfile,
  );

  app.put(
    '/api/profile',
    {
      schema: { body: { type: 'object' } },
      onRequest: async (request, reply) => {
        if (auth && request.headers.origin !== auth.options.baseURL) {
          logSecurityEvent(request, 'origin_rejected', 'origin_mismatch');
          return reply.code(403).header('cache-control', 'no-store').send({
            error:
              'This request could not be verified. Refresh Aptus and try again.',
          });
        }
      },
      preHandler: sessionGuard,
    },
    handlePutProfile,
  );
}
