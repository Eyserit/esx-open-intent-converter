import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConversionError, NotSupportedError } from '../src/errors.js';
import { readZip } from '../src/zip.js';

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
