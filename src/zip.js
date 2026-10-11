import { ConversionError, NotSupportedError } from './errors.js';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const ZIP64_EXTRA_ID = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const EOCD_MIN_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const MAX_COMMENT_SIZE = 0xffff;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const DAMAGED = 'the archive is damaged';
const ZIP64_UNSUPPORTED = "the archive uses Zip64, which isn't supported";

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

// Offsets and lengths come from the archive, so they can't be trusted to stay in the buffer.
function assertInside(view, start, length) {
  if (start < 0 || length < 0 || start + length > view.byteLength) throw new ConversionError(DAMAGED);
}

function readCentralEntry(view, bytes, pos) {
  assertInside(view, pos, CENTRAL_HEADER_SIZE);
  if (view.getUint32(pos, true) !== CENTRAL_SIGNATURE) throw new ConversionError(DAMAGED);
  const nameLength = view.getUint16(pos + 28, true);
  const extraLength = view.getUint16(pos + 30, true);
  const commentLength = view.getUint16(pos + 32, true);
  assertInside(view, pos + CENTRAL_HEADER_SIZE, nameLength + extraLength + commentLength);
  const entry = {
    flags: view.getUint16(pos + 8, true),
    method: view.getUint16(pos + 10, true),
    crc32: view.getUint32(pos + 16, true),
    compressedSize: view.getUint32(pos + 20, true),
    uncompressedSize: view.getUint32(pos + 24, true),
    localOffset: view.getUint32(pos + 42, true),
    name: new TextDecoder().decode(bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength)),
    next: pos + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength,
  };
  const marked =
    entry.compressedSize === MAX_UINT32 ||
    entry.uncompressedSize === MAX_UINT32 ||
    entry.localOffset === MAX_UINT32 ||
    hasZip64Extra(view, pos + CENTRAL_HEADER_SIZE + nameLength, extraLength);
  if (marked) throw new ConversionError(ZIP64_UNSUPPORTED);
  return entry;
}

function locateData(view, entry) {
  const at = entry.localOffset;
  assertInside(view, at, LOCAL_HEADER_SIZE);
  if (view.getUint32(at, true) !== LOCAL_SIGNATURE) throw new ConversionError(DAMAGED);
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  assertInside(view, at + LOCAL_HEADER_SIZE, nameLength + extraLength);
  // Some writers (Python's force_zip64) mark Zip64 only in the local header.
  const marked =
    view.getUint32(at + 18, true) === MAX_UINT32 ||
    view.getUint32(at + 22, true) === MAX_UINT32 ||
    hasZip64Extra(view, at + LOCAL_HEADER_SIZE + nameLength, extraLength);
  if (marked) throw new ConversionError(ZIP64_UNSUPPORTED);
  return at + LOCAL_HEADER_SIZE + nameLength + extraLength;
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
  try {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new ConversionError(DAMAGED);
  }
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
    if (entry.flags & FLAG_ENCRYPTED) throw new ConversionError('the archive is encrypted');
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      throw new ConversionError('the archive uses an unsupported compression method');
    }
    const dataStart = locateData(view, entry);
    if (entry.name.endsWith('/')) continue;
    assertInside(view, dataStart, entry.compressedSize);
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    const data = entry.method === METHOD_DEFLATE ? await inflate(raw) : raw.slice();
    if (crc32(data) !== entry.crc32) throw new ConversionError('the archive is corrupt (checksum mismatch)');
    files.set(entry.name, data);
  }
  return files;
}

const FLAG_UTF8_NAME = 0x0800;
const VERSION_NEEDED = 20;
const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0;
const DOS_DIRECTORY_ATTRIBUTE = 0x10;

async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function prepareEntry([name, data]) {
  const isDirectory = name.endsWith('/');
  const stored = isDirectory ? new Uint8Array(0) : await deflate(data);
  return {
    name: new TextEncoder().encode(name),
    isDirectory,
    method: isDirectory ? METHOD_STORED : METHOD_DEFLATE,
    crc32: crc32(isDirectory ? stored : data),
    uncompressedSize: isDirectory ? 0 : data.length,
    stored,
  };
}

function writeLocalHeader(view, at, entry) {
  view.setUint32(at, LOCAL_SIGNATURE, true);
  view.setUint16(at + 4, VERSION_NEEDED, true);
  view.setUint16(at + 6, FLAG_UTF8_NAME, true);
  view.setUint16(at + 8, entry.method, true);
  view.setUint16(at + 10, DOS_TIME_MIDNIGHT, true);
  view.setUint16(at + 12, DOS_DATE_1980_01_01, true);
  view.setUint32(at + 14, entry.crc32, true);
  view.setUint32(at + 18, entry.stored.length, true);
  view.setUint32(at + 22, entry.uncompressedSize, true);
  view.setUint16(at + 26, entry.name.length, true);
}

function writeCentralHeader(view, at, entry, localOffset) {
  view.setUint32(at, CENTRAL_SIGNATURE, true);
  view.setUint16(at + 4, VERSION_NEEDED, true);
  view.setUint16(at + 6, VERSION_NEEDED, true);
  view.setUint16(at + 8, FLAG_UTF8_NAME, true);
  view.setUint16(at + 10, entry.method, true);
  view.setUint16(at + 12, DOS_TIME_MIDNIGHT, true);
  view.setUint16(at + 14, DOS_DATE_1980_01_01, true);
  view.setUint32(at + 16, entry.crc32, true);
  view.setUint32(at + 20, entry.stored.length, true);
  view.setUint32(at + 24, entry.uncompressedSize, true);
  view.setUint16(at + 28, entry.name.length, true);
  view.setUint32(at + 38, entry.isDirectory ? DOS_DIRECTORY_ATTRIBUTE : 0, true);
  view.setUint32(at + 42, localOffset, true);
}

export async function writeZip(entries) {
  const prepared = await Promise.all(entries.map(prepareEntry));
  const localSize = prepared.reduce((sum, e) => sum + LOCAL_HEADER_SIZE + e.name.length + e.stored.length, 0);
  const centralSize = prepared.reduce((sum, e) => sum + CENTRAL_HEADER_SIZE + e.name.length, 0);
  const total = localSize + centralSize + EOCD_MIN_SIZE;
  // Zip64 isn't written, so refuse to emit offsets or counts that would silently wrap.
  if (total >= MAX_UINT32 || prepared.length >= MAX_UINT16) throw new ConversionError(ZIP64_UNSUPPORTED);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let localAt = 0;
  let centralAt = localSize;
  for (const entry of prepared) {
    writeLocalHeader(view, localAt, entry);
    out.set(entry.name, localAt + LOCAL_HEADER_SIZE);
    out.set(entry.stored, localAt + LOCAL_HEADER_SIZE + entry.name.length);
    writeCentralHeader(view, centralAt, entry, localAt);
    out.set(entry.name, centralAt + CENTRAL_HEADER_SIZE);
    localAt += LOCAL_HEADER_SIZE + entry.name.length + entry.stored.length;
    centralAt += CENTRAL_HEADER_SIZE + entry.name.length;
  }
  const eocd = localSize + centralSize;
  view.setUint32(eocd, EOCD_SIGNATURE, true);
  view.setUint16(eocd + 8, prepared.length, true);
  view.setUint16(eocd + 10, prepared.length, true);
  view.setUint32(eocd + 12, centralSize, true);
  view.setUint32(eocd + 16, localSize, true);
  return out;
}
