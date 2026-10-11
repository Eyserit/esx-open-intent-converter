import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAps, buildFloorObjects, buildWallMaterials, buildWallsForFloor, chooseBestImage, esxToOi, measureImages, round1,
  sanitizeFilename,
} from '../src/esx-to-oi.js';
import { ConversionError } from '../src/errors.js';
import { readZip } from '../src/zip.js';
import { sortMaterials } from './helpers/compare-oi.js';
import { nodeImageTools, recordingImageTools } from './helpers/node-images.js';

const fixtureBytes = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const fixtureEntries = () => readZip(fixtureBytes('fixture.esx'));
const esxJson = (entries, name) => JSON.parse(new TextDecoder().decode(entries.get(`${name}.json`)))[name];
const expected = JSON.parse(new TextDecoder().decode(fixtureBytes('fixture.expected.json')));
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

async function loadFixture() {
  const entries = await fixtureEntries();
  return {
    entries,
    floors: esxJson(entries, 'floorPlans'),
    wallTypes: byId(esxJson(entries, 'wallTypes')),
    wallSegments: esxJson(entries, 'wallSegments'),
    wallPoints: byId(esxJson(entries, 'wallPoints')),
  };
}

test('round1 matches Python float(f"{x:.1f}"), including ties to even', () => {
  const cases = [[0.25, 0.2], [0.75, 0.8], [1.25, 1.2], [0.35, 0.3], [2.675, 2.7], [-0.25, -0.2], [3, 3]];
  for (const [x, expected] of cases) assert.equal(round1(x), expected, `round1(${x})`);
});

test('sanitizeFilename folds accents, joins runs of other characters with _ and falls back to Floor', () => {
  assert.equal(sanitizeFilename('Lab-Automação-Piso1'), 'Lab-Automacao-Piso1');
  assert.equal(sanitizeFilename('..a b/c..'), 'a_b_c');
  assert.equal(sanitizeFilename('日本'), 'Floor');
});

test('buildWallMaterials keeps used wall types and prefers the FIVE band attenuation', async () => {
  const { wallTypes, wallSegments } = await loadFixture();
  const { materials, id2name } = buildWallMaterials(wallTypes, wallSegments, '[Imported] ');
  const byName = Object.fromEntries(materials.map((m) => [m.name, m]));
  assert.deepEqual(Object.keys(byName).sort(), ['[Imported] Brick', '[Imported] Drywall']);
  assert.equal(byName['[Imported] Brick'].rf_properties.attenuation_per_m, 12.3);
  assert.equal(byName['[Imported] Drywall'].rf_properties.attenuation_per_m, 30);
  assert.deepEqual(id2name, { 'wt-dry': '[Imported] Drywall', 'wt-brick': '[Imported] Brick' });
});

test('buildWallsForFloor keeps the floor segments with two points and flips y', async () => {
  const { wallTypes, wallSegments, wallPoints } = await loadFixture();
  const { id2name } = buildWallMaterials(wallTypes, wallSegments, '[Imported] ');
  const walls = buildWallsForFloor('fp-g', 300, wallSegments, wallPoints, id2name);
  assert.equal(walls.length, 4);
  assert.deepEqual(walls[0], {
    wall_type: '[Imported] Drywall',
    start_point: { x: 10, y: 300 - 20 },
    end_point: { x: 390, y: 300 - 20 },
  });
  assert.deepEqual(walls[3].start_point, { x: 10.25, y: 300 - 280.5 });
});

test('buildFloorObjects matches esx2oi.py floorplans and image sizes', async () => {
  const { entries, floors, wallTypes, wallSegments, wallPoints } = await loadFixture();
  const { id2name } = buildWallMaterials(wallTypes, wallSegments, '[Imported] ');
  const metersPerUnit = Object.fromEntries(floors.map((f) => [f.id, Number(f.metersPerUnit || 0)]));
  const { floorsOut, images, floorImgH } = await buildFloorObjects(
    entries, floors, wallSegments, wallPoints, id2name,
    'Fixture_Site', metersPerUnit, 'Fixture Síte', nodeImageTools,
  );
  assert.deepEqual(floorsOut, expected.openintent.floorplans);
  const sizes = {};
  for (const [rel, png] of images) {
    const { width, height } = await nodeImageTools.size(png);
    sizes[rel] = [width, height];
  }
  assert.deepEqual(sizes, expected.images);
  assert.deepEqual(floorImgH, { 'fp-g': 300, 'fp-f': 480 });
});

test('JPEG goes through toPng', async () => {
  const { entries } = await loadFixture();
  const jpeg = fixtureBytes('ground.jpg');
  entries.set('image-g', jpeg);
  const convertedPng = entries.get('image-f');
  // Node can't decode JPEG, so a stand-in reports the target size for any bytes
  const tools = recordingImageTools({
    size: async () => ({ width: 400, height: 300 }),
    toPng: async () => convertedPng,
  });
  const { size, png } = await chooseBestImage(entries, await measureImages(entries, tools), 400, 300, tools);
  assert.deepEqual(tools.toPngCalls, [jpeg]);
  assert.deepEqual(size, [400, 300]);
  assert.equal(png, convertedPng);
});

