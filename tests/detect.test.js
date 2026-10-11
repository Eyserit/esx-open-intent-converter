import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat } from '../src/detect.js';

const enc = (s) => new TextEncoder().encode(s);
const archive = (files) => new Map(Object.entries(files).map(([name, content]) => [name, enc(content)]));
const oiVersion = '{"openintent_version":"2.0.0"}';

test('detects an esx archive from floorPlans.json and project.json', () => {
  assert.equal(detectFormat(archive({ 'floorPlans.json': '{}', 'project.json': '{}' })), 'esx');
});

test('detects an Open Intent archive from openintent.json', () => {
  assert.equal(detectFormat(archive({ 'openintent.json': oiVersion })), 'oi');
});

test('detects an Open Intent archive from design.json', () => {
  assert.equal(detectFormat(archive({ 'design.json': oiVersion })), 'oi');
});

test('detects an Open Intent archive from any top-level json file name', () => {
  assert.equal(detectFormat(archive({ 'Site A export.json': oiVersion })), 'oi');
});

test('ignores Open Intent files that are not at the top level', () => {
  assert.equal(detectFormat(archive({ 'sub/openintent.json': oiVersion })), null);
});

test('does not throw on an Open Intent file that is not JSON', () => {
  assert.equal(detectFormat(archive({ 'openintent.json': 'not json' })), null);
});

test('does not throw on JSON null', () => {
  assert.equal(detectFormat(archive({ 'openintent.json': 'null' })), null);
});

test('returns null when the archive looks like both formats', () => {
  const both = archive({ 'floorPlans.json': '{}', 'project.json': '{}', 'openintent.json': oiVersion });
  assert.equal(detectFormat(both), null);
});

test('returns null for an unrelated archive', () => {
  assert.equal(detectFormat(archive({ 'a.txt': 'hello' })), null);
});

test('rejects a JSON array and an object without openintent_version', () => {
  assert.equal(detectFormat(archive({ 'openintent.json': '[1]' })), null);
  assert.equal(detectFormat(archive({ 'openintent.json': '{"other":1}' })), null);
});
