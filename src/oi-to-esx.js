import { findAntenna, genericAntenna } from './antennas.js';
import { ConversionError } from './errors.js';

const dimensionIn = (floor, unit) => floor.dimensions.find((d) => d.unit === unit);

const startsWith = (bytes, magic) => magic.every((b, i) => bytes[i] === b);

function imageFormatOf(bytes, floorName) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'PNG';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'JPEG';
  throw new ConversionError(`the floor image for "${floorName}" isn't PNG or JPEG`);
}

const IMPORTED_PREFIX = '[Imported] ';
const WALL_BANDS = ['TWO', 'FIVE', 'SIX'];

const wallTypeFrom = (material, newId) => ({
  name: material.name.startsWith(IMPORTED_PREFIX) ? material.name.slice(IMPORTED_PREFIX.length) : material.name,
  key: 'Imported',
  color: material.display_color,
  propagationProperties: WALL_BANDS.map((band) => ({
    band,
    attenuationFactor: material.rf_properties.attenuation_per_m,
    reflectionCoefficient: 0.4,
    diffractionCoefficient: 11.0,
  })),
  thickness: material.thickness_m,
  lowerEdge: 0.0,
  id: newId(),
  status: 'CREATED',
});

export function buildEsxWalls(oi, floorByName, newId) {
  const wallTypes = oi.wall_materials.map((material) => wallTypeFrom(material, newId));
  const wallTypeIdByMaterial = Object.fromEntries(oi.wall_materials.map((m, i) => [m.name, wallTypes[i].id]));
  const wallPoints = [];
  const wallSegments = [];

  const addPoint = (floor, point) => {
    const id = newId();
    // Open Intent y runs top-down; Ekahau's runs bottom-up.
    const coord = { x: point.x, y: floor.heightPx - point.y };
    wallPoints.push({ location: { floorPlanId: floor.id, coord }, id, status: 'CREATED' });
    return id;
  };

  for (const source of oi.floorplans) {
    const floor = floorByName[source.name];
    for (const segment of source.wall_segments) {
      const wallTypeId = wallTypeIdByMaterial[segment.wall_type];
      if (!wallTypeId) throw new ConversionError(`wall type "${segment.wall_type}" is not defined`);
      wallSegments.push({
        wallPoints: [addPoint(floor, segment.start_point), addPoint(floor, segment.end_point)],
        wallTypeId,
        originType: 'WALL_TOOL',
        id: newId(),
        status: 'CREATED',
      });
    }
  }
  return { wallTypes, wallPoints, wallSegments };
}

const FEET_PER_METRE = 3.28084;

const metresPerPixel = (floor, pixels) => {
  const metres = dimensionIn(floor, 'meters');
  if (metres) return metres.width / pixels.width;
  const feet = dimensionIn(floor, 'feet');
  if (!feet) throw new ConversionError(`floor "${floor.name}" has no metres or feet dimension to set its scale`);
  return (feet.width / FEET_PER_METRE) / pixels.width;
};

export function buildEsxFloors(oi, files, newId) {
  const floorPlans = [];
  const images = [];
  const imageFiles = new Map();
  const floorByName = {};

  for (const source of oi.floorplans) {
    const pixels = dimensionIn(source, 'pixels');
    if (!pixels) throw new ConversionError(`floor "${source.name}" has no pixel dimensions`);
    const imageId = newId();
    const floorId = newId();
    const mpu = metresPerPixel(source, pixels);

    const imagePath = source.map_uri.replace('file://', '');
    const imageBytes = files.get(imagePath);
    if (!imageBytes) throw new ConversionError(`the floor image "${imagePath}" is missing from the Open Intent file`);
    imageFiles.set(`image-${imageId}`, imageBytes);
    images.push({
      imageFormat: imageFormatOf(imageBytes, source.name), resolutionWidth: pixels.width, resolutionHeight: pixels.length, id: imageId, status: 'CREATED',
    });
    floorPlans.push({
      name: source.name, width: pixels.width, height: pixels.length, metersPerUnit: mpu, imageId,
      gpsReferencePoints: [], floorPlanType: 'FSPL',
      cropMinX: 0.0, cropMinY: 0.0, cropMaxX: pixels.width, cropMaxY: pixels.length,
      rotateUpDirection: 'UP', tags: [], id: floorId, status: 'CREATED',
    });
    floorByName[source.name] = { id: floorId, mpu, heightPx: pixels.length };
  }
  return { floorPlans, images, imageFiles, floorByName };
}