// Just enough of a PNG (signature + IHDR size fields) for nodeImageTools.size
function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test('buildFloorObjects rounds a half-pixel floor size to even, as Python round does', async () => {
  const entries = new Map([['image-a', pngHeader(400, 300)], ['image-b', pngHeader(401, 301)]]);
  const floors = [{ id: 'x', name: 'X', width: 400.5, height: 300.5 }];
  const { floorsOut } = await buildFloorObjects(entries, floors, [], {}, {}, 'P', {}, 'P', nodeImageTools);
  assert.deepEqual(floorsOut[0].dimensions, [{ width: 400, length: 300, unit: 'pixels', height: 300 }]);
});

test('chooseBestImage skips undecodable images and fails when none is left', async () => {
  const entries = new Map([['image-x', new Uint8Array([1, 2, 3])], ['notes.txt', new Uint8Array()]]);
  await assert.rejects(
    chooseBestImage(entries, await measureImages(entries, nodeImageTools), 400, 300, nodeImageTools),
    (err) => err instanceof ConversionError && err.reason === 'has no floor image',
  );
});

test('buildAps matches esx2oi.py accesspoints, clamping AP-B to the floor width', async () => {
  const { entries, floors } = await loadFixture();
  const metersPerUnit = Object.fromEntries(floors.map((f) => [f.id, Number(f.metersPerUnit || 0)]));
  const floorNameById = Object.fromEntries(floors.map((f) => [f.id, f.name || 'Floor']));
  const floorImgHById = { 'fp-g': 300, 'fp-f': 480 };
  const floorDimsByName = Object.fromEntries(
    expected.openintent.floorplans.map((f) => [f.name, [f.dimensions[0].width, f.dimensions[0].length]]),
  );
  const aps = buildAps(
    esxJson(entries, 'accessPoints'), floorNameById, floorImgHById, metersPerUnit, floorDimsByName, 'ubiquiti', 'uap-ac-pro',
  );
  assert.deepEqual(aps, expected.openintent.accesspoints);
  assert.equal(aps[1].coordinates[0].coordinate_xyz.x, 400);
});

test('esxToOi matches esx2oi.py output for the fixture, key order included', async () => {
  const { openintent, images } = await esxToOi(await fixtureEntries(), nodeImageTools);
  assert.deepEqual(sortMaterials(openintent), sortMaterials(expected.openintent));
  assert.deepEqual(Object.keys(openintent), Object.keys(expected.openintent));
  assert.deepEqual([...images.keys()], Object.keys(expected.images));
});

test('esxToOi names the required file that is missing', async () => {
  const entries = await fixtureEntries();
  entries.delete('wallSegments.json');
  await assert.rejects(
    esxToOi(entries, nodeImageTools),
    (err) => err instanceof ConversionError && err.reason === 'missing wallSegments.json',
  );
});

test('esxToOi reports a required file with corrupt JSON as unreadable', async () => {
  const entries = await fixtureEntries();
  entries.set('floorPlans.json', new TextEncoder().encode('{not json'));
  await assert.rejects(
    esxToOi(entries, nodeImageTools),
    (err) => err instanceof ConversionError && err.reason === 'floorPlans.json is unreadable',
  );
});

test('esxToOi reports a required file without its top-level list as unreadable', async () => {
  const entries = await fixtureEntries();
  entries.set('floorPlans.json', new TextEncoder().encode('{}'));
  await assert.rejects(
    esxToOi(entries, nodeImageTools),
    (err) => err instanceof ConversionError && err.reason === 'floorPlans.json is unreadable',
  );
});

test('esxToOi reports a present accessPoints.json without its list as unreadable', async () => {
  const entries = await fixtureEntries();
  entries.set('accessPoints.json', new TextEncoder().encode('{}'));
  await assert.rejects(
    esxToOi(entries, nodeImageTools),
    (err) => err instanceof ConversionError && err.reason === 'accessPoints.json is unreadable',
  );
});

test('esxToOi decodes each candidate image once, not once per floor', async () => {
  const sizeCalls = [];
  const tools = { ...nodeImageTools, size: (bytes) => { sizeCalls.push(bytes); return nodeImageTools.size(bytes); } };
  await esxToOi(await fixtureEntries(), tools);
  assert.equal(sizeCalls.length, 2);
});

// Same-size PNG headers that differ only in a trailing marker byte
const markedPng = (marker) => Uint8Array.of(...pngHeader(400, 300), marker);

test("two same-size floors each get their own image when the floor's imageId names it", async () => {
  const entries = await fixtureEntries();
  const floors = esxJson(entries, 'floorPlans').map((f) => ({ ...f, width: 400.0, height: 300.0 }));
  entries.set('floorPlans.json', new TextEncoder().encode(JSON.stringify({ floorPlans: floors })));
  entries.set('image-g', markedPng(1));
  entries.set('image-f', markedPng(2));

  const { openintent, images } = await esxToOi(entries, nodeImageTools);

  const imageOf = (floor) => images.get(floor.map_uri.replace('file://', ''));
  assert.deepEqual(openintent.floorplans.map((f) => imageOf(f).at(-1)), [1, 2]);
});
