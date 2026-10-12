import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runApPhase } from '../src/ap-phase.js';
import { cornersFor } from '../src/geo.js';
import { apListError } from '../src/meraki-messages.js';

const centre = { lat: 53.34, lng: -6.26 };
const floor = { name: 'Ground', widthM: 40, lengthM: 30 };
const uploadedAt = (floorPlanId) => ({ floorPlanId, placement: { center: centre, rotation: 0 } });
const design = (name, xM = 0, yM = 0, extra = {}) => ({ name, floorName: 'Ground', xM, yM, mine: true, bssids: [], ...extra });
const meraki = (serial, name, extra = {}) => ({ serial, name, floorPlanId: null, lat: null, lng: null, bssids: [], ...extra });

function run(overrides = {}) {
  const placed = [];
  const progress = [];
  const options = {
    designAps: [design('AP-1')],
    floors: [floor],
    uploaded: new Map([[0, uploadedAt('fp1')]]),
    earlier: new Set(),
    listAccessPoints: async () => ({ accessPoints: [meraki('Q1', 'AP-1')], floorPlans: [{ id: 'fp1', name: 'Ground' }] }),
    placeAccessPoint: async (request) => { placed.push(request); },
    onProgress: (done, total) => progress.push([done, total]),
    ...overrides,
  };
  return runApPhase(options).then((outcome) => ({ ...outcome, placed, progress }));
}

test('a matched AP on an uploaded floor is placed at its design position', async () => {
  const { results, placed } = await run();
  const { topLeft } = cornersFor({ center: centre, widthM: 40, lengthM: 30, rotation: 0 });
  assert.deepEqual(placed, [{ serial: 'Q1', ...topLeft, floorPlanId: 'fp1' }]);
  assert.deepEqual(results, [{ name: 'AP-1', outcome: 'placed', by: 'name', merakiName: 'AP-1' }]);
});

test('APs that aren\'t yours or whose floor wasn\'t uploaded are skipped with a reason', async () => {
  const designAps = [
    design('AP-1'),
    design('Theirs', 0, 0, { mine: false }),
    design('Upstairs', 0, 0, { floorName: 'First' }),
  ];
  const floors = [floor, { name: 'First', widthM: 40, lengthM: 30 }];
  const { results, placed } = await run({ designAps, floors });
  assert.deepEqual(results, [
    { name: 'AP-1', outcome: 'placed', by: 'name', merakiName: 'AP-1' },
    { name: 'Theirs', outcome: 'skipped', reason: 'Not your access point.' },
    { name: 'Upstairs', outcome: 'skipped', reason: 'Its floor wasn\'t uploaded.' },
  ]);
  assert.equal(placed.length, 1);
});

test('with nothing eligible, Meraki is never asked', async () => {
  let asked = 0;
  const { results, listError } = await run({
    designAps: [design('Theirs', 0, 0, { mine: false })],
    listAccessPoints: async () => { asked += 1; return { accessPoints: [], floorPlans: [] }; },
  });
  assert.equal(asked, 0);
  assert.deepEqual(results, [{ name: 'Theirs', outcome: 'skipped', reason: 'Not your access point.' }]);
  assert.equal(listError, null);
});

test('one failed placement doesn\'t stop the rest', async () => {
  const calls = [];
  const { results } = await run({
    designAps: [design('AP-1'), design('AP-2', 5, 5)],
    listAccessPoints: async () => ({ accessPoints: [meraki('Q1', 'AP-1'), meraki('Q2', 'AP-2')], floorPlans: [] }),
    placeAccessPoint: async ({ serial }) => {
      calls.push(serial);
      if (serial === 'Q1') throw new Error('Bad serial.');
    },
  });
  assert.deepEqual(calls, ['Q1', 'Q2']);
  assert.deepEqual(results, [
    { name: 'AP-1', outcome: 'failed', reason: 'Bad serial.' },
    { name: 'AP-2', outcome: 'placed', by: 'name', merakiName: 'AP-2' },
  ]);
});

