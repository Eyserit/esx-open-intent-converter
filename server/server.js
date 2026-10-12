import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MAX_BODY_BYTES = 140 * 1024 * 1024;

const PAGE_FILES = ['index.html', 'styles.css', 'app.js', 'meraki-flow.js', 'map-place.js'];
const PAGE_DIRS = ['src', 'vendor'];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function allowedHosts(port) {
  return [`localhost:${port}`, `127.0.0.1:${port}`];
}

function sendJson(res, status, json) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(json));
}

// Only the page's own files are served, so nothing else in the repo (samples, .git, .venv) can leak.
function allowedFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = resolve(root, decoded === '/' ? 'index.html' : `.${decoded}`);
  const isPageFile = PAGE_FILES.some((name) => file === resolve(root, name));
  const isInPageDir = PAGE_DIRS.some((dir) => file.startsWith(resolve(root, dir) + sep));
  return isPageFile || isInPageDir ? file : null;
}

async function serveStatic(root, urlPath, res) {
  const file = allowedFile(root, urlPath);
  const type = file && CONTENT_TYPES[extname(file)];
  if (!type) return sendJson(res, 404, { error: 'Not found.' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found.' });
  }
}

// Resolves null as soon as the cap is passed, so an oversized upload is never buffered.
function readBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.pause();
        resolveBody(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createAppServer({ root, routes, maxBodyBytes = MAX_BODY_BYTES }) {
  async function handle(req, res) {
    // Refusing any other Host stops DNS rebinding from making this server answer a hostile site.
    const hosts = allowedHosts(server.address().port);
    if (!hosts.includes(req.headers.host)) return sendJson(res, 403, { error: 'Forbidden.' });
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'POST' && routes.has(pathname)) {
      // Browsers always send Origin on cross-site POSTs, so a missing or foreign one is refused.
      if (!hosts.map((host) => `http://${host}`).includes(req.headers.origin)) {
        return sendJson(res, 403, { error: 'Forbidden.' });
      }
      const text = await readBody(req, maxBodyBytes);
      if (text === null) {
        res.setHeader('Connection', 'close');
        return sendJson(res, 413, { error: 'That image is too large to send.' });
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return sendJson(res, 400, { error: 'Invalid request.' });
      }
      const { status, json } = await routes.get(pathname)(body);
      return sendJson(res, status, json);
    }
    if (req.method === 'GET') return serveStatic(root, pathname, res);
    sendJson(res, 404, { error: 'Not found.' });
  }

  // A dropped connection mid-upload must not crash the process; the error text is never printed.
  const server = createServer((req, res) => handle(req, res).catch(() => res.destroy()));
  return server;
}
