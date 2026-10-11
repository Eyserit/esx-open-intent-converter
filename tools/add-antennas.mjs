// Usage: node tools/add-antennas.mjs <file.esx>...
// Merges the Wi-Fi antenna types of each archive into src/antenna-library.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readZip } from '../src/zip.js';
import { mergeAntennaTypes } from '../src/antennas.js';

const LIBRARY_PATH = new URL('../src/antenna-library.json', import.meta.url);
const BAND_ORDER = { TWO: 0, FIVE: 1, SIX: 2 };

const byVendorModelBand = (a, b) =>
  a.apVendor.localeCompare(b.apVendor) ||
  a.apModel.localeCompare(b.apModel) ||
  BAND_ORDER[a.frequencyBand] - BAND_ORDER[b.frequencyBand];

async function readAntennaTypes(path) {
  const files = await readZip(new Uint8Array(readFileSync(path)));
  const json = files.get('antennaTypes.json');
  if (!json) throw new Error(`${path} has no antennaTypes.json`);
  return JSON.parse(new TextDecoder().decode(json)).antennaTypes;
}

async function main(paths) {
  if (paths.length === 0) throw new Error('usage: node tools/add-antennas.mjs <file.esx>...');
  let library = existsSync(LIBRARY_PATH) ? JSON.parse(readFileSync(LIBRARY_PATH, 'utf8')) : [];
  for (const path of paths) library = mergeAntennaTypes(library, await readAntennaTypes(path));
  library.sort(byVendorModelBand);
  writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2) + '\n');
  console.log(`wrote ${library.length} antenna types`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
