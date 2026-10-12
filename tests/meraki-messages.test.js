import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  floorRows, uploadButton, finishedCard, suggestMerakiName, merakiNameProblem, effectivePlacements, buildingReferenceIndex,
} from '../src/meraki-messages.js';

const floor = (name, problem = null) => ({ name, widthM: 10, lengthM: 20, image: null, problem });
const placed = (...indexes) => new Map(indexes.map((index) => [index, { lat: 1, lng: 2 }]));

test('a fresh floor creates and is ticked', () => {
  const [row] = floorRows([floor('Ground')], [], placed(0), new Set());
  assert.deepEqual(row, {
    name: 'Ground', merakiName: 'Ground', nameProblem: null, action: 'create', reason: null, placed: true, ticked: true,
  });
});

test('a floor without a chosen name uses the suggestion, and a chosen name is checked', () => {
  const floors = [floor('Level 1 (East)'), floor('Ground')];
  const names = new Map([[1, 'Ground!']]);
  const [suggested, chosen] = floorRows(floors, [], placed(), new Set(), names);
  assert.equal(suggested.merakiName, 'Level 1 East');
  assert.equal(suggested.nameProblem, null);
  assert.equal(chosen.merakiName, 'Ground!');
  assert.equal(chosen.nameProblem, 'Use only letters, numbers, spaces, - and _.');
});

test('two floors with the same source name can be given different Meraki names', () => {
  const [a, b] = floorRows([floor('Ground'), floor('Ground')], [], placed(), new Set(), new Map([[1, 'Ground 2']]));
  assert.equal(a.action, 'create');
  assert.equal(a.merakiName, 'Ground');
  assert.equal(b.action, 'create');
  assert.equal(b.merakiName, 'Ground 2');
});

test('placing or unticking one of two same-named floors leaves the other alone', () => {
  const floors = [floor('Ground'), floor('Ground')];
  const names = new Map([[1, 'Ground 2']]);
  const [a, b] = floorRows(floors, [], new Map([[1, { lat: 1, lng: 2 }]]), new Set([0]), names);
  assert.equal(a.placed, false);
  assert.equal(a.ticked, false);
  assert.equal(b.placed, true);
  assert.equal(b.ticked, true);
});

test('a chosen name is trimmed before it is checked, matched and sent', () => {
  const [row] = floorRows([floor('Ground')], [{ id: '1', name: 'Lobby' }], placed(0), new Set(), new Map([[0, ' Lobby ']]));
  assert.equal(row.action, 'update');
  assert.equal(row.merakiName, 'Lobby');
});

test('two floors with the same invalid name show only the name problem', () => {
  const rows = floorRows([floor('A'), floor('B')], [], placed(0, 1), new Set(), new Map([[0, ''], [1, ' ']]));
  for (const row of rows) {
    assert.equal(row.action, 'create');
    assert.equal(row.reason, null);
    assert.equal(row.ticked, true);
    assert.equal(row.nameProblem, 'Enter a name.');
  }
  assert.equal(uploadButton(rows).hint, 'Fix the floor names first.');
});

test('renaming a floor to an existing plan updates it, and renaming it back creates', () => {
  const plans = [{ id: '1', name: 'Lobby' }];
  const rowNamed = (name) => floorRows([floor('Ground')], plans, placed(0), new Set(), new Map([[0, name]]))[0];
  assert.equal(rowNamed('Ground').action, 'create');
  assert.equal(rowNamed('Lobby').action, 'update');
  assert.equal(rowNamed('Ground').action, 'create');
  const duplicates = [{ id: '1', name: 'Lobby' }, { id: '2', name: 'Lobby' }];
  const [blocked] = floorRows([floor('Ground')], duplicates, placed(0), new Set(), new Map([[0, 'Lobby']]));
  assert.equal(blocked.reason, '2 floor plans named “Lobby” in this network: rename one in Dashboard.');
});

test('floors given the same Meraki name block the second and later ones', () => {
  const floors = [floor('Ground'), floor('First'), floor('Second')];
  const names = new Map([[1, 'Ground'], [2, 'Ground']]);
  const [ground, first, second] = floorRows(floors, [], placed(), new Set(), names);
  assert.equal(ground.action, 'create');
  assert.equal(first.action, 'blocked');
  assert.equal(first.reason, 'Two floors in this design are named “Ground”.');
  assert.equal(first.ticked, false);
  assert.equal(second.action, 'blocked');
  // Source names that differ only in disallowed characters collide once suggested.
  const [, other] = floorRows([floor('Level 1'), floor('Level 1!')], [], placed(), new Set());
  assert.equal(other.reason, 'Two floors in this design are named “Level 1”.');
});

test('upload waits for ticked floors to have valid names, after ticking and before placing', () => {
  const row = (ticked, placed, nameProblem) => ({ name: 'F', action: 'create', reason: null, placed, ticked, nameProblem });
  const bad = 'Enter a name.';
  assert.equal(uploadButton([row(false, false, bad)]).hint, 'Tick at least one floor.');
  assert.deepEqual(uploadButton([row(true, false, bad)]),
    { enabled: false, label: 'Upload 1 floor', hint: 'Fix the floor names first.' });
  assert.equal(uploadButton([row(true, false, null)]).hint, 'Place every ticked floor on the map first.');
  // An unticked floor's name doesn't hold up the others.
  assert.equal(uploadButton([row(true, true, null), row(false, true, bad)]).enabled, true);
});

