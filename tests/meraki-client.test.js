import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS } from '../src/meraki-regions.js';
import { createMerakiClient } from '../server/meraki-client.js';

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  async function fetch(url, init) {
    calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = {}, headers = {} } = next;
    return new Response(JSON.stringify(body), { status, headers });
  }
  return { fetch, calls };
}

function setup(responses) {
  const { fetch, calls } = fakeFetch(responses);
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  const client = createMerakiClient({ fetch, sleep });
  return { client, calls, sleeps };
}

test('each region calls its own host with a Bearer key', async () => {
  for (const [region, { host }] of Object.entries(REGIONS)) {
    const { client, calls } = setup([{ body: [] }]);
    await client._request({ region, apiKey: 'k123' }, 'GET', '/organizations');
    assert.equal(calls[0].url, `https://${host}/api/v1/organizations`);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer k123');
  }
});

test('an unknown region is rejected before any request', async () => {
  const { client, calls } = setup([]);
  await assert.rejects(
    client._request({ region: 'mars', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 400 && err.message === 'Unknown Meraki region.',
  );
  assert.equal(calls.length, 0);
});

test('401 says the key was not accepted, naming the region', async () => {
  const { client } = setup([{ status: 401 }]);
  await assert.rejects(
    client._request({ region: 'canada', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 401 && err.message === "That API key wasn't accepted by Meraki (Canada).",
  );
});

test('429 waits for Retry-After then succeeds', async () => {
  const { client, calls, sleeps } = setup([
    { status: 429, headers: { 'Retry-After': '2' } },
    { body: [{ id: '1' }] },
  ]);
  const { json } = await client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations');
  assert.deepEqual(sleeps, [2000]);
  assert.equal(calls.length, 2);
  assert.deepEqual(json, [{ id: '1' }]);
});

test('429 without Retry-After waits 1 second', async () => {
  const { client, sleeps } = setup([{ status: 429 }, { body: [] }]);
  await client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations');
  assert.deepEqual(sleeps, [1000]);
});

test('a huge Retry-After is capped at 60 seconds', async () => {
  const { client, sleeps } = setup([{ status: 429, headers: { 'Retry-After': '3600' } }, { body: [] }]);
  await client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations');
  assert.deepEqual(sleeps, [60000]);
});

test('gives up after 3 retries with the rate-limit message', async () => {
  const { client, calls, sleeps } = setup([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) =>
      err.status === 429 && err.message === 'Meraki is rate-limiting requests — try again in a minute.',
  );
  assert.equal(sleeps.length, 3);
  assert.equal(calls.length, 4);
});

test('other errors are not retried', async () => {
  const { client, calls, sleeps } = setup([{ status: 500 }]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls.length, 1);
  assert.equal(sleeps.length, 0);
});

test('Meraki error text is passed on with the key removed', async () => {
  const { client } = setup([{ status: 400, body: { errors: ['Key k123 lacks access'] } }]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Key [redacted] lacks access',
  );
});

test('a network error names the host and never the key', async () => {
  const { client } = setup([new TypeError('failed https://x?key=k123')]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) =>
      err.status === 502 && err.message === "Couldn't reach api.meraki.com." && !err.message.includes('k123'),
  );
});

test('follows a redirect within the region domain, keeping the key', async () => {
  const target = 'https://n149.meraki.com/api/v1/organizations';
  const { client, calls } = setup([{ status: 307, headers: { Location: target } }, { body: [{ id: '1' }] }]);
  const { json } = await client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, target);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer k123');
  assert.deepEqual(json, [{ id: '1' }]);
});

test('refuses a redirect outside the region domain', async () => {
  const { client, calls } = setup([
    { status: 302, headers: { Location: 'https://evil.example/api/v1/organizations' } },
    { body: [] },
  ]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls.length, 1);
});

test('meraki.com.evil.example is outside the domain', async () => {
  const { client, calls } = setup([
    { status: 301, headers: { Location: 'https://meraki.com.evil.example/api/v1/organizations' } },
    { body: [] },
  ]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls.length, 1);
});

test('a non-JSON 200 body that echoes the key becomes the generic error', async () => {
  const { fetch, calls } = fakeFetch([]);
  const echo = async (url, init) => {
    calls.push({ url, init });
    return new Response('oops k123 <html>', { status: 200 });
  };
  const client = createMerakiClient({ fetch: echo, sleep: async () => {} });
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) =>
      err.status === 502 &&
      err.message === 'Something went wrong talking to Meraki.' &&
      !err.message.includes('k123'),
  );
});

test('an empty 204 gives null json', async () => {
  const empty = async () => new Response(null, { status: 204 });
  const client = createMerakiClient({ fetch: empty, sleep: async () => {} });
  const { json } = await client._request({ region: 'global', apiKey: 'k123' }, 'DELETE', '/x');
  assert.equal(json, null);
});

test('a 3xx without Location becomes the generic error', async () => {
  const { client } = setup([{ status: 302 }]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
});

test('refuses an http: downgrade redirect inside the domain', async () => {
  const { client, calls } = setup([
    { status: 302, headers: { Location: 'http://n149.meraki.com/api/v1/organizations' } },
    { body: [] },
  ]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls.length, 1);
});

test('stops after 3 redirects', async () => {
  const hop = { status: 307, headers: { Location: 'https://n149.meraki.com/api/v1/organizations' } };
  const { client, calls } = setup([hop, hop, hop, hop, { body: [] }]);
  await assert.rejects(
    client._request({ region: 'global', apiKey: 'k123' }, 'GET', '/organizations'),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls.length, 4);
});