const BAND_BY_OI = { 'FREQ_2.4GHZ': 'TWO', FREQ_5GHZ: 'FIVE', FREQ_6GHZ: 'SIX' };
const ANTENNA_BANDS = ['TWO', 'FIVE', 'SIX'];
const BASE_MHZ = { TWO: 2407, FIVE: 5000, SIX: 5950 };

// 2.4 GHz channel 14 sits outside the regular 5 MHz spacing.
const CHANNEL_14_MHZ = 2484;

function centreFrequency(band, channel) {
  if (band === 'TWO' && channel === 14) return CHANNEL_14_MHZ;
  return BASE_MHZ[band] + 5 * channel;
}

function esxBand(ap, radio) {
  const band = BAND_BY_OI[radio.band];
  if (!band) throw new ConversionError(`AP "${ap.name}" has an unsupported radio band "${radio.band}"`);
  return band;
}

const DEFAULT_ANTENNA_HEIGHT_M = 2.5;

const coordinateIn = (ap, unit) => (ap.coordinates ?? []).find((c) => c.coordinate_xyz.unit === unit)?.coordinate_xyz;

function pixelPosition(ap, floor) {
  const pixels = coordinateIn(ap, 'pixels');
  if (pixels) return pixels;
  const metres = coordinateIn(ap, 'meters');
  if (metres) return { x: metres.x / floor.mpu, y: metres.y / floor.mpu };
  const feet = coordinateIn(ap, 'feet');
  if (!feet) throw new ConversionError(`AP "${ap.name}" has no position`);
  return { x: feet.x / FEET_PER_METRE / floor.mpu, y: feet.y / FEET_PER_METRE / floor.mpu };
}

const apVendor = (ap) => ap.manufacturer_original || ap.manufacturer;
const apModel = (ap) => ap.model_original || ap.model;
const modelKey = (ap) => JSON.stringify([apVendor(ap), apModel(ap)]);
const radiosOf = (ap) => ap.dot11_radios ?? [];
const hasRadios = (ap) => radiosOf(ap).length > 0;

function buildAntennaTypes(aps, library, newId) {
  const idsByModel = new Map();
  const genericModels = new Set();
  const antennaTypes = [];
  for (const ap of aps.filter(hasRadios)) {
    const key = modelKey(ap);
    if (idsByModel.has(key)) continue;
    const ids = {};
    for (const band of ANTENNA_BANDS) {
      let entry = findAntenna(library, apVendor(ap), apModel(ap), band);
      if (!entry) {
        entry = genericAntenna(apVendor(ap), apModel(ap), band);
        genericModels.add(key);
      }
      ids[band] = newId();
      antennaTypes.push({ ...entry, id: ids[band], status: 'CREATED' });
    }
    idsByModel.set(key, ids);
  }
  return { antennaTypes, idsByModel, genericModels };
}

const countOfAps = (n) => (n === 1 ? '1 AP' : `${n} APs`);

function accessPointNotes(aps, genericModels) {
  const genericCount = aps.filter((ap) => hasRadios(ap) && genericModels.has(modelKey(ap))).length;
  const noRadioCount = aps.filter((ap) => !hasRadios(ap)).length;
  const notes = [];
  if (genericCount > 0) notes.push(`${countOfAps(genericCount)} used a generic antenna (model not in library)`);
  if (noRadioCount > 0) {
    const verb = noRadioCount === 1 ? 'has' : 'have';
    notes.push(`${countOfAps(noRadioCount)} ${verb} no radios and won't appear in Ekahau`);
  }
  return notes;
}