test('an existing plan with the same name updates', () => {
  const [row] = floorRows([floor('Ground')], [{ id: '1', name: 'Ground' }], placed(0), new Set());
  assert.equal(row.action, 'update');
  assert.equal(row.ticked, true);
});

test('duplicate plans in the network block the floor', () => {
  const plans = [{ id: '1', name: 'Ground' }, { id: '2', name: 'Ground' }];
  const [row] = floorRows([floor('Ground')], plans, placed(0), new Set());
  assert.equal(row.action, 'blocked');
  assert.equal(row.reason, '2 floor plans named “Ground” in this network: rename one in Dashboard.');
  assert.equal(row.ticked, false);
});

test('unticking a floor is respected', () => {
  const [row] = floorRows([floor('Ground')], [], placed(0), new Set([0]));
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
  const [row] = floorRows([floor('Ground', 'No floor plan image.')], [], placed(0), new Set());
  assert.equal(row.action, 'blocked');
  assert.equal(row.reason, 'No floor plan image.');
  assert.equal(row.ticked, false);
});

test('a second floor with the same name in the design is blocked', () => {
  const [first, second] = floorRows([floor('Ground'), floor('Ground')], [], placed(0), new Set());
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

const spot = { center: { lat: 1, lng: 2 }, rotation: 30 };

test('with the floors placed together, every floor uses the building placement', () => {
  const floors = [floor('Ground'), floor('First'), floor('Second')];
  const placements = effectivePlacements(new Map(), { together: true, placement: spot, count: floors.length });
  const rows = floorRows(floors, [], placements, new Set());
  assert.deepEqual(rows.map((row) => row.placed), [true, true, true]);
  assert.equal(placements.get(2), spot);
});

test('with the floors placed together and no building placement, no floor is placed, even one placed alone', () => {
  const floors = [floor('Ground'), floor('First')];
  const placements = effectivePlacements(new Map([[0, spot]]), { together: true, placement: null, count: floors.length });
  const rows = floorRows(floors, [], placements, new Set());
  assert.deepEqual(rows.map((row) => row.placed), [false, false]);
});

test('with the floors placed one by one, each floor keeps its own placement and the building one is ignored', () => {
  const placements = new Map([[1, spot]]);
  const building = { together: false, placement: { center: { lat: 5, lng: 6 }, rotation: 0 }, count: 2 };
  assert.equal(effectivePlacements(placements, building), placements);
});

// Each floor gets its own name, so none is blocked as a repeat.
const sizedFloors = (...sizes) => sizes.map(([widthM, lengthM, problem = null], i) =>
  ({ name: `Floor ${i}`, widthM, lengthM, image: null, problem }));

test('the building is placed with the outline of the largest ticked floor', () => {
  const floors = sizedFloors([10, 10], [20, 30], [15, 15]);
  assert.equal(buildingReferenceIndex(floors, floorRows(floors, [], new Map(), new Set())), 1);
});

test('a blocked or unticked floor is not the building outline while a ticked one qualifies', () => {
  const floors = sizedFloors([10, 10], [50, 50, 'The floor image is missing.'], [40, 40], [20, 20]);
  assert.equal(buildingReferenceIndex(floors, floorRows(floors, [], new Map(), new Set([2]))), 3);
});

test('with no ticked floor to use, the building outline is the largest floor that has a size in metres', () => {
  const noSize = 'The floor has no size in metres.';
  const floors = sizedFloors([10, 10], [null, null, noSize], [40, 40, 'The floor image is missing.'], [20, 20]);
  assert.equal(buildingReferenceIndex(floors, floorRows(floors, [], new Map(), new Set([0, 3]))), 2);
});

test('floors of equal size give the building outline to the first, and with no size in metres there is none', () => {
  const equal = sizedFloors([10, 20], [20, 10], [5, 5]);
  assert.equal(buildingReferenceIndex(equal, floorRows(equal, [], new Map(), new Set())), 0);
  const noSize = 'The floor has no size in metres.';
  const unsized = sizedFloors([null, null, noSize], [null, null, noSize]);
  assert.equal(buildingReferenceIndex(unsized, floorRows(unsized, [], new Map(), new Set())), null);
});

test('with the floors placed together, upload asks for the building to be placed', () => {
  const row = (ticked, placed, nameProblem = null) => ({ name: 'F', action: 'create', reason: null, placed, ticked, nameProblem });
  assert.deepEqual(uploadButton([row(true, false), row(true, false)], { together: true }),
    { enabled: false, label: 'Upload 2 floors', hint: 'Place the building on the map first.' });
  assert.equal(uploadButton([row(true, false)]).hint, 'Place every ticked floor on the map first.');
});

test('with the floors placed together, ticking and names are asked for before the building placement', () => {
  const row = (ticked, nameProblem) => ({ name: 'F', action: 'create', reason: null, placed: false, ticked, nameProblem });
  const together = { together: true };
  assert.equal(uploadButton([row(false, null)], together).hint, 'Tick at least one floor.');
  assert.equal(uploadButton([row(true, 'Enter a name.')], together).hint, 'Fix the floor names first.');
  assert.equal(uploadButton([row(true, null)], together).hint, 'Place the building on the map first.');
});
