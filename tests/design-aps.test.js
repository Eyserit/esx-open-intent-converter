// Synthetic entries only; nothing here comes from a real design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designApsFromEsx, designApsFromOpenIntent } from '../src/design-aps.js';

const json = (value) => new TextEncoder().encode(JSON.stringify(value));
function esxEntries({ floors, aps, radios, measurements }) {
  const entries = new Map([['floorPlans.json', json({ floorPlans: floors })], ['accessPoints.json', json({ accessPoints: aps })]]);
  if (radios) entries.set('measuredRadios.json', json({ measuredRadios: radios }));
  if (measurements) entries.set('accessPointMeasurements.json', json({ accessPointMeasurements: measurements }));
  return entries;
}
const floor = { id: 'f1', name: 'Ground', metersPerUnit: 0.05, width: 400, height: 300 };

test('an .esx AP is placed in metres from the top-left of its floor', () => {
  const aps = designApsFromEsx(esxEntries({ floors: [floor], aps: [{ id: 'a1', name: 'AP-1', mine: true, location: { floorPlanId: 'f1', coord: { x: 100, y: 60 } } }] }));
  assert.deepEqual(aps, [{ name: 'AP-1', floorName: 'Ground', xM: 5, yM: 3, mine: true, bssids: [] }]);
});

test('mine is carried through, and a missing mine counts as yours', () => {
  const at = { floorPlanId: 'f1', coord: { x: 10, y: 10 } };
  const aps = designApsFromEsx(esxEntries({ floors: [floor], aps: [{ id: 'a1', name: 'A', mine: false, location: at }, { id: 'a2', name: 'B', location: at }] }));
  assert.deepEqual(aps.map((ap) => ap.mine), [false, true]);
});

test('an AP with no location, an unknown floor or a floor with no scale is left out', () => {
  const noScale = { id: 'f2', name: 'Flat', metersPerUnit: 0, width: 100, height: 100 };
  const aps = designApsFromEsx(esxEntries({
    floors: [floor, noScale],
    aps: [
      { id: 'a1', name: 'NoLocation' },
      { id: 'a2', name: 'NoCoord', location: { floorPlanId: 'f1' } },
      { id: 'a3', name: 'UnknownFloor', location: { floorPlanId: 'nope', coord: { x: 1, y: 1 } } },
      { id: 'a4', name: 'NoScale', location: { floorPlanId: 'f2', coord: { x: 1, y: 1 } } },
    ],
  }));
  assert.deepEqual(aps, []);
});

test('an AP beyond the image edge is clamped to the floor', () => {
  const aps = designApsFromEsx(esxEntries({ floors: [floor], aps: [{ id: 'a1', name: 'A', location: { floorPlanId: 'f1', coord: { x: 9999, y: -5 } } }] }));
  assert.equal(aps[0].xM, 20);
  assert.equal(aps[0].yM, 0);
});

test('BSSIDs come from measured radios, lower-cased and de-duplicated', () => {
  const at = { floorPlanId: 'f1', coord: { x: 10, y: 10 } };
  const aps = designApsFromEsx(esxEntries({
    floors: [floor],
    aps: [{ id: 'a1', name: 'WithRadios', location: at }, { id: 'a2', name: 'NoRadios', location: at }],
    radios: [
      { id: 'r1', accessPointId: 'a1', accessPointMeasurementIds: ['m1', 'm2'] },
      { id: 'r2', accessPointId: 'a1', accessPointMeasurementIds: ['m3'] },
      { id: 'r3', accessPointId: 'other', accessPointMeasurementIds: ['m4'] },
    ],
    measurements: [
      { id: 'm1', mac: '02:00:00:00:0A:01' },
      { id: 'm2', mac: '02:00:00:00:0a:01' },
      { id: 'm3', mac: '02:00:00:00:0a:02' },
      { id: 'm4', mac: '02:00:00:00:0a:03' },
    ],
  }));
  assert.deepEqual(aps.map((ap) => ap.bssids), [['02:00:00:00:0a:01', '02:00:00:00:0a:02'], []]);
});

test('a predictive design with no survey files gives every AP no BSSIDs', () => {
  const at = { floorPlanId: 'f1', coord: { x: 10, y: 10 } };
  const aps = designApsFromEsx(esxEntries({ floors: [floor], aps: [{ id: 'a1', name: 'A', location: at }, { id: 'a2', name: 'B', location: at }] }));
  assert.deepEqual(aps.map((ap) => ap.bssids), [[], []]);
});

test('a missing accessPoints.json gives no APs', () => {
  assert.deepEqual(designApsFromEsx(new Map()), []);
});

const oiFloor = { name: 'Ground', dimensions: [{ unit: 'meters', width: 20, length: 15 }, { unit: 'pixels', width: 400, length: 300 }] };
const oiAp = (name, coordinates, floorplan_name = 'Ground') => ({ name, floorplan_name, coordinates });

test('an Open Intent AP uses its metre coordinate with y flipped back to the top', () => {
  const design = { floorplans: [oiFloor], accesspoints: [oiAp('AP-1', [{ coordinate_xyz: { x: 5, y: 12, z: 2.5, unit: 'meters' } }])] };
  assert.deepEqual(designApsFromOpenIntent(design), [{ name: 'AP-1', floorName: 'Ground', xM: 5, yM: 3, mine: true, bssids: [] }]);
});

test("without a metre coordinate the pixel one is scaled by the floor's width", () => {
  const design = { floorplans: [oiFloor], accesspoints: [oiAp('AP-1', [{ coordinate_xyz: { x: 100, y: 240, z: 0, unit: 'pixels' } }])] };
  assert.deepEqual(designApsFromOpenIntent(design), [{ name: 'AP-1', floorName: 'Ground', xM: 5, yM: 3, mine: true, bssids: [] }]);
});

test('an Open Intent AP on a floor with no metre size, or with no coordinates, is left out', () => {
  const pixelsOnly = { name: 'Flat', dimensions: [{ unit: 'pixels', width: 400, length: 300 }] };
  const at = [{ coordinate_xyz: { x: 5, y: 12, z: 0, unit: 'meters' } }];
  const design = {
    floorplans: [oiFloor, pixelsOnly],
    accesspoints: [oiAp('NoMetres', at, 'Flat'), oiAp('NoCoords', []), oiAp('NoFloor', at, 'Nope'), oiAp('Kept', at)],
  };
  assert.deepEqual(designApsFromOpenIntent(design).map((ap) => ap.name), ['Kept']);
});
