import type { FastifyReply } from 'fastify';

export function sendJson(
  res: FastifyReply,
  statusCode: number,
  data: unknown,
): void {
  res.code(statusCode).send(data);
}
