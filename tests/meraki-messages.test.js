import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  floorRows, uploadButton, finishedCard, suggestMerakiName, merakiNameProblem,
} from '../src/meraki-messages.js';

const floor = (name, problem = null) => ({ name, widthM: 10, lengthM: 20, image: null, problem });
const placed = (...names) => new Map(names.map((name) => [name, { lat: 1, lng: 2 }]));

test('a fresh floor creates and is ticked', () => {
  const [row] = floorRows([floor('Ground')], [], placed('Ground'), new Set());
  assert.deepEqual(row, {
    name: 'Ground', merakiName: 'Ground', nameProblem: null, action: 'create', reason: null, placed: true, ticked: true,
  });
});

test('a floor without a chosen name uses the suggestion, and a chosen name is checked', () => {
  const floors = [floor('Level 1 (East)'), floor('Ground')];
  const names = new Map([['Ground', 'Ground!']]);
  const [suggested, chosen] = floorRows(floors, [], placed(), new Set(), names);
  assert.equal(suggested.merakiName, 'Level 1 East');
  assert.equal(suggested.nameProblem, null);
  assert.equal(chosen.merakiName, 'Ground!');
  assert.equal(chosen.nameProblem, 'Use only letters, numbers, spaces, - and _.');
});

test('renaming a floor to an existing plan updates it, and renaming it back creates', () => {
  const plans = [{ id: '1', name: 'Lobby' }];
  const rowNamed = (name) => floorRows([floor('Ground')], plans, placed('Ground'), new Set(), new Map([['Ground', name]]))[0];
  assert.equal(rowNamed('Ground').action, 'create');
  assert.equal(rowNamed('Lobby').action, 'update');
  assert.equal(rowNamed('Ground').action, 'create');
  const duplicates = [{ id: '1', name: 'Lobby' }, { id: '2', name: 'Lobby' }];
  const [blocked] = floorRows([floor('Ground')], duplicates, placed('Ground'), new Set(), new Map([['Ground', 'Lobby']]));
  assert.equal(blocked.reason, '2 floor plans named “Lobby” in this network: rename one in Dashboard.');
});

test('an existing plan with the same name updates', () => {
  const [row] = floorRows([floor('Ground')], [{ id: '1', name: 'Ground' }], placed('Ground'), new Set());
  assert.equal(row.action, 'update');
  assert.equal(row.ticked, true);
});

test('duplicate plans in the network block the floor', () => {
  const plans = [{ id: '1', name: 'Ground' }, { id: '2', name: 'Ground' }];
  const [row] = floorRows([floor('Ground')], plans, placed('Ground'), new Set());
  assert.equal(row.action, 'blocked');
  assert.equal(row.reason, '2 floor plans named “Ground” in this network: rename one in Dashboard.');
  assert.equal(row.ticked, false);
});

test('unticking a floor is respected', () => {
  const [row] = floorRows([floor('Ground')], [], placed('Ground'), new Set(['Ground']));
  assert.equal(row.action, 'create');
  assert.equal(row.ticked, false);
});

test('upload needs every ticked floor placed', () => {
  const row = (ticked, placed) => ({ name: 'F', action: 'create', reason: null, placed, ticked });
  assert.deepEqual(uploadButton([row(true, true), row(true, true)]),
    { enabled: true, label: 'Upload 2 floors', hint: null });
  assert.deepEqual(uploadButton([row(true, true)]),
    { enabled: true, label: 'Upload 1 floor', hint: null });
  assert.deepEqual(uploadButton([row(false, false)]),
    { enabled: false, label: 'Upload 0 floors', hint: 'Tick at least one floor.' });
  assert.deepEqual(uploadButton([row(true, true), row(true, false)]),
    { enabled: false, label: 'Upload 2 floors', hint: 'Place every ticked floor on the map first.' });
  assert.equal(uploadButton([row(true, true), row(false, false)]).enabled, true);
});

test('finished card counts outcomes', () => {
  const results = [{ name: 'A', outcome: 'created' }, { name: 'B', outcome: 'updated' }];
  assert.deepEqual(finishedCard({ networkName: 'HQ', results }),
    { title: '2 floors sent to HQ', detail: '1 created, 1 updated.' });
  const withFailure = [...results, { name: 'C', outcome: 'failed', error: 'x' }];
  assert.equal(finishedCard({ networkName: 'HQ', results: withFailure }).detail, '1 created, 1 updated. 1 failed.');
  assert.equal(finishedCard({ networkName: 'HQ', results: [results[0]] }).title, '1 floor sent to HQ');
});

test('a floor with a problem is blocked with its reason and unticked', () => {
  const [row] = floorRows([floor('Ground', 'No floor plan image.')], [], placed('Ground'), new Set());
  assert.equal(row.action, 'blocked');
  assert.equal(row.reason, 'No floor plan image.');
  assert.equal(row.ticked, false);
});

test('a second floor with the same name in the design is blocked', () => {
  const [first, second] = floorRows([floor('Ground'), floor('Ground')], [], placed('Ground'), new Set());
  assert.equal(first.action, 'create');
  assert.equal(second.action, 'blocked');
  assert.equal(second.reason, 'Two floors in this design are named “Ground”.');
  assert.equal(second.ticked, false);
});

test('a suggested Meraki name swaps disallowed characters for spaces', () => {
  assert.equal(suggestMerakiName('Level 1 (East Wing) – Offices'), 'Level 1 East Wing Offices');
  assert.equal(suggestMerakiName('Ground'), 'Ground');
});

test('a name with no allowed characters is suggested as Floor', () => {
  assert.equal(suggestMerakiName('(*) – !'), 'Floor');
});

test('a suggested Meraki name is cut to 25 characters and trimmed again', () => {
  assert.equal(suggestMerakiName('Basement Level Two North Annex'), 'Basement Level Two North');
  // Astral letters are two UTF-16 units each, so the cut must count code points.
  assert.equal(suggestMerakiName('𝐀'.repeat(26)), '𝐀'.repeat(25));
});

test('an empty or blank Meraki name asks for a name', () => {
  assert.equal(merakiNameProblem(''), 'Enter a name.');
  assert.equal(merakiNameProblem('   '), 'Enter a name.');
});

test('a Meraki name over 25 characters says how long it is', () => {
  assert.equal(merakiNameProblem('a'.repeat(26)), 'Use 25 characters or fewer (this one has 26).');
  assert.equal(merakiNameProblem('𝐀'.repeat(26)), 'Use 25 characters or fewer (this one has 26).');
  assert.equal(merakiNameProblem('𝐀'.repeat(25)), null);
  // Length is checked before characters, so the count shows even with a bad character.
  assert.equal(merakiNameProblem(`${'a'.repeat(25)}!`), 'Use 25 characters or fewer (this one has 26).');
  // Blank is checked first, even when the spaces run past 25.
  assert.equal(merakiNameProblem(' '.repeat(30)), 'Enter a name.');
});

test('a Meraki name with a disallowed character lists the allowed ones', () => {
  assert.equal(merakiNameProblem('Level 1 (East)'), 'Use only letters, numbers, spaces, - and _.');
  assert.equal(merakiNameProblem('Étage 2 – Est'), 'Use only letters, numbers, spaces, - and _.');
  assert.equal(merakiNameProblem('Étage_2 - Est 東'), null);
});
