import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAntenna, genericAntenna, mergeAntennaTypes } from '../src/antennas.js';

const entry = (over) => ({
  name: 'Mist AP34 5GHz', apVendor: 'Mist', apModel: 'AP34', frequencyBand: 'FIVE',
  radioTechnology: 'IEEE802_11', maxGain: 6, ...over,
});

test('findAntenna matches vendor and model case-insensitively, trimmed', () => {
  const wanted = entry({});
  const library = [entry({ frequencyBand: 'TWO' }), wanted];
  assert.equal(findAntenna(library, ' mist ', 'ap34', 'FIVE'), wanted);
});

test('findAntenna ignores BLE entries and returns null for unknown models', () => {
  const ble = entry({ radioTechnology: 'BLUETOOTH' });
  assert.equal(findAntenna([ble], 'Mist', 'AP34', 'FIVE'), null);
  assert.equal(findAntenna([entry({})], 'Mist', 'AP99', 'FIVE'), null);
});

test('genericAntenna builds a flat 3 dBi 2.4GHz omni pattern', () => {
  const a = genericAntenna('Acme', 'X1', 'TWO');
  assert.equal(a.name, 'Acme X1 2.4GHz');
  assert.equal(a.maxGain, 3);
  assert.equal(a.hplane.gains.length, 72);
  assert.equal(a.eplane.gains.length, 72);
  assert.deepEqual(a.hplane.gains.map((g) => g.angle), Array.from({ length: 72 }, (_, i) => i * 5));
  assert.ok(a.hplane.gains.every((g) => g.gain === 3));
  assert.ok(a.eplane.gains.every((g) => g.gain === 3));
  assert.equal(a.hplane.alignmentAngle, 180);
  assert.equal(a.eplane.alignmentAngle, 90);
  assert.equal(a.directional, false);
  assert.equal(a.defaultMounting, 'CEILING');
  assert.equal(a.apCoupling, 'INTERNAL_ANTENNA');
});

test('genericAntenna uses 4 dBi for 5 and 6 GHz', () => {
  for (const [band, label] of [['FIVE', '5GHz'], ['SIX', '6GHz']]) {
    const a = genericAntenna('Acme', 'X1', band);
    assert.equal(a.name, `Acme X1 ${label}`);
    assert.equal(a.maxGain, 4);
    assert.ok(a.hplane.gains.every((g) => g.gain === 4));
  }
});

test('mergeAntennaTypes replaces same vendor/model/band and drops id, status and BLE', () => {
  const old = entry({ maxGain: 1 });
  const other = entry({ apModel: 'AP45' });
  const incoming = [
    entry({ maxGain: 6, id: 'abc', status: 'CREATED' }),
    entry({ apModel: 'BT1', radioTechnology: 'BLUETOOTH' }),
  ];
  const merged = mergeAntennaTypes([old, other], incoming);
  assert.equal(merged.length, 2);
  assert.ok(merged.includes(other));
  const replaced = merged.find((a) => a.apModel === 'AP34');
  assert.equal(replaced.maxGain, 6);
  assert.ok(!('id' in replaced) && !('status' in replaced));
});
