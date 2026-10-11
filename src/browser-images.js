// The browser's image tools for convert(): decode with createImageBitmap, re-encode with OffscreenCanvas.
// Decode failures reject, so convert() can skip an undecodable candidate the way esx2oi.py does.
import { ConversionError } from './errors.js';

const PNG_FAILURE = "a floor image couldn't be converted to PNG";

export const browserImageTools = {
  async size(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  },

  async toPng(bytes) {
    return drawAsPng(bytes, (bitmap) => [bitmap.width, bitmap.height]);
  },

  async resize(bytes, width, height) {
    return drawAsPng(bytes, () => [width, height]);
  },
};

async function drawAsPng(bytes, sizeOf) {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const [width, height] = sizeOf(bitmap);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new ConversionError(PNG_FAILURE);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let blob;
  try {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } catch (error) {
    throw Object.assign(new ConversionError(PNG_FAILURE), { cause: error });
  }
  return new Uint8Array(await blob.arrayBuffer());
}
