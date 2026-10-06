import Fastify from 'fastify';
import { registerHealthRoute } from './routes/health.js';
import { registerPublicRoutes } from './routes/public.js';
import { handleMatch } from './routes/match.js';
import { handleExplain } from './routes/explain.js';
import { handleIngest } from './routes/ingest.js';

// Build without listening so tests and startup use the same configuration.
export function buildApp() {
  const app = Fastify({
    // Keep request data out of logs until the safe audit-event slice exists.
    logger: false,
    exposeHeadRoutes: false,
    routerOptions: { maxParamLength: 128 },
    trustProxy: false,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'Not Found' });
  });

  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof Error && 'statusCode' in error ? error.statusCode : 500;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: 'Please check your request and try again.' });
    }
    return reply
      .code(500)
      .send({ error: 'Something went wrong. Please try again.' });
  });

  registerHealthRoute(app);
  registerPublicRoutes(app);
  const options = { schema: { body: { type: 'object' } } };
  app.post('/api/match', options, handleMatch);
  app.post('/api/explain', options, handleExplain);
  app.post('/api/internal/ingest', options, handleIngest);
  return app;
}
