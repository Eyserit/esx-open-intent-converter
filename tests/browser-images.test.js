import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { browserImageTools } from '../src/browser-images.js';
import { ConversionError } from '../src/errors.js';

// Node has neither createImageBitmap nor OffscreenCanvas, so each test stands them in.
const stubBitmap = async () => ({ width: 4, height: 3, close() {} });

function stubCanvas({ context = { drawImage() {} }, convertToBlob = async () => new Blob() } = {}) {
  globalThis.createImageBitmap = stubBitmap;
  globalThis.OffscreenCanvas = class {
    getContext() {
      return context;
    }

    convertToBlob() {
      return convertToBlob();
    }
  };
}

afterEach(() => {
  delete globalThis.createImageBitmap;
  delete globalThis.OffscreenCanvas;
});

const rejectsAsPngFailure = (promise) => assert.rejects(
  promise,
  (err) => err instanceof ConversionError && err.reason === "a floor image couldn't be converted to PNG",
);

test('toPng reports a canvas without a 2D context as a ConversionError', async () => {
  stubCanvas({ context: null });
  await rejectsAsPngFailure(browserImageTools.toPng(new Uint8Array([1])));
});

test('toPng reports a failed PNG encode as a ConversionError', async () => {
  stubCanvas({ convertToBlob: async () => { throw new Error('encode failed'); } });
  await rejectsAsPngFailure(browserImageTools.toPng(new Uint8Array([1])));
});
