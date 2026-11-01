import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppAuth } from '../auth/auth.js';
import { requireOperator } from '../auth/require-operator.js';
import { requireIngestToken } from '../auth/require-ingest-token.js';
import { logSecurityEvent } from '../lib/logging.js';
import {
  claimValidationTask,
  getReviewItemDetail,
  getValidationStatus,
  importReviewDraft,
  keepReviewItemHeld,
  listReviewQueue,
  reportValidationFailure,
  requestValidation,
  saveReviewCorrection,
  StaleRevisionError,
  submitValidationResult,
  ReviewDraftValidationError,
} from '../lib/review-drafts.js';

export function registerReviewDraftRoutes(
  app: FastifyInstance,
  auth: AppAuth | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const operatorGuard = auth
    ? requireOperator(auth, env)
    : async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header('cache-control', 'no-store, private');
        return reply.code(503).send({
          error: 'Review operations are temporarily unavailable.',
        });
      };

  const originCheck = async (request: FastifyRequest, reply: FastifyReply) => {
    if (auth && request.headers.origin !== auth.options.baseURL) {
      logSecurityEvent(request, 'origin_rejected', 'origin_mismatch');
      return reply.code(403).header('cache-control', 'no-store, private').send({
        error:
          'This request could not be verified. Refresh Aptus and try again.',
      });
    }
  };

  const internalAuth = requireIngestToken(env);

  // 1. Worker draft import: POST /api/internal/review-drafts
  app.post(
    '/api/internal/review-drafts',
    {
      onRequest: internalAuth,
      schema: { body: { type: 'object' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await importReviewDraft(request.body);
        return reply.code(result.duplicate ? 200 : 201).send({
          item_id: result.itemId,
          bundle_id: result.bundleId,
          revision_id: result.revisionId,
          revision_number: result.revisionNumber,
          canonical_hash: result.canonicalHash,
          duplicate: result.duplicate,
        });
      } catch (error) {
        if (error instanceof ReviewDraftValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error(
          { event: 'draft_import_failed', reason: 'storage_error' },
          'Draft import failed',
        );
        return reply.code(500).send({ error: 'Draft import failed' });
      }
    },
  );

  // 2. Operator status: GET /api/admin/review-drafts/operator-status
  app.get(
    '/api/admin/review-drafts/operator-status',
    { preHandler: operatorGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send({
        is_operator: true,
        email: request.operatorEmail,
        name: request.operatorName,
      });
    },
  );

  // 3. Review queue listing: GET /api/admin/review-drafts
  app.get<{
    Querystring: { status?: string; limit?: string; cursor?: string };
  }>(
    '/api/admin/review-drafts',
    { preHandler: operatorGuard },
    async (request, reply) => {
      const limit = request.query.limit
        ? parseInt(request.query.limit, 10)
        : 20;
      const status = request.query.status;
      const cursor = request.query.cursor;

      try {
        const queue = await listReviewQueue({ status, limit, cursor });
        return reply.code(200).send(queue);
      } catch {
        request.log.error(
          { event: 'queue_read_failed', reason: 'storage_error' },
          'Queue read failed',
        );
        return reply.code(503).send({ error: 'Queue temporarily unavailable' });
      }
    },
  );

  // 4. Candidate detail: GET /api/admin/review-drafts/:id
  app.get<{
    Params: { id: string };
  }>(
    '/api/admin/review-drafts/:id',
    { preHandler: operatorGuard },
    async (request, reply) => {
      try {
        const detail = await getReviewItemDetail(request.params.id);
        if (!detail) {
          return reply.code(404).send({ error: 'Review item not found' });
        }
        reply.header('etag', `W/"${detail.revision.canonical_hash}"`);
        return reply.code(200).send(detail);
      } catch {
        request.log.error(
          { event: 'detail_read_failed', reason: 'storage_error' },
          'Detail read failed',
        );
        return reply.code(503).send({ error: 'Candidate detail unavailable' });
      }
    },
  );

  // 5. Save correction: POST /api/admin/review-drafts/:id/revisions
  app.post<{
    Params: { id: string };
    Body: {
      base_revision_id?: string;
      facts?: Record<string, unknown>;
      change_reason?: string;
    };
  }>(
    '/api/admin/review-drafts/:id/revisions',
    {
      onRequest: originCheck,
      preHandler: operatorGuard,
      schema: { body: { type: 'object' } },
    },
    async (request, reply) => {
      const ifMatch =
        request.headers['if-match']?.replace(/^W\/"|"$/g, '') ||
        request.body.base_revision_id;

      if (!ifMatch) {
        return reply.code(400).send({
          error:
            'If-Match header or base_revision_id required to prevent stale edits',
        });
      }

      if (!request.body.facts || typeof request.body.facts !== 'object') {
        return reply
          .code(400)
          .send({ error: 'Corrected facts object required' });
      }

      if (!request.body.change_reason || !request.body.change_reason.trim()) {
        return reply.code(400).send({
          error: 'A reason for changes is required when saving a correction',
        });
      }

      const operatorEmail = request.operatorEmail || 'unknown_operator';

      try {
        const result = await saveReviewCorrection(request.params.id, {
          baseRevisionId: ifMatch,
          facts: request.body.facts,
          changeReason: request.body.change_reason,
          operatorEmail,
        });

        return reply.code(201).send({
          revision_id: result.revisionId,
          revision_number: result.revisionNumber,
          canonical_hash: result.canonicalHash,
          validation_state: result.validationState,
        });
      } catch (error) {
        if (error instanceof StaleRevisionError) {
          return reply.code(412).send({ error: error.message });
        }
        if (error instanceof ReviewDraftValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error(
          { event: 'revision_save_failed', reason: 'storage_error' },
          'Revision save failed',
        );
        return reply.code(500).send({ error: 'Failed to save correction' });
      }
    },
  );

  // 6. Request validation: POST /api/admin/review-drafts/:id/validate
  app.post<{
    Params: { id: string };
    Body: { revision_id?: string; validator_version?: string };
  }>(
    '/api/admin/review-drafts/:id/validate',
    {
      onRequest: originCheck,
      preHandler: operatorGuard,
      schema: { body: { type: 'object' } },
    },
    async (request, reply) => {
      const revisionId = request.body.revision_id;
      if (!revisionId || typeof revisionId !== 'string') {
        return reply.code(400).send({ error: 'revision_id is required' });
      }

      try {
        const task = await requestValidation(
          request.params.id,
          revisionId,
          request.body.validator_version,
        );

        return reply
          .code(task.reused && task.status === 'completed' ? 200 : 202)
          .send({
            task_id: task.taskId,
            revision_id: task.revisionId,
            status: task.status,
            reused: task.reused,
            result: 'result' in task ? task.result : undefined,
          });
      } catch (error) {
        if (error instanceof ReviewDraftValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        request.log.error(
          { event: 'validation_request_failed', reason: 'storage_error' },
          'Validation request failed',
        );
        return reply.code(500).send({ error: 'Failed to request validation' });
      }
    },
  );

  // 7. Get validation task status: GET /api/admin/review-drafts/:id/validation/:taskId
  app.get<{
    Params: { id: string; taskId: string };
  }>(
    '/api/admin/review-drafts/:id/validation/:taskId',
    { preHandler: operatorGuard },
    async (request, reply) => {
      try {
        const task = await getValidationStatus(request.params.taskId);
        if (!task) {
          return reply.code(404).send({ error: 'Validation task not found' });
        }
        return reply.code(200).send(task);
      } catch {
        return reply
          .code(503)
          .send({ error: 'Task status temporarily unavailable' });
      }
    },
  );

  // 8. Keep held: POST /api/admin/review-drafts/:id/keep-held
  app.post<{
    Params: { id: string };
    Body: { hold_reason?: string };
  }>(
    '/api/admin/review-drafts/:id/keep-held',
    {
      onRequest: originCheck,
      preHandler: operatorGuard,
      schema: { body: { type: 'object' } },
    },
    async (request, reply) => {
      try {
        const result = await keepReviewItemHeld(request.params.id, {
          holdReason: request.body.hold_reason,
        });
        return reply.code(200).send({
          item_id: result.itemId,
          status: result.status,
          hold_reason: result.holdReason,
        });
      } catch (error) {
        if (error instanceof ReviewDraftValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to update item' });
      }
    },
  );

  // 9. Worker claim task: POST /api/internal/review-tasks/claim
  app.post<{
    Body: { worker_id?: string; lease_seconds?: number };
  }>(
    '/api/internal/review-tasks/claim',
    {
      onRequest: internalAuth,
      schema: { body: { type: 'object' } },
    },
    async (request, reply) => {
      try {
        const task = await claimValidationTask({
          workerId: request.body.worker_id,
          leaseSeconds: request.body.lease_seconds,
        });

        if (!task) {
          return reply.code(200).send({ task: null });
        }

        return reply.code(200).send({
          task: {
            task_id: task.taskId,
            revision_id: task.revisionId,
            revision_hash: task.revisionHash,
            bundle_id: task.bundleId,
            facts: task.facts,
            source_evidence: task.sourceEvidence,
            claim_token: task.claimToken,
          },
        });
      } catch {
        return reply.code(500).send({ error: 'Failed to claim task' });
      }
    },
  );

  // 10. Worker submit task result: POST /api/internal/review-tasks/:taskId/result
  app.post<{
    Params: { taskId: string };
    Body: {
      claim_token?: string;
      revision_hash?: string;
      validator_version?: string;
      result?: Record<string, unknown>;
    };
  }>(
    '/api/internal/review-tasks/:taskId/result',
    {
      onRequest: internalAuth,
      schema: { body: { type: 'object' } },
    },
    async (request, reply) => {
      const { claim_token, revision_hash, validator_version, result } =
        request.body;

      if (!claim_token || !revision_hash || !result) {
        return reply.code(400).send({
          error: 'claim_token, revision_hash, and result are required',
        });
      }

      try {
        const response = await submitValidationResult(request.params.taskId, {
          claimToken: claim_token,
          revisionHash: revision_hash,
          validatorVersion: validator_version,
          result,
        });

        return reply.code(200).send(response);
      } catch (error) {
        if (error instanceof ReviewDraftValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to submit result' });
      }
    },
  );

  // 11. Worker report task failure: POST /api/internal/review-tasks/:taskId/fail
  app.post<{
    Params: { taskId: string };
    Body: {
      claim_token?: string;
      error_details?: string;
    };
  }>(
    '/api/internal/review-tasks/:taskId/fail',
    {
      onRequest: internalAuth,
      schema: { body: { type: 'object' } },
    },
    async (request, reply) => {
      const { claim_token, error_details } = request.body;
      if (!claim_token || !error_details) {
        return reply.code(400).send({
          error: 'claim_token and error_details are required',
        });
      }

      try {
        const response = await reportValidationFailure(request.params.taskId, {
          claimToken: claim_token,
          errorDetails: error_details,
        });

        return reply.code(200).send(response);
      } catch (error) {
        if (error instanceof ReviewDraftValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to report failure' });
      }
    },
  );
}
