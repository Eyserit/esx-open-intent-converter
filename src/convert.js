import { readZip, writeZip } from './zip.js';
import { detectFormat } from './detect.js';
import { esxToOi } from './esx-to-oi.js';
import { oiToEsx } from './oi-to-esx.js';
import { NotSupportedError } from './errors.js';

const encoder = new TextEncoder();

// Only the last extension goes: "site.v2.esx" keeps its ".v2".
function baseName(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

// Python's write_oi_zip order: images/ directory, each image, then the compact design JSON.
async function convertEsx(entries, fileName, { imageTools, report }) {
  const { openintent, images } = await esxToOi(entries, imageTools, { onProgress: report });
  report({ stage: 'writing' });
  const zipEntries = [
    ['images/', new Uint8Array(0)],
    ...images,
    ['openintent.json', encoder.encode(JSON.stringify(openintent))],
  ];
  return {
    direction: 'esx-to-oi',
    outputName: `${baseName(fileName)}.zip`,
    bytes: await writeZip(zipEntries),
    notes: [],
  };
}

// detectFormat already guaranteed exactly this kind of entry exists.
function parseOpenIntentEntry(entries) {
  for (const [name, data] of entries) {
    if (name.includes('/') || !name.endsWith('.json')) continue;
    const parsed = JSON.parse(new TextDecoder().decode(data));
    if (parsed !== null && typeof parsed === 'object' && 'openintent_version' in parsed) return parsed;
  }
  throw new NotSupportedError('no Open Intent design found');
}

async function convertOpenIntent(entries, fileName, { library, report }) {
  const design = parseOpenIntentEntry(entries);
  // Images are copied unchanged, so this stage is announced just before they are.
  report({ stage: 'images' });
  const { files, notes } = oiToEsx(design, entries, library, baseName(fileName));
  report({ stage: 'writing' });
  return {
    direction: 'oi-to-esx',
    outputName: `${baseName(fileName)}.esx`,
    bytes: await writeZip([...files]),
    notes,
  };
}

export async function convert(bytes, fileName, { imageTools, library, onProgress = () => {} }) {
  onProgress({ stage: 'reading' });
  const entries = await readZip(bytes);
  const format = detectFormat(entries);
  if (format === null) throw new NotSupportedError('not an Ekahau .esx or Open Intent file');

  const direction = format === 'esx' ? 'esx-to-oi' : 'oi-to-esx';
  const report = (event) => onProgress({ ...event, direction });
  report({ stage: 'converting' });
  const run = format === 'esx' ? convertEsx : convertOpenIntent;
  return run(entries, fileName, { imageTools, library, report });
}
