// Node has no image decoder, so tests read PNG sizes straight from the IHDR chunk.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const isPng = (bytes) => bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

export const nodeImageTools = {
  async size(bytes) {
    if (!isPng(bytes)) throw new Error('not a PNG');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  },
  async toPng(bytes) {
    if (!isPng(bytes)) throw new Error('not a PNG');
    return bytes;
  },
};

export function recordingImageTools(inner) {
  const toPngCalls = [];
  return {
    toPngCalls,
    size: (bytes) => inner.size(bytes),
    toPng(bytes) {
      toPngCalls.push(bytes);
      return inner.toPng(bytes);
    },
  };
}
