import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitImagesForHamina } from '../src/fit-image.js';
import { nodeImageTools, pngHeader } from './helpers/node-images.js';

const IMAGE = 'images/Plan.png';

// One floor, one wall, one AP, all in the shape esxToOi produces.
function design(width, height) {
  const mpp = 0.05;
  return {
    openintent: {
      floorplans: [{
        name: 'Plan',
        map_uri: `file://${IMAGE}`,
        dimensions: [
          { width, length: height, unit: 'pixels', height: 2.5 / mpp },
          { width: width * mpp, length: height * mpp, unit: 'meters', height: 2.5 },
          { width: width * mpp * 3.28084, length: height * mpp * 3.28084, unit: 'feet', height: 8.202 },
        ],
        wall_segments: [{ wall_type: 'Wall', start_point: { x: 1000, y: 500 }, end_point: { x: 9000, y: 4500 } }],
      }],
      accesspoints: [{
        name: 'AP-1',
        floorplan_name: 'Plan',
        coordinates: [
          { coordinate_xyz: { x: 2000, y: 1000, z: 2.5 / mpp, unit: 'pixels' } },
          { coordinate_xyz: { x: 2000 * mpp, y: 1000 * mpp, z: 2.5, unit: 'meters' } },
          { coordinate_xyz: { x: 2000 * mpp * 3.28084, y: 1000 * mpp * 3.28084, z: 8.202, unit: 'feet' } },
        ],
      }],
    },
    images: new Map([[IMAGE, pngHeader(width, height)]]),
  };
}

const pixels = (floor) => floor.dimensions.find((d) => d.unit === 'pixels');

test('a plan wider than 8000 px is shrunk to 8000 px wide, pixel dimensions included', async () => {
  const { openintent, images } = design(10000, 5000);

  const fitted = await fitImagesForHamina(openintent, images, nodeImageTools);

  assert.deepEqual(await nodeImageTools.size(fitted.images.get(IMAGE)), { width: 8000, height: 4000 });
  const floor = fitted.openintent.floorplans[0];
  assert.deepEqual(pixels(floor), { width: 8000, length: 4000, unit: 'pixels', height: 40 });
});

test('a plan of 8000 px or less passes through untouched', async () => {
  const { openintent, images } = design(8000, 5000);
  const tools = { ...nodeImageTools, resize: () => assert.fail('resize should not be called') };

  const fitted = await fitImagesForHamina(openintent, images, tools);

  assert.deepEqual(fitted.openintent, openintent);
  assert.equal(fitted.images.get(IMAGE), images.get(IMAGE));
});

test('a tall plan is capped by its height', async () => {
  const { openintent, images } = design(3000, 12000);

  const fitted = await fitImagesForHamina(openintent, images, nodeImageTools);

  assert.deepEqual(await nodeImageTools.size(fitted.images.get(IMAGE)), { width: 2000, height: 8000 });
});

test('walls and AP pixel positions shrink with the image; metres and feet stay put', async () => {
  const { openintent, images } = design(10000, 5000);

  const fitted = await fitImagesForHamina(openintent, images, nodeImageTools);

  const [wall] = fitted.openintent.floorplans[0].wall_segments;
  assert.deepEqual(wall.start_point, { x: 800, y: 400 });
  assert.deepEqual(wall.end_point, { x: 7200, y: 3600 });
  const [px, metres, feet] = fitted.openintent.accesspoints[0].coordinates.map((c) => c.coordinate_xyz);
  assert.deepEqual(px, { x: 1600, y: 800, z: 40, unit: 'pixels' });
  assert.deepEqual(metres, openintent.accesspoints[0].coordinates[1].coordinate_xyz);
  assert.deepEqual(feet, openintent.accesspoints[0].coordinates[2].coordinate_xyz);
  assert.deepEqual(fitted.openintent.floorplans[0].dimensions.slice(1), openintent.floorplans[0].dimensions.slice(1));
});
