import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFor } from '../src/messages.js';
import { ConversionError, NotSupportedError } from '../src/errors.js';

test('a file that is neither format gets the calm Not supported card', () => {
  const card = cardFor({ type: 'error', error: new NotSupportedError('no') });
  assert.equal(card.state, 'unsupported');
  assert.equal(card.title, "This isn't an Ekahau .esx or an Open Intent zip.");
});

test('a broken .esx names the format and the reason', () => {
  const card = cardFor({ type: 'error', error: new ConversionError('missing wallSegments.json'), format: 'esx' });
  assert.equal(card.state, 'unsupported');
  assert.equal(card.title, "This looks like an Ekahau .esx, but it couldn't be converted: missing wallSegments.json.");
});

test('a broken Open Intent zip names the format and the reason', () => {
  const card = cardFor({ type: 'error', error: new ConversionError('no floors'), format: 'oi' });
  assert.equal(card.title, "This looks like an Open Intent zip, but it couldn't be converted: no floors.");
});

test('a conversion error before the format is known gives the reason without guessing a format', () => {
  const card = cardFor({ type: 'error', error: new ConversionError('the zip is encrypted') });
  assert.equal(card.state, 'unsupported');
  assert.equal(card.title, "This file couldn't be converted: the zip is encrypted.");
});

test('an unexpected error gets a plain apology, not its message', () => {
  const card = cardFor({ type: 'error', error: new TypeError('x is undefined'), format: 'esx' });
  assert.equal(card.state, 'unsupported');
  assert.equal(card.title, 'Something went wrong converting this file.');
});

test('dropping more than one file asks for one at a time', () => {
  assert.deepEqual(cardFor({ type: 'multiple' }), { state: 'unsupported', title: 'Drop one file at a time.' });
});

test('converting an .esx shows the file name and the detected direction', () => {
  assert.deepEqual(cardFor({ type: 'converting', fileName: 'Site A.esx', direction: 'esx-to-oi' }), {
    state: 'converting', title: 'Site A.esx', detail: 'Ekahau .esx → Open Intent .zip',
  });
});

test('converting an Open Intent zip shows the reverse direction', () => {
  const card = cardFor({ type: 'converting', fileName: 'Site A.zip', direction: 'oi-to-esx' });
  assert.equal(card.detail, 'Open Intent .zip → Ekahau .esx');
});

test('before the direction is detected the converting card has no direction line', () => {
  assert.deepEqual(cardFor({ type: 'converting', fileName: 'Site A.esx' }), { state: 'converting', title: 'Site A.esx' });
});

test('done shows the output name and the notes joined by a middle dot', () => {
  const notes = ['3 APs used a generic antenna (model not in library)', '1 APs have no radios and won\'t appear in Ekahau.'];
  assert.deepEqual(cardFor({ type: 'done', outputName: 'Site A.esx', notes }), {
    state: 'done',
    title: 'Site A.esx',
    detail: '3 APs used a generic antenna (model not in library) · 1 APs have no radios and won\'t appear in Ekahau.',
  });
});

test('done with no notes shows no notes line', () => {
  assert.deepEqual(cardFor({ type: 'done', outputName: 'Site A.zip', notes: [] }), { state: 'done', title: 'Site A.zip' });
});

test('idle invites a drop and names both accepted formats', () => {
  assert.deepEqual(cardFor({ type: 'idle' }), {
    state: 'idle', title: 'Drop a file here, or choose one', detail: 'Ekahau .esx or Open Intent .zip',
  });
});

test('dragging a file over the page says release to convert', () => {
  assert.deepEqual(cardFor({ type: 'dragging' }), { state: 'dragging', title: 'Release to convert' });
});

test('a file over the cap gets the too-large card', () => {
  assert.deepEqual(cardFor({ type: 'too-large' }), { state: 'unsupported', title: 'This file is over 100 MB.' });
});
