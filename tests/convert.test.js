import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convert } from '../src/convert.js';
import { NotSupportedError } from '../src/errors.js';
import { detectFormat } from '../src/detect.js';
import { readZip, writeZip } from '../src/zip.js';
import { nodeImageTools } from './helpers/node-images.js';

const library = JSON.parse(readFileSync(new URL('../src/antenna-library.json', import.meta.url), 'utf8'));
const fixtureBytes = new Uint8Array(readFileSync(new URL('./fixtures/fixture.esx', import.meta.url)));
const options = { imageTools: nodeImageTools, library };

test('an .esx becomes an Open Intent .zip named after the input', async () => {
  const result = await convert(fixtureBytes, 'Site A.esx', options);
  assert.equal(result.direction, 'esx-to-oi');
  assert.equal(result.outputName, 'Site A.zip');
});

test('only the last extension is replaced, and a name without one keeps all of it', async () => {
  const cases = [['site.v2.esx', 'site.v2.zip'], ['design', 'design.zip'], ['SITE.ESX', 'SITE.zip']];
  for (const [input, expected] of cases) {
    assert.equal((await convert(fixtureBytes, input, options)).outputName, expected, input);
  }
});

test('the Open Intent zip holds images/, the images, then compact openintent.json', async () => {
  const { bytes } = await convert(fixtureBytes, 'a.esx', options);
  // readZip drops directory entries, so the first entry's name is read from its local header.
  const firstNameLength = new DataView(bytes.buffer, bytes.byteOffset).getUint16(26, true);
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 30 + firstNameLength)), 'images/');
  const entries = await readZip(bytes);
  const names = [...entries.keys()];
  assert.equal(names.at(-1), 'openintent.json');
  assert.ok(names.length > 1 && names.slice(0, -1).every((n) => /^images\/.+\.png$/.test(n)), names.join());
  const text = new TextDecoder().decode(entries.get('openintent.json'));
  assert.equal(text, JSON.stringify(JSON.parse(text)));
});

test('an Open Intent zip becomes an .esx named after the input', async () => {
  const oiZip = (await convert(fixtureBytes, 'a.esx', options)).bytes;
  const result = await convert(oiZip, 'Site A.zip', options);
  assert.equal(result.direction, 'oi-to-esx');
  assert.equal(result.outputName, 'Site A.esx');
  assert.equal(detectFormat(await readZip(result.bytes)), 'esx');
});

test('an unparseable top-level .json beside the design is ignored', async () => {
  const entries = await readZip((await convert(fixtureBytes, 'a.esx', options)).bytes);
  const withJunk = await writeZip([['a-notes.json', new TextEncoder().encode('not json')], ...entries]);
  const result = await convert(withJunk, 'site.zip', options);
  assert.equal(result.direction, 'oi-to-esx');
});

test('progress arrives as reading, converting, images, writing in both directions', async () => {
  const stagesOf = async (bytes, fileName) => {
    const events = [];
    await convert(bytes, fileName, { ...options, onProgress: (event) => events.push(event) });
    return events;
  };
  const toOi = await stagesOf(fixtureBytes, 'a.esx');
  assert.deepEqual(toOi, [
    { stage: 'reading' },
    ...['converting', 'images', 'writing'].map((stage) => ({ stage, direction: 'esx-to-oi' })),
  ]);
  const oiZip = (await convert(fixtureBytes, 'a.esx', options)).bytes;
  const toEsx = await stagesOf(oiZip, 'a.zip');
  assert.deepEqual(toEsx.map((e) => e.stage), ['reading', 'converting', 'images', 'writing']);
  assert.deepEqual(toEsx.slice(1).map((e) => e.direction), Array(3).fill('oi-to-esx'));
});

const FLOAT_TOLERANCE = 1e-9;
const ATTENUATION_TOLERANCE = 0.1;

// Assert two Open Intent values match, allowing only the drift a round trip is expected to cause.
function assertSameDesign(actual, expected, path = 'design') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tolerance = path.endsWith('.attenuation_flat') ? ATTENUATION_TOLERANCE : FLOAT_TOLERANCE;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${path}: array length`);
    expected.forEach((item, i) => assertSameDesign(actual[i], item, `${path}[${i}]`));
  } else if (expected !== null && typeof expected === 'object') {
    const keys = Object.keys(expected).filter((k) => k !== 'floor_id');
    assert.deepEqual(Object.keys(actual).filter((k) => k !== 'floor_id').sort(), keys.sort(), `${path}: keys`);
    keys.forEach((key) => assertSameDesign(actual[key], expected[key], `${path}.${key}`));
  } else {
    assert.equal(actual, expected, path);
  }
}

const byName = (items) => [...items].sort((a, b) => a.name.localeCompare(b.name));

async function readOpenIntentZip(bytes) {
  const entries = await readZip(bytes);
  const design = JSON.parse(new TextDecoder().decode(entries.get('openintent.json')));
  design.wall_materials = byName(design.wall_materials);
  const imageSizes = Object.fromEntries([...entries].filter(([n]) => n !== 'openintent.json').map(([n, b]) => [n, b.length]));
  return { design, imageSizes };
}

test('fixture -> Open Intent -> .esx -> Open Intent comes back the same', async () => {
  const first = await convert(fixtureBytes, 'site.esx', options);
  const esx = await convert(first.bytes, 'site.zip', options);
  const second = await convert(esx.bytes, 'site.esx', options);

  const one = await readOpenIntentZip(first.bytes);
  const two = await readOpenIntentZip(second.bytes);
  assert.ok(one.design.floorplans.length > 0 && one.design.accesspoints.length > 0, 'fixture should not be empty');
  assertSameDesign(two.design, one.design);
  assert.deepEqual(two.imageSizes, one.imageSizes);
});

test('a zip that is neither format is not supported', async () => {
  const unrelated = await writeZip([['readme.txt', new TextEncoder().encode('hello')]]);
  await assert.rejects(convert(unrelated, 'x.zip', options), NotSupportedError);
});
