import 'dotenv/config';
import http from 'node:http';
import { sendJson } from './lib/http.js';
import { servePublicFile } from './lib/static.js';
import { handleMatch } from './routes/match.js';
import { handleExplain } from './routes/explain.js';
import { handleIngest } from './routes/ingest.js';
import { handleJobs } from './routes/jobs.js';
import { renderJob } from './lib/render-job.js';

export const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host || 'localhost'}`,
  );

  const jobPage = url.pathname.match(/^\/jobs\/([a-zA-Z0-9_-]{1,128})$/);
  if (jobPage && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      const { status, html } = await renderJob(jobPage[1]);
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch {
      sendJson(res, 500, { error: 'Could not load the job page' });
    }
    return;
  }
  if (await servePublicFile(req, res, url.pathname, url.searchParams)) return;

  if (url.pathname === '/api/jobs') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method Not Allowed' });
    } else {
      await handleJobs(res, url.searchParams);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/match') {
    await handleMatch(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/explain') {
    await handleExplain(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/internal/ingest') {
    await handleIngest(req, res);
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

const DEFAULT_PORT = Number(process.env.PORT) || 8080;

if (import.meta.url === `file://${process.argv[1]}`) {
  function listen(port: number) {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && !process.env.PORT) {
        listen(port + 1);
      } else {
        console.error(`Failed to start server on port ${port}:`, err.message);
        process.exit(1);
      }
    };

    const onListening = () => {
      server.removeListener('error', onError);
      console.log(`Server listening on http://localhost:${port}`);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  }

  listen(DEFAULT_PORT);
}
