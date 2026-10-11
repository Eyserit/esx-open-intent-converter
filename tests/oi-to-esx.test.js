import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEsxFloors, buildEsxWalls } from '../src/oi-to-esx.js';
import { ConversionError } from '../src/errors.js';
import { esxToOi } from '../src/esx-to-oi.js';
import { readZip } from '../src/zip.js';
import { nodeImageTools } from './helpers/node-images.js';

const fixtureBytes = new Uint8Array(readFileSync(new URL('./fixtures/fixture.esx', import.meta.url)));

async function loadOi() {
  const { openintent, images } = await esxToOi(await readZip(fixtureBytes), nodeImageTools);
  return { oi: structuredClone(openintent), files: new Map(images) };
}

const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

test('floors take pixel size, metres-per-pixel scale and their image bytes from Open Intent', async () => {
  const { oi, files } = await loadOi();
  const { floorPlans, images, imageFiles, floorByName } = buildEsxFloors(oi, files, counter());

  assert.equal(floorPlans.length, oi.floorplans.length);
  floorPlans.forEach((floor, i) => {
    const source = oi.floorplans[i];
    const pixels = source.dimensions.find((d) => d.unit === 'pixels');
    const metres = source.dimensions.find((d) => d.unit === 'meters');
    assert.equal(floor.name, source.name);
    assert.deepEqual(
      [floor.width, floor.height, floor.cropMinX, floor.cropMinY, floor.cropMaxX, floor.cropMaxY],
      [pixels.width, pixels.length, 0, 0, pixels.width, pixels.length],
    );
    assert.equal(floor.metersPerUnit, metres.width / pixels.width);
    const image = images.find((img) => img.id === floor.imageId);
    assert.deepEqual([image.resolutionWidth, image.resolutionHeight], [pixels.width, pixels.length]);
    assert.deepEqual(imageFiles.get(`image-${image.id}`), files.get(source.map_uri.replace('file://', '')));
    assert.deepEqual(floorByName[source.name], { id: floor.id, mpu: floor.metersPerUnit, heightPx: pixels.length });
  });
});

test('imageFormat follows the image magic bytes', async () => {
  const { oi, files } = await loadOi();
  const jpegPath = oi.floorplans[1].map_uri.replace('file://', '');
  files.set(jpegPath, Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0));

  const { images } = buildEsxFloors(oi, files, counter());

  assert.deepEqual(images.map((img) => img.imageFormat), ['PNG', 'JPEG']);
});

test('scale comes from feet when there is no metres dimension', async () => {
  const { oi, files } = await loadOi();
  const floor = oi.floorplans[0];
  const feet = floor.dimensions.find((d) => d.unit === 'feet');
  const pixels = floor.dimensions.find((d) => d.unit === 'pixels');
  floor.dimensions = floor.dimensions.filter((d) => d.unit !== 'meters');

  const { floorPlans } = buildEsxFloors(oi, files, counter());

  assert.equal(floorPlans[0].metersPerUnit, (feet.width / 3.28084) / pixels.width);
});

test('a floor with no pixels dimension is a ConversionError naming the floor', async () => {
  const { oi, files } = await loadOi();
  oi.floorplans[0].dimensions = oi.floorplans[0].dimensions.filter((d) => d.unit !== 'pixels');

  assert.throws(
    () => buildEsxFloors(oi, files, counter()),
    (err) => err instanceof ConversionError && err.reason.includes('"Ground"') && err.reason.includes('pixel'),
  );
});

test('a floor with neither metres nor feet is a ConversionError naming the floor', async () => {
  const { oi, files } = await loadOi();
  oi.floorplans[0].dimensions = oi.floorplans[0].dimensions.filter((d) => d.unit === 'pixels');

  assert.throws(
    () => buildEsxFloors(oi, files, counter()),
    (err) => err instanceof ConversionError && err.reason.includes('"Ground"') && err.reason.includes('scale'),
  );
});

test('a missing image file is a ConversionError naming the path', async () => {
  const { oi, files } = await loadOi();
  files.delete('images/Fixture_Site_Ground.png');

  assert.throws(
    () => buildEsxFloors(oi, files, counter()),
    (err) => err instanceof ConversionError && err.reason.includes('images/Fixture_Site_Ground.png'),
  );
});

test("an image that is neither PNG nor JPEG is a ConversionError naming the floor", async () => {
  const { oi, files } = await loadOi();
  files.set('images/Fixture_Site_Ground.png', Uint8Array.of(0x47, 0x49, 0x46, 0x38));

  assert.throws(
    () => buildEsxFloors(oi, files, counter()),
    (err) => err instanceof ConversionError && err.reason === `the floor image for "Ground" isn't PNG or JPEG`,
  );
});

test('wall types drop the "[Imported] " prefix and carry the Ekahau constants', async () => {
  const { oi, files } = await loadOi();
  const { floorByName } = buildEsxFloors(oi, files, counter());

  const { wallTypes } = buildEsxWalls(oi, floorByName, counter());

  assert.equal(wallTypes.length, oi.wall_materials.length);
  wallTypes.forEach((type, i) => {
    const material = oi.wall_materials[i];
    const band = (name) => ({
      band: name, attenuationFactor: material.rf_properties.attenuation_per_m,
      reflectionCoefficient: 0.4, diffractionCoefficient: 11.0,
    });
    assert.deepEqual(
      { ...type, id: undefined },
      {
        name: material.name.replace('[Imported] ', ''), key: 'Imported', color: material.display_color,
        propagationProperties: [band('TWO'), band('FIVE'), band('SIX')],
        thickness: material.thickness_m, lowerEdge: 0.0, id: undefined, status: 'CREATED',
      },
    );
  });
});

test('a wall whose type names no material is a ConversionError', async () => {
  const { oi, files } = await loadOi();
  const { floorByName } = buildEsxFloors(oi, files, counter());
  oi.floorplans[0].wall_segments[0].wall_type = 'Glass';

  assert.throws(
    () => buildEsxWalls(oi, floorByName, counter()),
    (err) => err instanceof ConversionError && err.reason === 'wall type "Glass" is not defined',
  );
});

test('wall points are flipped back to bottom-up and every segment reference resolves', async () => {
  const { oi, files } = await loadOi();
  const { floorByName } = buildEsxFloors(oi, files, counter());

  const { wallTypes, wallPoints, wallSegments } = buildEsxWalls(oi, floorByName, counter());

  const sources = oi.floorplans.flatMap((floor) => floor.wall_segments.map((segment) => ({ floor, segment })));
  assert.equal(wallSegments.length, sources.length);
  assert.equal(wallPoints.length, sources.length * 2);
  wallSegments.forEach((segment, i) => {
    const { floor, segment: source } = sources[i];
    const [start, end] = segment.wallPoints.map((id) => wallPoints.find((p) => p.id === id));
    const { id: floorId, heightPx } = floorByName[floor.name];
    assert.deepEqual(start.location, {
      floorPlanId: floorId, coord: { x: source.start_point.x, y: heightPx - source.start_point.y },
    });
    assert.deepEqual(end.location, {
      floorPlanId: floorId, coord: { x: source.end_point.x, y: heightPx - source.end_point.y },
    });
    assert.equal(
      wallTypes.find((t) => t.id === segment.wallTypeId).name,
      source.wall_type.replace('[Imported] ', ''),
    );
    assert.equal(segment.originType, 'WALL_TOOL');
    assert.equal(segment.status, 'CREATED');
  });
});
