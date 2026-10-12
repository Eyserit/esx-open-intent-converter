import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAccessPoints } from '../src/ap-match.js';

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
