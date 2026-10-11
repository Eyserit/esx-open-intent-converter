// The browser's image tools for convert(): decode with createImageBitmap, re-encode with OffscreenCanvas.
// Decode failures reject, so convert() can skip an undecodable candidate the way esx2oi.py does.

export const browserImageTools = {
  async size(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  },

  async toPng(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  },
};
