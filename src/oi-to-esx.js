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
