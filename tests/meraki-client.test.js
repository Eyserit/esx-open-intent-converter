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

const AP_BASE = 'https://api.meraki.com/api/v1';
const DEVICES_URL = `${AP_BASE}/organizations/O%2F1/devices?networkIds[]=N_2&productTypes[]=wireless&perPage=1000`;
const PLANS_URL = `${AP_BASE}/networks/N_2/floorPlans`;
const STATUSES_URL = `${AP_BASE}/organizations/O%2F1/wireless/ssids/statuses/byDevice?networkIds[]=N_2&hideDisabled=false&perPage=500`;

test('access points join devices, floor plans and BSSIDs by serial', async () => {
  const { client, calls } = setup([
    { body: [{ serial: 'Q1', name: 'AP-1', lat: 53.1, lng: -6.2, mac: 'x' }] },
    { body: [{ floorPlanId: 'fp1', name: 'Ground', devices: [{ serial: 'Q1' }] }] },
    { body: { items: [{ serial: 'Q1', basicServiceSets: [{ bssid: '02:00:00:00:0A:01' }, { bssid: '02:00:00:00:0a:01' }] }] } },
  ]);
  const result = await client.listAccessPoints({ ...ctx, organizationId: 'O/1', networkId: 'N_2' });
  assert.deepEqual(calls.map((c) => c.url), [DEVICES_URL, PLANS_URL, STATUSES_URL]);
  assert.deepEqual(result.accessPoints, [
    { serial: 'Q1', name: 'AP-1', floorPlanId: 'fp1', lat: 53.1, lng: -6.2, bssids: ['02:00:00:00:0a:01'] },
  ]);
  assert.deepEqual(result.floorPlans, [{ id: 'fp1', name: 'Ground' }]);
});

test('an AP with no BSSID entry, name or position gets empty values', async () => {
  const { client } = setup([
    { body: [{ serial: 'Q2', name: null }] },
    { body: [] },
    { body: { items: [] } },
  ]);
  const { accessPoints } = await client.listAccessPoints({ ...ctx, organizationId: 'O/1', networkId: 'N_2' });
  assert.deepEqual(accessPoints, [{ serial: 'Q2', name: '', floorPlanId: null, lat: null, lng: null, bssids: [] }]);
});

test('BSSID pages follow Link', async () => {
  const { client, calls } = setup([
    { body: [{ serial: 'Q1', name: 'AP-1' }, { serial: 'Q2', name: 'AP-2' }] },
    { body: [] },
    {
      body: { items: [{ serial: 'Q1', basicServiceSets: [{ bssid: 'AA:00:00:00:00:01' }] }] },
      headers: { Link: '<https://n1.meraki.com/api/v1/organizations/O%2F1/wireless/ssids/statuses/byDevice?startingAfter=Q1>; rel=next' },
    },
    { body: { items: [{ serial: 'Q2', basicServiceSets: [{ bssid: 'AA:00:00:00:00:02' }] }] } },
  ]);
  const { accessPoints } = await client.listAccessPoints({ ...ctx, organizationId: 'O/1', networkId: 'N_2' });
  assert.equal(calls.length, 4);
  assert.deepEqual(accessPoints.map((ap) => ap.bssids), [['aa:00:00:00:00:01'], ['aa:00:00:00:00:02']]);
});

test('placing an AP PUTs lat, lng and floorPlanId to the encoded serial', async () => {
  const { client, calls } = setup([{ body: { serial: 'Q2XX/1', lat: 53.1 } }]);
  const result = await client.placeAccessPoint({ ...ctx, serial: 'Q2XX/1', lat: 53.1, lng: -6.2, floorPlanId: 'fp1' });
  assert.deepEqual(result, { serial: 'Q2XX/1' });
  assert.equal(calls[0].url, `${AP_BASE}/devices/Q2XX%2F1`);
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].init.body), { lat: 53.1, lng: -6.2, floorPlanId: 'fp1' });
});
