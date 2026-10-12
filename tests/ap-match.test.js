import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAccessPoints, placementAction } from '../src/ap-match.js';
import { offsetBy } from '../src/geo.js';

const design = (name, bssids = []) => ({ name, floorName: 'Level 1', xM: 1, yM: 1, mine: true, bssids });
const meraki = (serial, name, bssids = []) => ({ serial, name, floorPlanId: null, lat: null, lng: null, bssids });

test('a name matches ignoring case and surrounding spaces', () => {
  assert.deepEqual(matchAccessPoints([design('AP-1')], [meraki('Q1', ' ap-1 ')]), [{ serial: 'Q1', by: 'name' }]);
});

test('inner differences don\'t match', () => {
  assert.deepEqual(matchAccessPoints([design('AP 1')], [meraki('Q1', 'AP-1')]), [
    { serial: null, reason: 'No access point named “AP 1” in this network.' },
  ]);
});

test('two Meraki APs with the name fall through to BSSID', () => {
  const merakiAps = [meraki('Q1', 'AP-1', ['02:00:00:00:00:01']), meraki('Q2', 'AP-1', ['02:00:00:00:00:02'])];
  assert.deepEqual(matchAccessPoints([design('AP-1', ['02:00:00:00:00:01'])], merakiAps), [{ serial: 'Q1', by: 'bssid' }]);
});

test('a BSSID match ignores case', () => {
  const merakiAps = [meraki('Q1', 'other', ['02:00:00:00:0A:01'])];
  assert.deepEqual(matchAccessPoints([design('AP-1', ['02:00:00:00:0a:01'])], merakiAps), [{ serial: 'Q1', by: 'bssid' }]);
});

test('several BSSID matches leave the AP unmatched', () => {
  const merakiAps = [meraki('Q1', 'x', ['02:00:00:00:00:01']), meraki('Q2', 'y', ['02:00:00:00:00:01'])];
  assert.deepEqual(matchAccessPoints([design('AP-1', ['02:00:00:00:00:01'])], merakiAps), [
    { serial: null, reason: "2 access points broadcast this AP's BSSIDs." },
  ]);
});

test('no BSSID match gives its reason', () => {
  const merakiAps = [meraki('Q1', 'x', ['02:00:00:00:00:09'])];
  assert.deepEqual(matchAccessPoints([design('AP-1', ['02:00:00:00:00:01'])], merakiAps), [
    { serial: null, reason: "No access point broadcasts this AP's BSSIDs." },
  ]);
});

test('with no BSSIDs, duplicate names give the count', () => {
  const merakiAps = [meraki('Q1', 'AP-1'), meraki('Q2', 'ap-1')];
  assert.deepEqual(matchAccessPoints([design('AP-1')], merakiAps), [
    { serial: null, reason: '2 access points are named “AP-1”.' },
  ]);
});

test('an empty name never matches by name', () => {
  assert.deepEqual(matchAccessPoints([design('  ')], [meraki('Q1', '')]), [
    { serial: null, reason: 'No access point named “  ” in this network.' },
  ]);
});

test('one Meraki AP claimed by two design APs is placed for neither', () => {
  const merakiAps = [meraki('Q1', 'AP-1', ['02:00:00:00:00:02'])];
  const designAps = [design('AP-1'), design('AP-2', ['02:00:00:00:00:02'])];
  assert.deepEqual(matchAccessPoints(designAps, merakiAps), [
    { serial: null, reason: 'Matched the same Meraki access point as “AP-2”.' },
    { serial: null, reason: 'Matched the same Meraki access point as “AP-1”.' },
  ]);
});

const target = { lat: 53.35, lng: -6.26 };
const placed = (floorPlanId, position = target) => ({ ...meraki('Q1', 'AP-1'), floorPlanId, ...position });
const names = new Map([['fp1', 'Level 1'], ['fp2', 'Level 2']]);

test('an AP on no floor plan is placed', () => {
  assert.deepEqual(placementAction(placed(null, { lat: null, lng: null }), 'fp1', target, names), { action: 'place' });
});

test('on the target plan beyond 0.5 m it moves', () => {
  assert.deepEqual(placementAction(placed('fp1', offsetBy(target, 0, 0.6)), 'fp1', target, names), { action: 'move' });
});

test('on the target plan within 0.5 m nothing is sent', () => {
  assert.deepEqual(placementAction(placed('fp1', offsetBy(target, 0.3, 0.3)), 'fp1', target, names), { action: 'none' });
});

test('on the target plan with no position it moves', () => {
  assert.deepEqual(placementAction(placed('fp1', { lat: null, lng: null }), 'fp1', target, names), { action: 'move' });
});

test('a missing position is never read as 0, 0', () => {
  const origin = { lat: 0, lng: 0 };
  assert.deepEqual(placementAction(placed('fp1', { lat: null, lng: null }), 'fp1', origin, names), { action: 'move' });
});

test('on another plan it is skipped with that plan\'s name', () => {
  assert.deepEqual(placementAction(placed('fp2'), 'fp1', target, names), {
    action: 'skip',
    reason: 'already placed on “Level 2”, left as is.',
  });
});

test('on an unknown plan the id stands in for its name', () => {
  assert.deepEqual(placementAction(placed('fp9'), 'fp1', target, names), {
    action: 'skip',
    reason: 'already placed on “fp9”, left as is.',
  });
});
