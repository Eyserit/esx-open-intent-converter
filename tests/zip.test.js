import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversionError, NotSupportedError } from '../src/errors.js';
import { readZip, writeZip } from '../src/zip.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const text = (bytes) => new TextDecoder().decode(bytes);

test('reads stored entries', async () => {
  const files = await readZip(fixture('python-stored.zip'));
  assert.deepEqual([...files.keys()], ['a.txt', 'dir/b.json']);
  assert.equal(text(files.get('a.txt')), 'hello');
});

test('reads deflated entries and skips directories', async () => {
  const files = await readZip(fixture('python-deflated.zip'));
  assert.equal(files.has('images/'), false);
  assert.equal(text(files.get('naïve.txt')), 'ü');
  assert.equal(text(files.get('dir/b.json')), '{"x":1}');
});

test('rejects a non-zip with NotSupportedError', async () => {
  await assert.rejects(readZip(fixture('not-a-zip.bin')), NotSupportedError);
});

const rejectsWithReason = (promise, pattern) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof ConversionError);
    assert.match(error.reason, pattern);
    return true;
  });

test('rejects zip64 with ConversionError', async () => {
  await rejectsWithReason(readZip(fixture('python-zip64.zip')), /Zip64/);
});

test('rejects encrypted entries', async () => {
  const bytes = fixture('python-stored.zip');
  const centralEntry = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes[centralEntry + 8] |= 0x01;
  await rejectsWithReason(readZip(bytes), /encrypted/);
});

test('rejects a corrupt deflate stream as damaged', async () => {
  const bytes = fixture('python-deflated.zip');
  const dataStart = 30 + 'a.txt'.length; // first local header has no extra field
  bytes[dataStart] = 0x07; // final block with the reserved block type
  await rejectsWithReason(readZip(bytes), /damaged/);
});

test('rejects a bad local header signature as damaged', async () => {
  const bytes = fixture('python-stored.zip');
  bytes[0] = 0x00;
  await rejectsWithReason(readZip(bytes), /damaged/);
});

test('rejects a central directory offset past the end as damaged', async () => {
  const bytes = fixture('python-stored.zip');
  const eocd = Buffer.from(bytes).lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  new DataView(bytes.buffer).setUint32(eocd + 16, bytes.length + 100, true);
  await rejectsWithReason(readZip(bytes), /damaged/);
});

test('rejects a local header offset past the end as damaged', async () => {
  const bytes = fixture('python-stored.zip');
  const centralEntry = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  new DataView(bytes.buffer).setUint32(centralEntry + 42, bytes.length + 100, true);
  await rejectsWithReason(readZip(bytes), /damaged/);
});

test('rejects data running past the end of the archive as damaged', async () => {
  const bytes = fixture('python-stored.zip');
  const centralEntry = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  new DataView(bytes.buffer).setUint32(centralEntry + 20, bytes.length, true);
  await rejectsWithReason(readZip(bytes), /damaged/);
});

test('rejects an unsupported compression method', async () => {
  const bytes = fixture('python-stored.zip');
  const centralEntry = Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes[centralEntry + 10] = 12; // bzip2
  await rejectsWithReason(readZip(bytes), /unsupported compression method/);
});

test('rejects a CRC mismatch', async () => {
  const bytes = fixture('python-stored.zip');
  const dataStart = Buffer.from(bytes).indexOf('hello');
  bytes[dataStart] ^= 0xff;
  await rejectsWithReason(readZip(bytes), /corrupt/);
});

const pseudoRandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  let state = 12345;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
};

const sampleEntries = () => [
  ['Automação/ü.json', new TextEncoder().encode('{"x":1}')],
  ['empty.txt', new Uint8Array(0)],
  ['images/', new Uint8Array(0)],
  ['big.bin', pseudoRandomBytes(1024 * 1024)],
];

test('round-trips entries through readZip', async () => {
  const entries = sampleEntries();
  const files = await readZip(await writeZip(entries));
  assert.deepEqual([...files.keys()], ['Automação/ü.json', 'empty.txt', 'big.bin']);
  for (const [name, data] of entries.filter(([n]) => !n.endsWith('/'))) {
    assert.deepEqual(files.get(name), data);
  }
});

test('sets the UTF-8 flag on every central directory entry', async () => {
  const bytes = await writeZip(sampleEntries());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  const count = view.getUint16(eocd + 10, true);
  assert.equal(count, 4);
  let pos = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint16(pos + 8, true) & 0x0800, 0x0800);
    pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
});

test('is deterministic', async () => {
  assert.deepEqual(await writeZip(sampleEntries()), await writeZip(sampleEntries()));
});

test('Python can read it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-writer-'));
  const path = join(dir, 'out.zip');
  try {
    writeFileSync(path, await writeZip(sampleEntries()));
    const result = spawnSync(
      'python3',
      ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None', path],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
