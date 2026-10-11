// Local-only check against a real, private design. ekahau_sample.esx is git-ignored; run with `npm run test:sample`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { convert } from '../src/convert.js';
import { esxToOi } from '../src/esx-to-oi.js';
import { readZip } from '../src/zip.js';
import { assertSameDesign, readOpenIntentZip, sortMaterials } from '../tests/helpers/compare-oi.js';
import { nodeImageTools } from '../tests/helpers/node-images.js';

const SAMPLE_PATH = new URL('../ekahau_sample.esx', import.meta.url);
const PYTHON = new URL('../.venv/bin/python', import.meta.url).pathname;
const REFERENCE_SCRIPT = new URL('../esx2oi.py', import.meta.url).pathname;
const library = JSON.parse(readFileSync(new URL('../src/antenna-library.json', import.meta.url), 'utf8'));
const options = { imageTools: nodeImageTools, library };

function readSample() {
  assert.ok(existsSync(SAMPLE_PATH), 'ekahau_sample.esx not found (local-only check)');
  return new Uint8Array(readFileSync(SAMPLE_PATH));
}

async function pixelSizes(images) {
  const sizes = {};
  for (const [name, png] of images) {
    const { width, height } = await nodeImageTools.size(png);
    sizes[name] = [width, height];
  }
  return sizes;
}

// Parity is with the port itself: convert() then shrinks plans over 8000 px for Hamina, which esx2oi.py doesn't.
test('sample: esxToOi() matches esx2oi.py, key order included', async () => {
  const sample = readSample();
  const workDir = await mkdtemp(join(tmpdir(), 'sample-parity-'));
  try {
    const reference = join(workDir, 'sample.zip');
    await promisify(execFile)(PYTHON, [REFERENCE_SCRIPT, '--esx', SAMPLE_PATH.pathname, '--out', reference]);
    const expected = await readOpenIntentZip(new Uint8Array(await readFile(reference)));
    const { openintent, images } = await esxToOi(await readZip(sample), nodeImageTools);
    const actual = sortMaterials(openintent);
    assert.deepEqual(actual, expected.design);
    assert.deepEqual(Object.keys(actual), Object.keys(expected.design));
    // Python re-encodes the PNG through Pillow, so compare pixel dimensions, not byte lengths.
    assert.deepEqual(await pixelSizes(images), await pixelSizes(expected.images));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('sample: convert() shrinks the 9954 px plan to 8000 px for Hamina', async () => {
  const { design, images } = await readOpenIntentZip((await convert(readSample(), 'sample.esx', options)).bytes);
  assert.deepEqual(Object.values(await pixelSizes(images)), [[8000, 4576]]);
  const pixels = design.floorplans[0].dimensions.find((d) => d.unit === 'pixels');
  assert.deepEqual([pixels.width, pixels.length], [8000, 4576]);
});

test('sample: Open Intent -> .esx -> Open Intent comes back the same', async () => {
  const first = await convert(readSample(), 'sample.esx', options);
  const esx = await convert(first.bytes, 'sample.zip', options);
  const second = await convert(esx.bytes, 'sample.esx', options);

  const one = await readOpenIntentZip(first.bytes);
  const two = await readOpenIntentZip(second.bytes);
  assert.ok(one.design.floorplans.length > 0 && one.design.accesspoints.length > 0, 'sample should not be empty');
  assertSameDesign(two.design, one.design);
  assert.deepEqual(two.imageSizes, one.imageSizes);
});
