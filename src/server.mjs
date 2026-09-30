#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ReceiptRenderer, RenderError, listPayments, listTemplates } from './renderer.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;

const STATIC_ROUTES = { '/': 'preview.html' };
const STATIC_DIRS = ['templates', 'examples'].map((dir) => path.join(ROOT, dir) + path.sep);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RenderError('request body too large', 'PAYLOAD_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RenderError('request body is not valid JSON', 'INVALID_JSON');
  }
}

async function serveStatic(res, pathname) {
  let relative;
  try {
    relative = STATIC_ROUTES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return sendError(res, 400, 'BAD_PATH', 'malformed path');
  }
  const file = path.resolve(ROOT, relative);
  const allowed = relative === STATIC_ROUTES['/'] || STATIC_DIRS.some((dir) => file.startsWith(dir));
  const type = CONTENT_TYPES[path.extname(file)];
  if (!allowed || !type) return sendError(res, 404, 'NOT_FOUND', 'not found');

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    sendError(res, 404, 'NOT_FOUND', 'not found');
  }
}

export function createServer({ renderer = new ReceiptRenderer() } = {}) {
  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && pathname === '/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && pathname === '/templates') return sendJson(res, 200, await listTemplates());
    if (req.method === 'GET' && pathname === '/payments') return sendJson(res, 200, await listPayments());

    if (req.method === 'POST' && pathname === '/render') {
      const body = await readJson(req);
      const png = await renderer.render(body.template, body.data, { scale: body.scale });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' });
      return res.end(png);
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, pathname);
    sendError(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not supported`);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof RenderError) return sendError(res, err.status, err.code, err.message);
      console.error(err);
      sendError(res, 500, 'INTERNAL', 'failed to render receipt');
    });
  });
}

function main() {
  const port = Number(process.env.PORT ?? 3939);
  const host = process.env.HOST ?? '127.0.0.1';
  const renderer = new ReceiptRenderer({ concurrency: Number(process.env.RENDER_CONCURRENCY ?? 2) });
  const server = createServer({ renderer });

  server.listen(port, host, () => {
    console.log(`receipt service listening on http://${host}:${port}`);
  });

  const shutdown = async () => {
    server.close();
    await renderer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
