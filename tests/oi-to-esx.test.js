import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEsxFloors, buildEsxWalls, oiToEsx } from '../src/oi-to-esx.js';
import { findAntenna, genericAntenna } from '../src/antennas.js';
import { ConversionError } from '../src/errors.js';
import { esxToOi } from '../src/esx-to-oi.js';
import { readZip } from '../src/zip.js';
import { nodeImageTools } from './helpers/node-images.js';

const library = JSON.parse(readFileSync(new URL('../src/antenna-library.json', import.meta.url), 'utf8'));
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
    assert.deepEqual(floorByName.get(source.name), { id: floor.id, mpu: floor.metersPerUnit, heightPx: pixels.length });
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

test('a wall type named like an Object property is still not defined', async () => {
  const { oi, files } = await loadOi();
  const { floorByName } = buildEsxFloors(oi, files, counter());
  oi.floorplans[0].wall_segments[0].wall_type = 'toString';

  assert.throws(
    () => buildEsxWalls(oi, floorByName, counter()),
    (err) => err instanceof ConversionError && err.reason === 'wall type "toString" is not defined',
  );
});

test('a floor without a wall_segments list has no walls', async () => {
  const { oi, files } = await loadOi();
  const { floorByName } = buildEsxFloors(oi, files, counter());
  delete oi.floorplans[0].wall_segments;

  const { wallSegments } = buildEsxWalls(oi, floorByName, counter());

  assert.equal(wallSegments.length, oi.floorplans[1].wall_segments.length);
});

