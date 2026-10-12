import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMerakiClient } from '../server/meraki-client.js';

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  async function fetch(url, init) {
    calls.push({ url, init });
    const { status = 200, body = {}, headers = {} } = queue.shift();
    return new Response(JSON.stringify(body), { status, headers });
  }
  return { fetch, calls };
}

function setup(responses) {
  const { fetch, calls } = fakeFetch(responses);
  const client = createMerakiClient({ fetch, sleep: async () => {} });
  return { client, calls };
}

const ctx = { region: 'global', apiKey: 'k123' };

test('organisations follow Link pages', async () => {
  const { client, calls } = setup([
    {
      body: [{ id: '1', name: 'One', extra: 'x' }],
      headers: { Link: '<https://n1.meraki.com/api/v1/organizations?startingAfter=1>; rel=next' },
    },
    { body: [{ id: '2', name: 'Two' }] },
  ]);
  const orgs = await client.listOrganizations(ctx);
  assert.deepEqual(orgs, [{ id: '1', name: 'One' }, { id: '2', name: 'Two' }]);
  assert.equal(calls[0].url, 'https://api.meraki.com/api/v1/organizations');
  assert.equal(calls[1].url, 'https://n1.meraki.com/api/v1/organizations?startingAfter=1');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer k123');
});

test('a Link page outside the domain is refused', async () => {
  const { client, calls } = setup([
    {
      body: [{ id: '1', name: 'One' }],
      headers: { Link: '<https://evil.example/api/v1/organizations?startingAfter=1>; rel=next' },
    },
    { body: [] },
  ]);
  await assert.rejects(
    client.listOrganizations(ctx),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls.length, 1);
});

test('paging stops after 100 pages with the generic error', async () => {
  let calls = 0;
  async function fetch() {
    calls += 1;
    // The links run out well past the cap only so a missing cap fails the test instead of hanging it.
    const headers = calls < 1000 ? { Link: `<https://n1.meraki.com/api/v1/organizations?startingAfter=${calls}>; rel=next` } : {};
    return new Response(JSON.stringify([{ id: String(calls), name: 'Org' }]), { status: 200, headers });
  }
  const client = createMerakiClient({ fetch, sleep: async () => {} });
  await assert.rejects(
    client.listOrganizations(ctx),
    (err) => err.status === 502 && err.message === 'Something went wrong talking to Meraki.',
  );
  assert.equal(calls, 100);
});

test('only wireless networks are returned, with their Dashboard url', async () => {
  const { client, calls } = setup([
    {
      body: [
        { id: 'N_1', name: 'Switches', productTypes: ['switch'], url: 'https://n1.meraki.com/Switches/n/a/manage' },
        { id: 'N_2', name: 'Campus', productTypes: ['appliance', 'wireless'], url: 'https://n1.meraki.com/Campus/n/b/manage', timeZone: 'x' },
      ],
    },
  ]);
  const networks = await client.listWirelessNetworks({ ...ctx, organizationId: 'O/1' });
  assert.deepEqual(networks, [{ id: 'N_2', name: 'Campus', url: 'https://n1.meraki.com/Campus/n/b/manage' }]);
  assert.equal(calls[0].url, 'https://api.meraki.com/api/v1/organizations/O%2F1/networks');
});

const upload = {
  ...ctx,
  networkId: 'N/1',
  name: 'Level 2',
  imageContents: 'aGVsbG8=',
  topLeftCorner: { lat: 1, lng: 2 },
  topRightCorner: { lat: 3, lng: 4 },
};
const uploadBody = {
  name: 'Level 2',
  imageContents: 'aGVsbG8=',
  topLeftCorner: { lat: 1, lng: 2 },
  topRightCorner: { lat: 3, lng: 4 },
};

test('upload creates when no plan has the name', async () => {
  const { client, calls } = setup([
    { body: [{ floorPlanId: 'fp1', name: 'Level 1' }] },
    { status: 201, body: { floorPlanId: 'fpNew' } },
  ]);
  const result = await client.uploadFloorPlan(upload);
  assert.deepEqual(result, { action: 'created', floorPlanId: 'fpNew' });
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].url, 'https://api.meraki.com/api/v1/networks/N%2F1/floorPlans');
  assert.deepEqual(JSON.parse(calls[1].init.body), uploadBody);
});

test('upload updates the one plan with the same name', async () => {
  const { client, calls } = setup([
    { body: [{ floorPlanId: 'fp1', name: 'Level 1' }, { floorPlanId: 'fp2', name: 'Level 2' }] },
    { body: { floorPlanId: 'fp2' } },
  ]);
  const result = await client.uploadFloorPlan(upload);
  assert.deepEqual(result, { action: 'updated', floorPlanId: 'fp2' });
  assert.equal(calls[1].init.method, 'PUT');
  assert.equal(calls[1].url, 'https://api.meraki.com/api/v1/networks/N%2F1/floorPlans/fp2');
  assert.deepEqual(JSON.parse(calls[1].init.body), uploadBody);
});

test('upload refuses when two plans share the name', async () => {
  const { client, calls } = setup([
    { body: [{ floorPlanId: 'fp1', name: 'Level 2' }, { floorPlanId: 'fp2', name: 'Level 2' }] },
  ]);
  await assert.rejects(
    client.uploadFloorPlan(upload),
    (err) =>
      err.status === 409 &&
      err.message === '2 floor plans named “Level 2” in this network: rename one in Dashboard.',
  );
  assert.equal(calls.length, 1);
});

test('upload re-lists plans at upload time', async () => {
  const { client, calls } = setup([{ body: [] }, { status: 201, body: { floorPlanId: 'fpNew' } }]);
  await client.uploadFloorPlan(upload);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].url, 'https://api.meraki.com/api/v1/networks/N%2F1/floorPlans');
});

test('403 listing organisations says the key was not accepted', async () => {
  const { client } = setup([{ status: 403 }]);
  await assert.rejects(
    client.listOrganizations({ region: 'canada', apiKey: 'k123' }),
    (err) => err.status === 401 && err.message === "That API key wasn't accepted by Meraki (Canada).",
  );
});
