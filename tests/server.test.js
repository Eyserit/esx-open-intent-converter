import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server/server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function withServer(options, run) {
  const calls = [];
  const routes = new Map([
    [
      '/api/echo',
      async (body) => {
        calls.push(body);
        return { status: 201, json: { got: body } };
      },
    ],
  ]);
  const server = createAppServer({ root, routes, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run({ port, calls });
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

function send(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolveSend, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { Host: `localhost:${port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolveSend({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('serves the page and its scripts with content types', async () => {
  await withServer({}, async ({ port }) => {
    const page = await send(port, { path: '/' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.text, /<html/i);
    const script = await send(port, { path: '/app.js' });
    assert.equal(script.status, 200);
    assert.equal(script.headers['content-type'], 'text/javascript');
  });
});

test('health answers ok', async () => {
  await withServer({}, async ({ port }) => {
    const res = await send(port, { path: '/api/health' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { ok: true });
  });
});

test('does not serve files outside the allow-list', async () => {
  const paths = [
    '/ekahau_sample.esx',
    '/.git/config',
    '/.venv/pyvenv.cfg',
    '/package.json',
    '/../etc/passwd',
    '/%2e%2e/package.json',
    '/src/../package.json',
  ];
  await withServer({}, async ({ port }) => {
    for (const path of paths) {
      const res = await send(port, { path });
      assert.equal(res.status, 404, path);
    }
  });
});

test('a foreign Host is refused on every path', async () => {
  await withServer({}, async ({ port }) => {
    for (const path of ['/', '/api/health']) {
      const res = await send(port, { path, headers: { Host: `evil.example:${port}` } });
      assert.equal(res.status, 403, path);
      assert.deepEqual(JSON.parse(res.text), { error: 'Forbidden.' });
    }
  });
});

test('a foreign Host is refused on an API POST even with a local Origin', async () => {
  const called = [];
  const routes = new Map([['/api/organizations', async (body) => {
    called.push(body);
    return { status: 200, json: [] };
  }]]);
  await withServer({ routes }, async ({ port }) => {
    const res = await send(port, {
      method: 'POST',
      path: '/api/organizations',
      headers: { Host: `evil.example:${port}`, Origin: `http://localhost:${port}` },
      body: '{}',
    });
    assert.equal(res.status, 403);
    assert.equal(called.length, 0);
  });
});

test('an API POST from another origin is refused', async () => {
  await withServer({}, async ({ port, calls }) => {
    const res = await send(port, {
      method: 'POST',
      path: '/api/echo',
      headers: { Origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });
});

test('a POST without Origin is refused', async () => {
  await withServer({}, async ({ port, calls }) => {
    const res = await send(port, { method: 'POST', path: '/api/echo', body: '{}' });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });
});

test('an oversized body is 413', async () => {
  await withServer({ maxBodyBytes: 10 }, async ({ port, calls }) => {
    const res = await send(port, {
      method: 'POST',
      path: '/api/echo',
      headers: { Origin: `http://localhost:${port}` },
      body: '{"a":"1234567"}',
    });
    assert.equal(res.status, 413);
    assert.deepEqual(JSON.parse(res.text), { error: 'That image is too large to send.' });
    assert.equal(calls.length, 0);
  });
});

test('invalid JSON is 400', async () => {
  await withServer({}, async ({ port, calls }) => {
    const res = await send(port, {
      method: 'POST',
      path: '/api/echo',
      headers: { Origin: `http://127.0.0.1:${port}` },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.text), { error: 'Invalid request.' });
    assert.equal(calls.length, 0);
  });
});

test('routes get the parsed body and their status and json are returned', async () => {
  await withServer({}, async ({ port, calls }) => {
    const res = await send(port, {
      method: 'POST',
      path: '/api/echo',
      headers: { Origin: `http://localhost:${port}` },
      body: '{"name":"Ground"}',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(JSON.parse(res.text), { got: { name: 'Ground' } });
    assert.deepEqual(calls, [{ name: 'Ground' }]);
  });
});

test('prints nothing per request', async () => {
  const printed = [];
  const originals = { write: process.stdout.write, log: console.log, error: console.error };
  // The test runner reports to its parent over this stream as Buffers; the server would write strings.
  process.stdout.write = (...args) => {
    if (typeof args[0] === 'string') printed.push(args);
    return true;
  };
  console.log = (...args) => printed.push(args);
  console.error = (...args) => printed.push(args);
  try {
    await withServer({}, async ({ port }) => {
      await send(port, { path: '/' });
      await send(port, { path: '/api/health' });
      await send(port, { method: 'POST', path: '/api/echo', headers: { Origin: `http://localhost:${port}` }, body: '{}' });
      await send(port, { path: '/missing' });
    });
  } finally {
    process.stdout.write = originals.write;
    console.log = originals.log;
    console.error = originals.error;
  }
  assert.deepEqual(printed, []);
});
