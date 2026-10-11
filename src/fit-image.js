// Hamina shrinks floor plan images larger than 8000 px but keeps reading pixel positions against the
// original image, so oversized plans arrive with every AP and wall misplaced. Shrinking the image here,
// and every pixel-unit value with it, keeps the design aligned. Metre and feet values don't change.
const MAX_IMAGE_SIDE = 8000;

const imagePath = (floor) => floor.map_uri.replace('file://', '');
const pixelDimension = (floor) => floor.dimensions.find((d) => d.unit === 'pixels');
const scalePoint = (point, scale) => ({ x: point.x * scale, y: point.y * scale });

function scaleAccessPoint(ap, scale) {
  const coordinates = ap.coordinates.map(({ coordinate_xyz: xyz, ...rest }) => (xyz.unit === 'pixels'
    ? { ...rest, coordinate_xyz: { ...xyz, x: xyz.x * scale, y: xyz.y * scale, z: xyz.z * scale } }
    : { ...rest, coordinate_xyz: xyz }));
  return { ...ap, coordinates };
}

export async function fitImagesForHamina(openintent, images, imageTools) {
  const fittedImages = new Map(images);
  const scaleByFloor = new Map();
  const floorplans = [];
  for (const floor of openintent.floorplans) {
    const pixels = pixelDimension(floor);
    const scale = MAX_IMAGE_SIDE / Math.max(pixels.width, pixels.length);
    if (scale >= 1) {
      floorplans.push(floor);
      continue;
    }
    const width = Math.round(pixels.width * scale);
    const length = Math.round(pixels.length * scale);
    const path = imagePath(floor);
    fittedImages.set(path, await imageTools.resize(images.get(path), width, length));
    scaleByFloor.set(floor.name, scale);
    // Rounding the pixel height nudges the aspect; keep one scale, as Ekahau's metersPerUnit does.
    floorplans.push({
      ...floor,
      dimensions: floor.dimensions.map((d) => (d === pixels
        ? { ...d, width, length, height: d.height * scale }
        : { ...d, length: length * (d.width / width) })),
      wall_segments: floor.wall_segments.map((wall) => ({
        ...wall,
        start_point: scalePoint(wall.start_point, scale),
        end_point: scalePoint(wall.end_point, scale),
      })),
    });
  }
  const accesspoints = openintent.accesspoints.map((ap) => (scaleByFloor.has(ap.floorplan_name)
    ? scaleAccessPoint(ap, scaleByFloor.get(ap.floorplan_name))
    : ap));
  return { openintent: { ...openintent, floorplans, accesspoints }, images: fittedImages };
}
