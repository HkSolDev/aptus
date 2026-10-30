import type { FastifyReply } from 'fastify';
import { getPublicJob } from '../lib/public-jobs.js';

export async function handleJobDetail(
  id: string,
  reply: FastifyReply,
  database?: Parameters<typeof getPublicJob>[1],
) {
  reply.header('Cache-Control', 'no-store');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return reply.code(404).send({ error: 'Not Found' });
  }
  try {
    const job = await getPublicJob(id, database);
    if (!job) return reply.code(404).send({ error: 'Not Found' });
    return reply.send(job);
  } catch {
    return reply.code(503).send({
      error: 'Job details are temporarily unavailable. Please try again.',
    });
  }
}