test('a design without a wall_materials list has no wall types', async () => {
  const { oi, files } = await loadOi();
  const { floorByName } = buildEsxFloors(oi, files, counter());
  delete oi.wall_materials;
  for (const floor of oi.floorplans) floor.wall_segments = [];

  assert.deepEqual(buildEsxWalls(oi, floorByName, counter()), { wallTypes: [], wallPoints: [], wallSegments: [] });
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
    const { id: floorId, heightPx } = floorByName.get(floor.name);
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

const decoder = new TextDecoder();
const readJson = (files, name) => JSON.parse(decoder.decode(files.get(name)))[name.replace('.json', '')];

async function convertFixture(edit = () => {}) {
  const { oi, files } = await loadOi();
  edit(oi);
  const result = oiToEsx(oi, files, library, 'Fallback', counter());
  const json = (name) => readJson(result.files, name);
  return {
    oi, notes: result.notes, files: result.files,
    floorPlans: json('floorPlans.json'), accessPoints: json('accessPoints.json'),
    radios: json('simulatedRadios.json'), antennaTypes: json('antennaTypes.json'),
  };
}

test('every access point, radio and antenna reference resolves', async () => {
  const { floorPlans, accessPoints, radios, antennaTypes } = await convertFixture();
  const resolves = (list, id) => list.some((item) => item.id === id);

  assert.equal(accessPoints.length, 3);
  assert.equal(radios.length, 6);
  for (const ap of accessPoints) assert.ok(resolves(floorPlans, ap.location.floorPlanId));
  for (const radio of radios) {
    assert.ok(resolves(accessPoints, radio.accessPointId));
    assert.ok(resolves(antennaTypes, radio.antennaTypeId));
    assert.equal(radio.defaultAntennas.length, 3);
    for (const d of radio.defaultAntennas) assert.ok(resolves(antennaTypes, d.antennaTypeId));
  }
});

test('each vendor and model gets one antenna type per band, from the library or generic', async () => {
  const { antennaTypes } = await convertFixture();
  const withoutDesign = ({ id, status, ...rest }) => rest;

  assert.deepEqual(antennaTypes.map(withoutDesign), [
    findAntenna(library, 'Mist', 'AP34', 'TWO'),
    findAntenna(library, 'Mist', 'AP34', 'FIVE'),
    findAntenna(library, 'Mist', 'AP34', 'SIX'),
    genericAntenna('Acme', 'X1', 'TWO'),
    genericAntenna('Acme', 'X1', 'FIVE'),
    genericAntenna('Acme', 'X1', 'SIX'),
  ]);
  assert.equal(new Set(antennaTypes.map((t) => t.id)).size, 6);
  for (const type of antennaTypes) assert.equal(type.status, 'CREATED');
});

test('antenna types are only made for models with at least one radio', async () => {
  const { accessPoints, antennaTypes } = await convertFixture((oi) => { oi.accesspoints[2].dot11_radios = []; });

  assert.equal(accessPoints.length, 3);
  assert.deepEqual(antennaTypes.map((t) => [t.apVendor, t.frequencyBand]), [
    ['Mist', 'TWO'], ['Mist', 'FIVE'], ['Mist', 'SIX'],
  ]);
});

test('the fixture notes its one AP with a generic antenna', async () => {
  const { notes } = await convertFixture();

  assert.deepEqual(notes, ['1 AP used a generic antenna (model not in library)']);
});

test('the generic antenna note counts APs, in the plural for more than one', async () => {
  const { notes } = await convertFixture((oi) => { oi.accesspoints[1].model_original = 'AP99'; });

  assert.deepEqual(notes, ['2 APs used a generic antenna (model not in library)']);
});

test("an AP without dot11_radios is still written, with a note that Ekahau won't show it", async () => {
  const { notes, accessPoints, radios } = await convertFixture((oi) => { delete oi.accesspoints[2].dot11_radios; });

  assert.deepEqual(accessPoints.map((ap) => ap.name), ['AP-A', 'AP-B', 'AP-C']);
  assert.equal(radios.length, 4);
  assert.deepEqual(notes, ["1 AP has no radios and won't appear in Ekahau"]);
});

test('both notes appear, generic first, and only APs with radios count as generic', async () => {
  const { notes } = await convertFixture((oi) => {
    oi.accesspoints[0].dot11_radios = [];
    Object.assign(oi.accesspoints[1], { dot11_radios: [], manufacturer_original: 'Acme', model_original: 'X1' });
  });

  assert.deepEqual(notes, [
    '1 AP used a generic antenna (model not in library)',
    "2 APs have no radios and won't appear in Ekahau",
  ]);
});

test('files come in Ekahau order with version "2.0" and a project named after the first floor', async () => {
  const { files, floorPlans } = await convertFixture();
  const imageNames = [...files.keys()].filter((name) => name.startsWith('image-'));

  assert.deepEqual([...files.keys()], [
    'version', 'project.json', 'floorPlans.json', 'images.json', ...imageNames,
    'wallTypes.json', 'wallPoints.json', 'wallSegments.json',
    'accessPoints.json', 'simulatedRadios.json', 'antennaTypes.json',
  ]);
  assert.equal(imageNames.length, floorPlans.length);
  assert.equal(decoder.decode(files.get('version')), '2.0');
  const project = readJson(files, 'project.json');
  assert.deepEqual({ ...project, id: undefined }, {
    schemaVersion: '1.9.0', name: 'Fixture Síte', title: 'Fixture Síte', customer: '', location: '',
    responsiblePerson: '', noteIds: [], tags: [], id: undefined, status: 'CREATED',
  });
  assert.equal(typeof project.id, 'string');
});

test('the project falls back to the given name when the first floor has no project_name', async () => {
  const { files } = await convertFixture((oi) => { delete oi.floorplans[0].project_name; });
  const project = readJson(files, 'project.json');

  assert.deepEqual([project.name, project.title], ['Fallback', 'Fallback']);
});

test('access points take the original vendor and model, else manufacturer and model', async () => {
  const { accessPoints } = await convertFixture((oi) => {
    oi.accesspoints[2].manufacturer_original = '';
    oi.accesspoints[2].model_original = '';
  });

  assert.deepEqual(
    accessPoints.map((ap) => [ap.name, ap.vendor, ap.model]),
    [['AP-A', 'Mist', 'AP34'], ['AP-B', 'Mist', 'AP34'], ['AP-C', 'ubiquiti', 'uap-ac-pro']],
  );
});

test('radios carry centre frequency, power and the Ekahau constants', async () => {
  const { radios, antennaTypes } = await convertFixture((oi) => {
    Object.assign(oi.accesspoints[2].dot11_radios[1], { band: 'FREQ_6GHZ', channel: 37 });
  });
  const bandOf = (radio) => antennaTypes.find((t) => t.id === radio.antennaTypeId).frequencyBand;

  assert.deepEqual(radios.map((r) => r.channelByCenterFrequencyDefinedNarrowChannels), [
    [2462], [5180], [2462], [5180], [2462], [6135],
  ]);
  assert.deepEqual(radios.map(bandOf), ['TWO', 'FIVE', 'TWO', 'FIVE', 'TWO', 'SIX']);
  assert.deepEqual(radios.map((r) => r.accessPointIndex), [0, 1, 0, 1, 0, 1]);
  for (const radio of radios) {
    assert.deepEqual({
      transmitPower: radio.transmitPower, antennaDirection: radio.antennaDirection, antennaTilt: radio.antennaTilt,
      antennaHeight: radio.antennaHeight, antennaMounting: radio.antennaMounting, technology: radio.technology,
      radioTechnology: radio.radioTechnology, spatialStreamCount: radio.spatialStreamCount,
      shortGuardInterval: radio.shortGuardInterval, greenfield: radio.greenfield, enabled: radio.enabled,
      status: radio.status,
    }, {
      transmitPower: 6, antennaDirection: 0, antennaTilt: 0, antennaHeight: 2.5, antennaMounting: 'CEILING',
      technology: 'AX', radioTechnology: 'IEEE802_11', spatialStreamCount: 2,
      shortGuardInterval: true, greenfield: false, enabled: true, status: 'CREATED',
    });
  }
});

test('2.4 GHz channel 14 is 2484 MHz, off the 5 MHz grid', async () => {
  const { radios } = await convertFixture((oi) => { oi.accesspoints[0].dot11_radios[0].channel = 14; });

  assert.deepEqual(radios[0].channelByCenterFrequencyDefinedNarrowChannels, [2484]);
});

test('spatial streams follow mimo_chains, defaulting to 2', async () => {
  const { radios } = await convertFixture((oi) => {
    oi.accesspoints[0].dot11_radios[0].mimo_chains = 4;
    delete oi.accesspoints[0].dot11_radios[1].mimo_chains;
  });

  assert.deepEqual([radios[0].spatialStreamCount, radios[1].spatialStreamCount], [4, 2]);
});

const metresOf = (ap) => ap.coordinates.find((c) => c.coordinate_xyz.unit === 'meters').coordinate_xyz;

test("antenna height is the AP's metres z, or 2.5 without a metres coordinate", async () => {
  const { radios } = await convertFixture((oi) => {
    metresOf(oi.accesspoints[0]).z = 3.2;
    oi.accesspoints[1].coordinates = oi.accesspoints[1].coordinates.filter((c) => c.coordinate_xyz.unit !== 'meters');
  });

  assert.deepEqual(radios.slice(0, 4).map((r) => r.antennaHeight), [3.2, 3.2, 2.5, 2.5]);
});

const floorOf = (floorPlans, ap) => floorPlans.find((f) => f.id === ap.location.floorPlanId);

test('an AP is placed at its pixel coordinate, flipped bottom-up, on its named floor', async () => {
  const { oi, floorPlans, accessPoints } = await convertFixture();

  accessPoints.forEach((ap, i) => {
    const source = oi.accesspoints[i];
    const pixels = source.coordinates.find((c) => c.coordinate_xyz.unit === 'pixels').coordinate_xyz;
    const floor = floorOf(floorPlans, ap);
    assert.equal(floor.name, source.floorplan_name);
    assert.deepEqual(ap.location.coord, { x: pixels.x, y: floor.height - pixels.y });
  });
});

test('an AP with only a metres coordinate is placed at metres / mpu, flipped', async () => {
  const { oi, floorPlans, accessPoints } = await convertFixture((oi) => {
    oi.accesspoints[0].coordinates = oi.accesspoints[0].coordinates.filter((c) => c.coordinate_xyz.unit === 'meters');
  });
  const metres = metresOf(oi.accesspoints[0]);
  const floor = floorOf(floorPlans, accessPoints[0]);

  assert.deepEqual(accessPoints[0].location.coord, {
    x: metres.x / floor.metersPerUnit, y: floor.height - metres.y / floor.metersPerUnit,
  });
});

test('an AP with only a feet coordinate is placed at feet / 3.28084 / mpu, flipped', async () => {
  const { oi, floorPlans, accessPoints } = await convertFixture((oi) => {
    oi.accesspoints[0].coordinates = oi.accesspoints[0].coordinates.filter((c) => c.coordinate_xyz.unit === 'feet');
  });
  const feet = oi.accesspoints[0].coordinates[0].coordinate_xyz;
  const floor = floorOf(floorPlans, accessPoints[0]);

  assert.deepEqual(accessPoints[0].location.coord, {
    x: feet.x / 3.28084 / floor.metersPerUnit, y: floor.height - feet.y / 3.28084 / floor.metersPerUnit,
  });
});

const rejectsWith = (edit, reason) => assert.rejects(
  convertFixture(edit),
  (err) => err instanceof ConversionError && err.reason === reason,
);

test('an AP with no usable coordinate is a ConversionError naming the AP', async () => {
  await rejectsWith((oi) => { oi.accesspoints[1].coordinates = []; }, 'AP "AP-B" has no position');
});

test('an AP without a coordinates list is a ConversionError naming the AP', async () => {
  await rejectsWith((oi) => { delete oi.accesspoints[1].coordinates; }, 'AP "AP-B" has no position');
});

test('an AP on an unknown floor is a ConversionError naming the AP and floor', async () => {
  await rejectsWith(
    (oi) => { oi.accesspoints[2].floorplan_name = 'Roof'; },
    `AP "AP-C" is on floor "Roof", which doesn't exist`,
  );
});

test('a radio on an unknown band is a ConversionError naming the AP and band', async () => {
  await rejectsWith(
    (oi) => { oi.accesspoints[0].dot11_radios[1].band = 'FREQ_60GHZ'; },
    'AP "AP-A" has an unsupported radio band "FREQ_60GHZ"',
  );
});

test('a design without an accesspoints list converts with no APs', async () => {
  const { accessPoints, radios, antennaTypes, notes } = await convertFixture((oi) => { delete oi.accesspoints; });

  assert.deepEqual([accessPoints, radios, antennaTypes, notes], [[], [], [], []]);
});

test('a radio without a channel is a ConversionError naming the AP', async () => {
  await rejectsWith(
    (oi) => { delete oi.accesspoints[1].dot11_radios[0].channel; },
    'AP "AP-B" has a radio without a channel',
  );
});

test('a radio with a non-numeric channel is a ConversionError naming the AP', async () => {
  await rejectsWith(
    (oi) => { oi.accesspoints[1].dot11_radios[0].channel = '6'; },
    'AP "AP-B" has a radio without a channel',
  );
});

test('a radio without a transmit power is a ConversionError naming the AP', async () => {
  await rejectsWith(
    (oi) => { delete oi.accesspoints[1].dot11_radios[1].transmit_power; },
    'AP "AP-B" has a radio without a transmit power',
  );
});

test('a radio with a non-numeric transmit power is a ConversionError naming the AP', async () => {
  await rejectsWith(
    (oi) => { oi.accesspoints[1].dot11_radios[1].transmit_power = null; },
    'AP "AP-B" has a radio without a transmit power',
  );
});

test('two floors with the same name are a ConversionError naming it', async () => {
  await rejectsWith((oi) => { oi.floorplans[1].name = 'Ground'; }, 'two floors are named "Ground"');
});

test('two wall materials with the same name are a ConversionError naming it', async () => {
  await rejectsWith(
    (oi) => { oi.wall_materials.push({ ...oi.wall_materials[0], name: oi.wall_materials[1].name }); },
    'two wall types are named "[Imported] Brick"',
  );
});

test('a radio band named like an Object property is still unsupported', async () => {
  await rejectsWith(
    (oi) => { oi.accesspoints[0].dot11_radios[1].band = 'constructor'; },
    'AP "AP-A" has an unsupported radio band "constructor"',
  );
});

test('an AP on a floor named like an Object property is still an unknown floor', async () => {
  await rejectsWith(
    (oi) => { oi.accesspoints[2].floorplan_name = 'constructor'; },
    `AP "AP-C" is on floor "constructor", which doesn't exist`,
  );
});
