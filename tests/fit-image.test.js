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
