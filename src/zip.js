import { ConversionError, NotSupportedError } from './errors.js';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_EXTRA_ID = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const MAX_COMMENT_SIZE = 0xffff;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const ZIP64_UNSUPPORTED = "uses Zip64, which isn't supported";

function findEndOfCentralDirectory(view) {
  const lowest = Math.max(0, view.byteLength - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let pos = view.byteLength - EOCD_MIN_SIZE; pos >= lowest; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) return pos;
  }
  throw new NotSupportedError('Not a zip archive.');
}

function hasZip64Extra(view, start, length) {
  for (let pos = start; pos + 4 <= start + length; ) {
    if (view.getUint16(pos, true) === ZIP64_EXTRA_ID) return true;
    pos += 4 + view.getUint16(pos + 2, true);
  }
  return false;
}

function assertNotZip64Archive(view, eocd) {
  const locator = eocd - ZIP64_LOCATOR_SIZE;
  const hasLocator = locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE;
  const hasMarkerField =
    view.getUint16(eocd + 8, true) === MAX_UINT16 ||
    view.getUint16(eocd + 10, true) === MAX_UINT16 ||
    view.getUint32(eocd + 12, true) === MAX_UINT32 ||
    view.getUint32(eocd + 16, true) === MAX_UINT32;
  if (hasLocator || hasMarkerField) throw new ConversionError(ZIP64_UNSUPPORTED);
}

function readCentralEntry(view, bytes, pos) {
  if (view.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
    throw new NotSupportedError('Not a zip archive.');
  }
  const nameLength = view.getUint16(pos + 28, true);
  const extraLength = view.getUint16(pos + 30, true);
  const commentLength = view.getUint16(pos + 32, true);
  const entry = {
    flags: view.getUint16(pos + 8, true),
    method: view.getUint16(pos + 10, true),
    crc32: view.getUint32(pos + 16, true),
    compressedSize: view.getUint32(pos + 20, true),
    uncompressedSize: view.getUint32(pos + 24, true),
    localOffset: view.getUint32(pos + 42, true),
    name: new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength)),
    next: pos + 46 + nameLength + extraLength + commentLength,
  };
  const marked =
    entry.compressedSize === MAX_UINT32 ||
    entry.uncompressedSize === MAX_UINT32 ||
    entry.localOffset === MAX_UINT32 ||
    hasZip64Extra(view, pos + 46 + nameLength, extraLength);
  if (marked) throw new ConversionError(ZIP64_UNSUPPORTED);
  return entry;
}

function locateData(view, entry) {
  const at = entry.localOffset;
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  // Some writers (Python's force_zip64) mark Zip64 only in the local header.
  const marked =
    view.getUint32(at + 18, true) === MAX_UINT32 ||
    view.getUint32(at + 22, true) === MAX_UINT32 ||
    hasZip64Extra(view, at + 30 + nameLength, extraLength);
  if (marked) throw new ConversionError(ZIP64_UNSUPPORTED);
  return at + 30 + nameLength + extraLength;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = MAX_UINT32;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ MAX_UINT32) >>> 0;
}

async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  assertNotZip64Archive(view, eocd);
  const entryCount = view.getUint16(eocd + 10, true);

  const files = new Map();
  let pos = view.getUint32(eocd + 16, true);
  for (let i = 0; i < entryCount; i++) {
    const entry = readCentralEntry(view, bytes, pos);
    pos = entry.next;
    if (entry.flags & FLAG_ENCRYPTED) throw new ConversionError('is encrypted');
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      throw new ConversionError('uses an unsupported compression method');
    }
    const dataStart = locateData(view, entry);
    if (entry.name.endsWith('/')) continue;
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    const data = entry.method === METHOD_DEFLATE ? await inflate(raw) : raw.slice();
    if (crc32(data) !== entry.crc32) throw new ConversionError('is corrupt (checksum mismatch)');
    files.set(entry.name, data);
  }
  return files;
}
