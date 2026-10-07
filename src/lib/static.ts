import type { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs/promises';
import { sendJson } from './http.js';
import { renderHome } from './render-home.js';

export async function servePublicFile(
  req: FastifyRequest,
  res: FastifyReply,
  pathname: string,
  params = new URLSearchParams(),
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  // Only serve our HTML entry and named CSS/JS assets, never arbitrary project files.
  const asset = pathname.match(/^\/(css|js)\/([a-z0-9-]+)\.(css|js)$/);
  if (pathname !== '/' && (!asset || asset[1] !== asset[3])) return false;
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  const contentType =
    pathname === '/'
      ? 'text/html'
      : asset?.[3] === 'css'
        ? 'text/css'
        : 'text/javascript';
  try {
    const content =
      pathname === '/'
        ? await renderHome(params)
        : await fs.readFile(
            new URL(`../../public/${filename}`, import.meta.url),
          );
    res.code(200).headers({
      'Content-Type': `${contentType}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.send(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const missing =
      error instanceof Error && 'code' in error && error.code === 'ENOENT';
    sendJson(res, missing ? 404 : 500, {
      error: missing ? 'File not found' : 'Could not serve this file',
    });
  }
  return true;
}
