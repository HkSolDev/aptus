import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppAuth } from '../auth/auth.js';
import { requireSession } from '../auth/require-session.js';
import { logSecurityEvent } from '../lib/logging.js';
import {
  listSavedJobs,
  saveJobForUser,
  deleteSavedJobForUser,
  getSavedJobStatus,
  JOB_ID_REGEX,
} from '../lib/saved-jobs.js';

export function registerSavedJobsRoutes(
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

  // GET /api/saved-jobs?page=1
  app.get<{ Querystring: { page?: string } }>(
    '/api/saved-jobs',
    {
      preHandler: sessionGuard,
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const authUserId = request.authUserId;
      if (!authUserId) {
        return reply.code(401).send({ error: 'Please sign in again.' });
      }

      const rawPage = request.query.page;
      let page = 1;
      if (rawPage !== undefined) {
        if (!/^[1-9]\d*$/.test(rawPage)) {
          return reply.code(400).send({
            error: 'page must be a positive integer between 1 and 10000',
          });
        }
        page = Number(rawPage);
        if (!Number.isSafeInteger(page) || page > 10_000) {
          return reply.code(400).send({
            error: 'page must be a positive integer between 1 and 10000',
          });
        }
      }

      try {
        const result = await listSavedJobs(authUserId, page);
        return reply.code(200).send(result);
      } catch {
        request.log.error(
          { event: 'saved_jobs_list_failed', reason: 'storage_error' },
          'Failed to list saved jobs',
        );
        return reply.code(503).send({
          error: 'Saved jobs are temporarily unavailable. Please try again.',
        });
      }
    },
  );

  // GET /api/saved-jobs/status?ids=id1,id2
  app.get<{ Querystring: { ids?: string } }>(
    '/api/saved-jobs/status',
    {
      preHandler: sessionGuard,
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const authUserId = request.authUserId;
      if (!authUserId) {
        return reply.code(401).send({ error: 'Please sign in again.' });
      }

      const rawIds = request.query.ids;
      if (!rawIds || typeof rawIds !== 'string') {
        return reply.code(200).send({ savedIds: [] });
      }

      const ids = rawIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const result = await getSavedJobStatus(authUserId, ids);
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.error });
      }

      return reply.code(200).send({ savedIds: result.savedIds });
    },
  );

  // PUT /api/saved-jobs/:jobId
  app.put<{ Params: { jobId: string } }>(
    '/api/saved-jobs/:jobId',
    {
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
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const authUserId = request.authUserId;
      if (!authUserId) {
        return reply.code(401).send({ error: 'Please sign in again.' });
      }

      const jobId = request.params.jobId;
      if (!JOB_ID_REGEX.test(jobId)) {
        return reply.code(400).send({ error: 'Invalid job ID' });
      }

      try {
        const result = await saveJobForUser(authUserId, jobId);
        if (!result.ok) {
          return reply.code(result.status).send({ error: result.error });
        }
        return reply.code(200).send({ saved: true, savedAt: result.savedAt });
      } catch {
        request.log.error(
          { event: 'save_job_failed', reason: 'storage_error' },
          'Failed to save job',
        );
        return reply.code(503).send({
          error: 'We could not save this job. Please try again.',
        });
      }
    },
  );

  // DELETE /api/saved-jobs/:jobId
  app.delete<{ Params: { jobId: string } }>(
    '/api/saved-jobs/:jobId',
    {
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
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const authUserId = request.authUserId;
      if (!authUserId) {
        return reply.code(401).send({ error: 'Please sign in again.' });
      }

      const jobId = request.params.jobId;
      if (!JOB_ID_REGEX.test(jobId)) {
        return reply.code(400).send({ error: 'Invalid job ID' });
      }

      try {
        const result = await deleteSavedJobForUser(authUserId, jobId);
        if (!result.ok) {
          return reply.code(result.status).send({ error: result.error });
        }
        return reply.code(200).send({ saved: false });
      } catch {
        request.log.error(
          { event: 'delete_saved_job_failed', reason: 'storage_error' },
          'Failed to remove saved job',
        );
        return reply.code(503).send({
          error: 'We could not remove this saved job. Please try again.',
        });
      }
    },
  );
}
