import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cornersFor, parseCoordinates, offsetBy, bearingTo, wrapRotation, apLatLng, distanceM } from '../src/geo.js';

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

test('offsetBy moves a point the given metres east and north', () => {
  for (const lat of [0, 53.35, 64]) {
    const from = { lat, lng: -6.26 };
    const east = offsetBy(from, 5, 0);
    const north = offsetBy(from, 0, 5);
    assert.ok(Math.abs(metresBetween(from, east) - 5) < 0.01, `east at lat ${lat}`);
    assert.ok(east.lat === lat && east.lng > from.lng);
    assert.ok(Math.abs(metresBetween(from, north) - 5) < 0.01, `north at lat ${lat}`);
    assert.ok(north.lng === from.lng && north.lat > lat);
  }
});

test('bearingTo gives degrees clockwise from north, from -180 to 180', () => {
  const cases = [[0, 10, 0], [10, 0, 90], [0, -10, 180], [-10, 0, -90], [10, 10, 45], [-10, -10, -135]];
  for (const [eastM, northM, expected] of cases) {
    const bearing = bearingTo(centre, offsetBy(centre, eastM, northM));
    assert.ok(Math.abs(bearing - expected) < 1e-9, `${eastM} E, ${northM} N gave ${bearing}`);
  }
});

test('wrapRotation keeps a rotation within the slider range', () => {
  const cases = [[0, 0], [179, 179], [180, 180], [181, -179], [-180, -180], [-181, 179], [540, 180], [-12.5, -12.5]];
  for (const [rotation, expected] of cases) {
    assert.equal(wrapRotation(rotation), expected, `${rotation}`);
  }
});

test("an AP at the image's top-left lands on the plan's top-left corner", () => {
  const plan = { center: centre, rotation: 30, widthM: 40, lengthM: 30 };
  assert.deepEqual(apLatLng(plan, 0, 0), cornersFor(plan).topLeft);
});

test("an AP at the image's centre lands on the plan's centre", () => {
  const plan = { center: centre, rotation: 30, widthM: 40, lengthM: 30 };
  const ap = apLatLng(plan, 20, 15);
  assert.ok(Math.abs(ap.lat - centre.lat) < 1e-9);
  assert.ok(Math.abs(ap.lng - centre.lng) < 1e-9);
});

test('at 90° an AP on the east edge lands south of the centre', () => {
  const plan = { center: centre, rotation: 90, widthM: 40, lengthM: 30 };
  const ap = apLatLng(plan, 40, 15);
  assert.ok(Math.abs(ap.lat - (centre.lat - 20 / 111320)) < 1e-9);
  assert.ok(Math.abs(ap.lng - centre.lng) < 1e-9);
});

test("an AP's distance from the centre is right to 5 cm", () => {
  const plan = { center: centre, rotation: 0, widthM: 40, lengthM: 30 };
  assert.ok(Math.abs(metresBetween(centre, apLatLng(plan, 40, 0)) - 25) < 0.05);
});

test('distanceM measures small flat distances', () => {
  assert.ok(Math.abs(distanceM(centre, offsetBy(centre, 0.3, 0.4)) - 0.5) < 1e-6);
});