function buildEsxAccessPoints(oi, floorByName, library, newId) {
  const { antennaTypes, idsByModel, genericModels } = buildAntennaTypes(oi.accesspoints, library, newId);
  const accessPoints = [];
  const simulatedRadios = [];
  for (const ap of oi.accesspoints) {
    const floor = floorByName[ap.floorplan_name];
    if (!floor) throw new ConversionError(`AP "${ap.name}" is on floor "${ap.floorplan_name}", which doesn't exist`);
    const pixels = pixelPosition(ap, floor);
    const antennaHeight = coordinateIn(ap, 'meters')?.z ?? DEFAULT_ANTENNA_HEIGHT_M;
    const id = newId();
    accessPoints.push({
      location: { floorPlanId: floor.id, coord: { x: pixels.x, y: floor.heightPx - pixels.y } },
      name: ap.name, mine: true, hidden: false, userDefinedPosition: false, noteIds: [],
      vendor: apVendor(ap), model: apModel(ap), tags: [], id, status: 'CREATED',
    });
    const antennaIds = idsByModel.get(modelKey(ap));
    radiosOf(ap).forEach((radio, index) => {
      const band = esxBand(ap, radio);
      simulatedRadios.push({
        accessPointId: id,
        accessPointIndex: index,
        transmitPower: radio.transmit_power,
        channelByCenterFrequencyDefinedNarrowChannels: [centreFrequency(band, radio.channel)],
        antennaDirection: 0.0,
        antennaTilt: 0.0,
        antennaHeight,
        antennaMounting: 'CEILING',
        technology: 'AX',
        radioTechnology: 'IEEE802_11',
        spatialStreamCount: radio.mimo_chains ?? 2,
        shortGuardInterval: true,
        greenfield: false,
        enabled: true,
        id: newId(),
        status: 'CREATED',
        antennaTypeId: antennaIds[band],
        defaultAntennas: ANTENNA_BANDS.map((band) => ({
          radioTechnology: 'IEEE802_11', frequencyBand: band, antennaTypeId: antennaIds[band],
        })),
      });
    });
  }
  return { accessPoints, simulatedRadios, antennaTypes, notes: accessPointNotes(oi.accesspoints, genericModels) };
}

const encoder = new TextEncoder();
const jsonFile = (key, value) => encoder.encode(JSON.stringify({ [key]: value }));

function buildProject(oi, fallbackName, newId) {
  const name = oi.floorplans[0]?.project_name || fallbackName;
  return {
    schemaVersion: '1.9.0', name, title: name, customer: '', location: '', responsiblePerson: '',
    noteIds: [], tags: [], id: newId(), status: 'CREATED',
  };
}

export function oiToEsx(oi, files, library, fallbackName, newId = () => crypto.randomUUID()) {
  const { floorPlans, images, imageFiles, floorByName } = buildEsxFloors(oi, files, newId);
  const { wallTypes, wallPoints, wallSegments } = buildEsxWalls(oi, floorByName, newId);
  const { accessPoints, simulatedRadios, antennaTypes, notes } = buildEsxAccessPoints(oi, floorByName, library, newId);
  const esxFiles = new Map([
    ['version', encoder.encode('2.0')],
    ['project.json', jsonFile('project', buildProject(oi, fallbackName, newId))],
    ['floorPlans.json', jsonFile('floorPlans', floorPlans)],
    ['images.json', jsonFile('images', images)],
    ...imageFiles,
    ['wallTypes.json', jsonFile('wallTypes', wallTypes)],
    ['wallPoints.json', jsonFile('wallPoints', wallPoints)],
    ['wallSegments.json', jsonFile('wallSegments', wallSegments)],
    ['accessPoints.json', jsonFile('accessPoints', accessPoints)],
    ['simulatedRadios.json', jsonFile('simulatedRadios', simulatedRadios)],
    ['antennaTypes.json', jsonFile('antennaTypes', antennaTypes)],
  ]);
  return { files: esxFiles, notes };
}
