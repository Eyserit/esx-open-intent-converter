// Hamina shrinks floor plan images larger than 8000 px but keeps reading pixel positions against the
// original image, so oversized plans arrive with every AP and wall misplaced. Shrinking the image here,
// and every pixel-unit value with it, keeps the design aligned. Metre and feet values don't change.
const MAX_IMAGE_SIDE = 8000;

const imagePath = (floor) => floor.map_uri.replace('file://', '');
const pixelDimension = (floor) => floor.dimensions.find((d) => d.unit === 'pixels');

export async function fitImagesForHamina(openintent, images, imageTools) {
  const fittedImages = new Map(images);
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
    fittedImages.set(imagePath(floor), await imageTools.resize(images.get(imagePath(floor)), width, length));
    floorplans.push({
      ...floor,
      dimensions: floor.dimensions.map((d) => (d === pixels ? { ...d, width, length, height: d.height * scale } : d)),
    });
  }
  return { openintent: { ...openintent, floorplans }, images: fittedImages };
}
