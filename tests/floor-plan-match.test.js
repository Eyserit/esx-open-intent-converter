import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchFloorPlan, duplicatePlansMessage } from '../src/floor-plan-match.js';

test('no match creates', () => {
  assert.deepEqual(matchFloorPlan('Level 1', [{ id: 'a', name: 'Level 2' }]), { action: 'create' });
});

test('one exact match updates that plan', () => {
  const plans = [{ id: 'a', name: 'Level 2' }, { id: 'b', name: 'Level 1' }];
  assert.deepEqual(matchFloorPlan('Level 1', plans), { action: 'update', id: 'b' });
});

test('case and spaces must match exactly', () => {
  const plans = [{ id: 'a', name: 'Level 1' }];
  assert.deepEqual(matchFloorPlan('level 1', plans), { action: 'create' });
  assert.deepEqual(matchFloorPlan('Level 1 ', plans), { action: 'create' });
});

test('two matches block with the count', () => {
  const plans = [{ id: 'a', name: 'Level 1' }, { id: 'b', name: 'Level 1' }, { id: 'c', name: 'Other' }];
  assert.deepEqual(matchFloorPlan('Level 1', plans), { action: 'blocked', count: 2 });
});

test('duplicate plans message names the count and the plan', () => {
  assert.equal(
    duplicatePlansMessage('Level 2', 2),
    '2 floor plans named “Level 2” in this network: rename one in Dashboard.',
  );
});
