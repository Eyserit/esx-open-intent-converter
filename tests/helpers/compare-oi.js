import assert from 'node:assert/strict';
import { readZip } from '../../src/zip.js';

const FLOAT_TOLERANCE = 1e-9;
const ATTENUATION_TOLERANCE = 0.1;

// Assert two Open Intent values match, allowing only the drift a round trip is expected to cause.
export function assertSameDesign(actual, expected, path = 'design') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tolerance = path.endsWith('.attenuation_flat') ? ATTENUATION_TOLERANCE : FLOAT_TOLERANCE;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${path}: array length`);
    expected.forEach((item, i) => assertSameDesign(actual[i], item, `${path}[${i}]`));
  } else if (expected !== null && typeof expected === 'object') {
    const keys = Object.keys(expected).filter((k) => k !== 'floor_id');
    assert.deepEqual(Object.keys(actual).filter((k) => k !== 'floor_id').sort(), keys.sort(), `${path}: keys`);
    keys.forEach((key) => assertSameDesign(actual[key], expected[key], `${path}.${key}`));
  } else {
    assert.equal(actual, expected, path);
  }
}

// esx2oi.py iterates a Python set, so material order is not deterministic; compare by name.
export const sortMaterials = (design) => ({
  ...design,
  wall_materials: [...design.wall_materials].sort((a, b) => a.name.localeCompare(b.name)),
});

export async function readOpenIntentZip(bytes) {
  const entries = await readZip(bytes);
  const design = sortMaterials(JSON.parse(new TextDecoder().decode(entries.get('openintent.json'))));
  const imageSizes = Object.fromEntries([...entries].filter(([n]) => n !== 'openintent.json').map(([n, b]) => [n, b.length]));
  return { design, imageSizes };
}
