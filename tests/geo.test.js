import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cornersFor, parseCoordinates } from '../src/geo.js';

const EARTH_RADIUS_M = 6371008.8;
const centre = { lat: 53.35, lng: -6.26 };

function metresBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

test('at 0° the top edge runs due east', () => {
  const { topLeft, topRight } = cornersFor({ center: centre, widthM: 40, lengthM: 20, rotation: 0 });
  assert.ok(Math.abs(topLeft.lat - topRight.lat) < 1e-9);
  assert.ok(topRight.lng > topLeft.lng);
});

test('at 90° the top edge runs due south', () => {
  const { topLeft, topRight } = cornersFor({ center: centre, widthM: 40, lengthM: 20, rotation: 90 });
  assert.ok(topRight.lat < topLeft.lat);
  assert.ok(Math.abs(topRight.lng - topLeft.lng) < 1e-9);
});

test('sides keep their metre lengths within 5 cm', () => {
  for (const rotation of [0, 37, 90, -120]) {
    for (const lat of [0, 53.35, 64]) {
      const c = cornersFor({ center: { lat, lng: -6.26 }, widthM: 40, lengthM: 20, rotation });
      const top = metresBetween(c.topLeft, c.topRight);
      const left = metresBetween(c.topLeft, c.bottomLeft);
      assert.ok(Math.abs(top - 40) < 0.05, `top ${top} at ${rotation}°, lat ${lat}`);
      assert.ok(Math.abs(left - 20) < 0.05, `left ${left} at ${rotation}°, lat ${lat}`);
    }
  }
});

test('the centre is the middle of the diagonal', () => {
  const c = cornersFor({ center: centre, widthM: 40, lengthM: 20, rotation: 37 });
  assert.ok(Math.abs((c.topLeft.lat + c.bottomRight.lat) / 2 - centre.lat) < 1e-9);
  assert.ok(Math.abs((c.topLeft.lng + c.bottomRight.lng) / 2 - centre.lng) < 1e-9);
  assert.ok(Math.abs((c.topRight.lat + c.bottomLeft.lat) / 2 - centre.lat) < 1e-9);
  assert.ok(Math.abs((c.topRight.lng + c.bottomLeft.lng) / 2 - centre.lng) < 1e-9);
});

test('parses coordinates in common forms', () => {
  for (const text of ['53.3498, -6.2603', '53.3498 -6.2603', ' 53.3498,-6.2603 ']) {
    assert.deepEqual(parseCoordinates(text), { lat: 53.3498, lng: -6.2603 });
  }
});

test('rejects text and out-of-range coordinates', () => {
  for (const text of ['Dublin', '91, 0', '0, 181', '', '1,2,3']) {
    assert.equal(parseCoordinates(text), null, text);
  }
});
