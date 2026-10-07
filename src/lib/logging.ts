import { randomUUID } from 'node:crypto';
import { LogController } from 'fastify';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';

export const safeLoggingOptions = {
  logger: {
    level: 'info',
    base: { service: 'aptus' },
    // Framework errors can contain credentials in their messages and stack.
    serializers: {
      req: () => ({}),
      res: () => ({}),
      err: () => ({ type: 'Error', message: 'Internal error', stack: '' }),
    },
    redact: {
      paths: ['headers', 'body', 'query', 'params', 'cookie', 'token'],
      remove: true,
    },
  },
  logController: new LogController({ disableRequestLogging: true }),
  requestIdHeader: false,
  genReqId: () => randomUUID(),
} satisfies FastifyServerOptions;

export function registerRequestLogging(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        event: 'request_completed',
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'Request completed',
    );
  });
}

type SecurityEvent =
  | 'session_rejected'
  | 'session_check_failed'
  | 'origin_rejected'
  | 'auth_rejected'
  | 'rate_limit_reached'
  | 'auth_unavailable'
  | 'sign_in_completed'
  | 'sign_out_completed'
  | 'passkey_added'
  | 'passkey_removed';

type SecurityReason =
  | 'session_not_found'
  | 'expired'
  | 'verification_failed'
  | 'origin_mismatch'
  | 'request_rejected'
  | 'too_many_attempts'
  | 'unsafe_redirect'
  | 'provider_rejected'
  | 'completed';

export function logSecurityEvent(
  request: FastifyRequest,
  event: SecurityEvent,
  reason: SecurityReason,
) {
  const details = {
    event,
    reason,
    route: request.routeOptions.url ?? 'unmatched',
  };
  if (reason === 'completed') request.log.info(details, 'Security event');
  else request.log.warn(details, 'Security event');
}
