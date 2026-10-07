import type { FastifyInstance } from 'fastify';

export function registerHealthRoute(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string', const: 'ok' } },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
    },
    () => ({ status: 'ok' }),
  );
}
