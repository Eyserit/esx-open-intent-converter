import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoutes } from '../server/meraki-routes.js';
import { MerakiError } from '../server/meraki-client.js';

const corner = { lat: 53.1, lng: -6.2 };
const bodies = {
  '/api/organizations': { region: 'global', apiKey: 'k123' },
  '/api/networks': { region: 'global', apiKey: 'k123', organizationId: 'o1' },
  '/api/floor-plans': { region: 'global', apiKey: 'k123', networkId: 'n1' },
  '/api/floor-plans/upload': {
    region: 'global',
    apiKey: 'k123',
    networkId: 'n1',
    name: 'Ground',
    imageContents: 'AAAA',
    topLeftCorner: corner,
    topRightCorner: { lat: 53.1, lng: -6.1 },
  },
};

function fakeClient(impl = {}) {
  const calls = [];
  const record = (method) => async (args) => {
    calls.push({ method, args });
    return impl[method] ? impl[method](args) : { from: method };
  };
  const client = Object.fromEntries(
    ['listOrganizations', 'listWirelessNetworks', 'listFloorPlans', 'uploadFloorPlan'].map((m) => [m, record(m)]),
  );
  return { client, calls };
}

test('each route passes its fields to the client and returns 200', async () => {
  const { client, calls } = fakeClient();
  const routes = createRoutes(client);
  const methods = {
    '/api/organizations': 'listOrganizations',
    '/api/networks': 'listWirelessNetworks',
    '/api/floor-plans': 'listFloorPlans',
    '/api/floor-plans/upload': 'uploadFloorPlan',
  };
  for (const [path, method] of Object.entries(methods)) {
    calls.length = 0;
    const result = await routes.get(path)(bodies[path]);
    assert.deepEqual(result, { status: 200, json: { from: method } });
    assert.deepEqual(calls, [{ method, args: bodies[path] }]);
  }
});

test('extra fields in the body never reach the client', async () => {
  const { client, calls } = fakeClient();
  const routes = createRoutes(client);
  for (const [path, body] of Object.entries(bodies)) {
    calls.length = 0;
    await routes.get(path)({ ...body, forbiddenMeansBadKey: true, junk: 'x' });
    assert.deepEqual(calls.map((call) => call.args), [body]);
  }
});

test('a missing field is a 400 naming it, and the client is not called', async () => {
  const { client, calls } = fakeClient();
  const routes = createRoutes(client);
  for (const [path, body] of Object.entries(bodies)) {
    for (const field of Object.keys(body)) {
      const { [field]: _omitted, ...rest } = body;
      const result = await routes.get(path)(rest);
      assert.deepEqual(result, { status: 400, json: { error: `Missing or invalid ${field}.` } });
    }
    const blank = await routes.get(path)({ ...body, apiKey: '' });
    assert.equal(blank.status, 400);
    assert.equal((await routes.get(path)(undefined)).status, 400);
  }
  assert.deepEqual(calls, []);
});

test('corners must be numbers', async () => {
  const { client, calls } = fakeClient();
  const upload = createRoutes(client).get('/api/floor-plans/upload');
  const body = bodies['/api/floor-plans/upload'];
  const bad = [{ lat: '1', lng: 2 }, { lat: 1 }, { lat: NaN, lng: 2 }, { lat: 1, lng: Infinity }, null, 'x'];
  for (const value of bad) {
    const result = await upload({ ...body, topLeftCorner: value });
    assert.deepEqual(result, { status: 400, json: { error: 'Missing or invalid topLeftCorner.' } });
  }
  const result = await upload({ ...body, topRightCorner: { lat: '1', lng: 2 } });
  assert.deepEqual(result, { status: 400, json: { error: 'Missing or invalid topRightCorner.' } });
  assert.deepEqual(calls, []);
});

test('a MerakiError keeps its status and message', async () => {
  const { client } = fakeClient({
    listOrganizations: () => {
      throw new MerakiError(401, 'That API key was not accepted.');
    },
  });
  const result = await createRoutes(client).get('/api/organizations')(bodies['/api/organizations']);
  assert.deepEqual(result, { status: 401, json: { error: 'That API key was not accepted.' } });
});

test('an unexpected error is a 500 with the generic message', async () => {
  const { client } = fakeClient({
    listOrganizations: () => {
      throw new Error('boom k123');
    },
  });
  const result = await createRoutes(client).get('/api/organizations')(bodies['/api/organizations']);
  assert.deepEqual(result, { status: 500, json: { error: 'Something went wrong talking to Meraki.' } });
  assert.doesNotMatch(JSON.stringify(result), /boom|k123/);
});