test('progress counts the placements sent', async () => {
  const { topLeft } = cornersFor({ center: centre, widthM: 40, lengthM: 30, rotation: 0 });
  const { results, progress } = await run({
    designAps: [design('AP-1'), design('AP-2', 5, 5), design('AP-3')],
    listAccessPoints: async () => ({
      accessPoints: [
        meraki('Q1', 'AP-1'),
        meraki('Q2', 'AP-2'),
        meraki('Q3', 'AP-3', { floorPlanId: 'fp1', lat: topLeft.lat, lng: topLeft.lng }),
      ],
      floorPlans: [{ id: 'fp1', name: 'Ground' }],
    }),
  });
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
  assert.equal(results[2].outcome, 'in-place');
});

test('a listing failure places nothing and says why', async () => {
  const { results, listError, placed, progress } = await run({
    designAps: [design('AP-1'), design('Theirs', 0, 0, { mine: false })],
    listAccessPoints: async () => { throw new Error('Forbidden.'); },
  });
  assert.equal(listError, apListError('Forbidden.'));
  assert.deepEqual(placed, []);
  assert.deepEqual(progress, []);
  assert.deepEqual(results, [{ name: 'Theirs', outcome: 'skipped', reason: 'Not your access point.' }]);
});

test('an AP on a floor whose name two design floors share is skipped', async () => {
  const { results, placed } = await run({
    designAps: [design('AP-1')],
    floors: [floor, { ...floor }],
    uploaded: new Map([[0, uploadedAt('fp1')], [1, uploadedAt('fp2')]]),
  });
  assert.deepEqual(results, [
    { name: 'AP-1', outcome: 'skipped', reason: 'Two floors in this design are named “Ground”.' },
  ]);
  assert.deepEqual(placed, []);
});

test('on a retry, APs on floors uploaded earlier are left out', async () => {
  const { results } = await run({
    designAps: [design('AP-1'), design('AP-2', 0, 0, { floorName: 'First' })],
    floors: [floor, { name: 'First', widthM: 40, lengthM: 30 }],
    uploaded: new Map([[1, uploadedAt('fp2')]]),
    earlier: new Set([0]),
    listAccessPoints: async () => ({ accessPoints: [meraki('Q2', 'AP-2')], floorPlans: [] }),
  });
  assert.deepEqual(results, [{ name: 'AP-2', outcome: 'placed', by: 'name', merakiName: 'AP-2' }]);
});

test('already in place, moved and skipped come through as outcomes', async () => {
  const { topLeft } = cornersFor({ center: centre, widthM: 40, lengthM: 30, rotation: 0 });
  const away = { floorPlanId: 'fp1', lat: topLeft.lat + 0.001, lng: topLeft.lng };
  const { results, placed } = await run({
    designAps: [design('Here'), design('Away'), design('Elsewhere'), design('Nobody')],
    listAccessPoints: async () => ({
      accessPoints: [
        meraki('Q1', 'Here', { floorPlanId: 'fp1', lat: topLeft.lat, lng: topLeft.lng }),
        meraki('Q2', 'Away', away),
        meraki('Q3', 'Elsewhere', { floorPlanId: 'fp9', lat: 1, lng: 1 }),
      ],
      floorPlans: [{ id: 'fp9', name: 'Basement' }],
    }),
  });
  assert.deepEqual(results, [
    { name: 'Here', outcome: 'in-place' },
    { name: 'Away', outcome: 'moved', by: 'name', merakiName: 'Away' },
    { name: 'Elsewhere', outcome: 'skipped', reason: 'already placed on “Basement”, left as is.' },
    { name: 'Nobody', outcome: 'unmatched', reason: 'No access point named “Nobody” in this network.' },
  ]);
  assert.deepEqual(placed.map((p) => p.serial), ['Q2']);
});
