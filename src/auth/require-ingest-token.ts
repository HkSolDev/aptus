import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { logSecurityEvent } from '../lib/logging.js';

export function requireIngestToken(env: NodeJS.ProcessEnv) {
  let token = env.INGEST_TOKEN || undefined;
  if (env.INGEST_TOKEN_FILE) {
    if (token !== undefined)
      throw new Error('Configure only one ingestion credential source.');
    try {
      token = readFileSync(env.INGEST_TOKEN_FILE, 'utf8').trim();
    } catch {
      throw new Error('Could not load the ingestion credential file.');
    }
  }
  if (token !== undefined && !/^[A-Za-z0-9_-]{32,512}$/.test(token)) {
    throw new Error(
      'INGEST_TOKEN must contain 32–512 letters, digits, underscores or hyphens.',
    );
  }
  const expected = token ? createHash('sha256').update(token).digest() : null;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    if (!expected) {
      return reply.code(503).send({ error: 'Ingestion is unavailable.' });
    }
    const header = request.headers.authorization;
    const supplied =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : '';
    if (
      !/^[A-Za-z0-9_-]{32,512}$/.test(supplied) ||
      !timingSafeEqual(expected, createHash('sha256').update(supplied).digest())
    ) {
      logSecurityEvent(request, 'auth_rejected', 'request_rejected');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}
