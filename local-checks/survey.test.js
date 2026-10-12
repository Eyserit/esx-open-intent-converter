// Local-only check against a real, private survey. survey_sample.esx is git-ignored; run with `npm run test:survey`.
// Prints counts only, never names or BSSIDs. Set SURVEY_SAMPLE to use a file elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { designApsFromEsx } from '../src/design-aps.js';
import { readZip } from '../src/zip.js';

const SURVEY_PATH = process.env.SURVEY_SAMPLE ?? new URL('../survey_sample.esx', import.meta.url);
const BSSID = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

test('survey: designApsFromEsx() reads BSSIDs from survey data', { skip: existsSync(SURVEY_PATH) ? false : 'survey_sample.esx not found (local-only check)' }, async (t) => {
  const aps = designApsFromEsx(await readZip(new Uint8Array(readFileSync(SURVEY_PATH))));
  const withBssids = aps.filter((ap) => ap.bssids.length > 0);
  t.diagnostic(`placed APs: ${aps.length}, mine: ${aps.filter((ap) => ap.mine).length}, with BSSIDs: ${withBssids.length}`);
  for (const ap of aps) for (const bssid of ap.bssids) assert.match(bssid, BSSID);
  assert.ok(withBssids.length > 0, 'expected at least one AP with BSSIDs');
});
