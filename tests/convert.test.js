import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convert } from '../src/convert.js';
import { NotSupportedError } from '../src/errors.js';
import { detectFormat } from '../src/detect.js';
import { readZip, writeZip } from '../src/zip.js';
import { assertSameDesign, readOpenIntentZip } from './helpers/compare-oi.js';
import { nodeImageTools, pngHeader } from './helpers/node-images.js';

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

test('an Open Intent zip waits for a library that is still loading', async () => {
  const oiZip = (await convert(fixtureBytes, 'a.esx', options)).bytes;
  const result = await convert(oiZip, 'a.zip', { ...options, library: Promise.resolve(library) });
  assert.equal(result.direction, 'oi-to-esx');
});

test('an .esx converts even when the library failed to load', async () => {
  const failed = Promise.reject(new Error('antenna library: HTTP 404'));
  failed.catch(() => {}); // only an Open Intent conversion would await it
  const result = await convert(fixtureBytes, 'a.esx', { ...options, library: failed });
  assert.equal(result.direction, 'esx-to-oi');
});

test('a zip that is neither format is not supported', async () => {
  const unrelated = await writeZip([['readme.txt', new TextEncoder().encode('hello')]]);
  await assert.rejects(convert(unrelated, 'x.zip', options), NotSupportedError);
});

test('an .esx whose plan is wider than 8000 px comes out at 8000 px for Hamina', async () => {
  const entries = await readZip(fixtureBytes);
  const floors = JSON.parse(new TextDecoder().decode(entries.get('floorPlans.json'))).floorPlans
    .map((floor) => ({ ...floor, width: 10000.0, height: 7500.0 }));
  entries.set('floorPlans.json', new TextEncoder().encode(JSON.stringify({ floorPlans: floors })));
  for (const name of [...entries.keys()].filter((n) => n.startsWith('image-'))) {
    entries.set(name, pngHeader(10000, 7500));
  }

  const { bytes } = await convert(await writeZip([...entries]), 'big.esx', options);

  const { design, images } = await readOpenIntentZip(bytes);
  for (const [name, png] of images) {
    assert.deepEqual(await nodeImageTools.size(png), { width: 8000, height: 6000 }, name);
  }
  for (const floor of design.floorplans) {
    const pixels = floor.dimensions.find((d) => d.unit === 'pixels');
    assert.deepEqual([pixels.width, pixels.length], [8000, 6000], floor.name);
  }
});
