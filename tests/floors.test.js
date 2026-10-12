import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convert } from '../src/convert.js';
import { listFloors } from '../src/floors.js';
import { nodeImageTools } from './helpers/node-images.js';

const library = JSON.parse(readFileSync(new URL('../src/antenna-library.json', import.meta.url), 'utf8'));
const fixtureBytes = new Uint8Array(readFileSync(new URL('./fixtures/fixture.esx', import.meta.url)));

async function groundPackage() {
  const { openintent } = await convert(fixtureBytes, 'a.esx', { imageTools: nodeImageTools, library });
  const floor = openintent.design.floorplans[0];
  return { design: openintent.design, images: openintent.images, floor, imagePath: floor.map_uri.replace('file://', '') };
}

test('lists each floor with its metre size and PNG image', async () => {
  const { design, images } = await groundPackage();
  const floor = listFloors(design, images)[0];
  assert.equal(floor.name, 'Ground');
  assert.equal(floor.widthM, 20);
  assert.equal(floor.lengthM, 15);
  assert.equal(floor.image.type, 'png');
  assert.ok(floor.image.bytes.length > 0);
  assert.equal(floor.problem, null);
});

test('a missing image is a problem, not a crash', async () => {
  const { design, images, imagePath } = await groundPackage();
  images.delete(imagePath);
  const floor = listFloors(design, images)[0];
  assert.equal(floor.problem, 'The floor image is missing.');
  assert.equal(floor.image, null);
});

test('a non-image file is a problem', async () => {
  const { design, images, imagePath } = await groundPackage();
  images.set(imagePath, new TextEncoder().encode('hello'));
  assert.equal(listFloors(design, images)[0].problem, "The floor image isn't PNG, JPG or GIF.");
});

test('JPEG and GIF are recognised', async () => {
  const { design, images, imagePath } = await groundPackage();
  images.set(imagePath, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  assert.equal(listFloors(design, images)[0].image.type, 'jpeg');
  images.set(imagePath, new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]));
  assert.equal(listFloors(design, images)[0].image.type, 'gif');
});

test('a floor without metres is a problem', async () => {
  const { design, images, floor } = await groundPackage();
  floor.dimensions = floor.dimensions.filter((d) => d.unit !== 'meters');
  assert.equal(listFloors(design, images)[0].problem, 'The floor has no size in metres.');
});

test('a floor with a missing, empty or non-string name is a problem, before the image check', async () => {
  const { design, images, floor, imagePath } = await groundPackage();
  images.delete(imagePath);
  for (const name of [undefined, '', 42]) {
    floor.name = name;
    const listed = listFloors(design, images)[0];
    assert.equal(listed.problem, 'The floor has no name.');
    assert.equal(listed.image, null);
  }
});

test('a floor without map_uri is a problem', async () => {
  const { design, images, floor } = await groundPackage();
  delete floor.map_uri;
  const listed = listFloors(design, images)[0];
  assert.equal(listed.problem, 'The floor image is missing.');
  assert.equal(listed.image, null);
});
