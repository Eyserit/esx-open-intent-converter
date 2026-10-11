// Lists the floors of an Open Intent package for the upload flow, with the first problem that would stop a floor uploading.

const IMAGE_SIGNATURES = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
];

function imageTypeOf(bytes) {
  const match = IMAGE_SIGNATURES.find(([, signature]) => signature.every((b, i) => bytes[i] === b));
  return match ? match[0] : null;
}

function metreSizeOf(floor) {
  const dimension = (floor.dimensions ?? []).find((d) => d.unit === 'meters' && d.width > 0 && d.length > 0);
  return dimension ? { widthM: dimension.width, lengthM: dimension.length } : { widthM: null, lengthM: null };
}

function describeFloor(floor, images) {
  const { widthM, lengthM } = metreSizeOf(floor);
  const bytes = floor.map_uri ? images.get(floor.map_uri.replace(/^file:\/\//, '')) : undefined;
  const base = { name: floor.name, widthM, lengthM };
  if (!bytes) return { ...base, image: null, problem: 'The floor image is missing.' };
  const type = imageTypeOf(bytes);
  if (!type) return { ...base, image: null, problem: "The floor image isn't PNG, JPG or GIF." };
  const image = { bytes, type };
  return { ...base, image, problem: widthM === null ? 'The floor has no size in metres.' : null };
}

export function listFloors(design, images) {
  return design.floorplans.map((floor) => describeFloor(floor, images));
}
