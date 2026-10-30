import type { FastifyInstance } from 'fastify';
import { servePublicFile } from '../lib/static.js';
import { renderJob } from '../lib/render-job.js';
import { handleJobs } from './jobs.js';
import { handleJobDetail } from './job-detail.js';

export function registerPublicRoutes(
  app: FastifyInstance,
  database?: Parameters<typeof handleJobs>[2],
) {
  app.all<{ Params: { id: string } }>('/api/jobs/:id', {
    onRequest: async (request, reply) => {
      if (request.method !== 'GET') {
        return reply
          .header('Allow', 'GET')
          .code(405)
          .send({ error: 'Method Not Allowed' });
      }
    },
    handler: (request, reply) => handleJobDetail(request.params.id, reply, database),
  });

  app.all('/api/jobs', {
    onRequest: async (request, reply) => {
      if (request.method !== 'GET') {
        return reply
          .header('Allow', 'GET')
          .code(405)
          .send({ error: 'Method Not Allowed' });
      }
    },
    handler: async (request, reply) => {
      const url = new URL(request.url, 'http://localhost');
      await handleJobs(reply, url.searchParams, database);
    },
  });

  app.route<{ Params: { id: string } }>({
    method: ['GET', 'HEAD'],
    url: '/jobs/:id',
    handler: async (request, reply) => {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.params.id)) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      const { status, html } = await renderJob(request.params.id);
      return reply
        .code(status)
        .headers({
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
        })
        .send(request.method === 'HEAD' ? undefined : html);
    },
  });

  for (const path of ['/', '/css/:filename', '/js/:filename']) {
    app.route({
      method: ['GET', 'HEAD'],
      url: path,
      handler: async (request, reply) => {
        const url = new URL(request.url, 'http://localhost');
        if (
          !(await servePublicFile(
            request,
            reply,
            url.pathname,
            url.searchParams,
          ))
        ) {
          return reply.code(404).send({ error: 'Not Found' });
        }
      },
    });
  }
}
