// Builds tests/fixtures/survey-fixture.esx: fixture.esx's floors and images with made-up
// access points and survey measurements. Run: node tools/make-survey-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { readZip, writeZip } from '../src/zip.js';

const source = new URL('../tests/fixtures/fixture.esx', import.meta.url);
const target = new URL('../tests/fixtures/survey-fixture.esx', import.meta.url);
const encoder = new TextEncoder();
const json = (value) => encoder.encode(JSON.stringify(value));

const ap = (id, name, mine, location) => ({
  id,
  name,
  vendor: 'Acme',
  model: 'X1',
  mine,
  tags: [],
  hidden: false,
  status: 'CREATED',
  userDefinedPosition: true,
  ...(location && { location: { floorPlanId: location.floor, coord: { x: location.x, y: location.y } } }),
});

const accessPoints = [
  ap('s1', 'AP-A', true, { floor: 'fp-g', x: 100, y: 150 }),
  ap('s2', 'Design-Hall', true, { floor: 'fp-g', x: 300, y: 100 }),
  ap('s3', 'Nowhere', true, { floor: 'fp-g', x: 50, y: 250 }),
  ap('s4', 'Neighbour', false, { floor: 'fp-f', x: 320, y: 240 }),
  ap('s5', 'Broken', true, { floor: 'fp-f', x: 100, y: 100 }),
  ap('s6', 'Unplaced', true, null),
];

// One radio per measured AP; each radio lists the measurements (BSSIDs) it heard.
const macs = {
  s1: ['02:00:00:00:0a:01'],
  s2: ['02:00:00:00:0b:01', '02:00:00:00:0B:02'],
  s3: ['02:00:00:00:0f:01'],
  s4: ['02:00:00:00:0c:01'],
};
const measuredRadios = [];
const accessPointMeasurements = [];
for (const [apId, list] of Object.entries(macs)) {
  const ids = list.map((mac, i) => {
    const id = `${apId}-m${i + 1}`;
    accessPointMeasurements.push({ id, mac });
    return id;
  });
  measuredRadios.push({ id: `${apId}-r1`, accessPointId: apId, accessPointMeasurementIds: ids });
}

const entries = await readZip(new Uint8Array(readFileSync(source)));
entries.set('accessPoints.json', json({ accessPoints }));
entries.set('measuredRadios.json', json({ measuredRadios }));
entries.set('accessPointMeasurements.json', json({ accessPointMeasurements }));
writeFileSync(target, await writeZip([...entries]));
