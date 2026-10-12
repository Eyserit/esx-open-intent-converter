# Place access points on Meraki floor plans: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after Send to Meraki uploads the floor plans, place the design's access points on them automatically. Match each one by name, then by surveyed BSSID, and list every AP's outcome on the Finished screen.

**Architecture:**
- Pure units read the design's APs (`src/design-aps.js`), match them and decide each placement (`src/ap-match.js`), and turn positions into lat/lng (`src/geo.js`).
- An injectable orchestrator, `src/ap-phase.js`, runs the phase, so ordering, failures and skips are unit-tested without a DOM.
- The relay gains two routes. `meraki-flow.js` only wires the phase in and draws it.

**Tech stack:** plain ES modules, Node 22+ `node:test`, no packages, no build step. The browser side is vanilla DOM.

**Spec:** `docs/superpowers/specs/2026-10-12-meraki-ap-placement-design.md`. Read it with this plan. The handover `docs/handovers/2026-10-12-meraki-ap-placement.md` has the project rules.

## Changes from the spec (for the user to approve with this plan)

1. **Meraki device list.** The spec named `GET /networks/{id}/devices`. Meraki's docs (checked 2026-10-12) mark it **deprecated**, and it has no `productType`. Instead:
   - `GET /organizations/{orgId}/devices?networkIds[]={networkId}&productTypes[]=wireless&perPage=1000` (paged) gives `serial`, `name`, `lat` and `lng` for wireless devices only. That answers the open "how to tell APs apart" question: Meraki filters them.
   - That endpoint has no `floorPlanId`. `GET /networks/{networkId}/floorPlans` lists each plan's `devices[]` (with `serial`), so a device's `floorPlanId` is the plan whose `devices` contains its serial.
   - The BSSID call is unchanged.
2. **`listAccessPoints` also returns the floor plans** (`{ accessPoints, floorPlans }`). It already fetches them, so the flow doesn't re-list them for `floorPlanNames`.
3. **`designAps` lives at `result.openintent.designAps`**, not at the top of the result. `app.js` already passes `result.openintent` to the flow, so `app.js` doesn't change.
4. **New `src/ap-phase.js`** (`runApPhase`) holds the phase logic that the spec placed in `meraki-flow.js`, so it can be tested.
5. **A missing `mine` field counts as yours.** Both private samples always have the field. The repo's synthetic `fixture.esx` doesn't, and an `.esx` without the field shouldn't lose every AP.
6. **Edge cases the spec didn't name** are decided in Review Focus below.

## Global constraints

- No npm packages and no build step. Tests use `node:test` and `node:assert/strict` only.
- **Converters are frozen:** don't change `src/esx-to-oi.js`, `src/oi-to-esx.js`, `src/zip.js`, `src/detect.js` or `src/fit-image.js`. `esx2oi.py` parity stays exact.
- **Private data:** never commit a private `.esx`, its filename or anything derived from it. Fixtures are synthetic. Local checks print counts only.
- **Copy:** UK English. Use curly quotes `“ ”` exactly where the spec has them, and a straight apostrophe in `AP's`, `wasn't` and `Couldn't`.
- **UI:**
  - write text only with `textContent`;
  - mark AP names `mono`, which renders in Geist Mono;
  - build the DOM once and update it in place;
  - the API key stays in the one module variable and is sent only through `api()`.
- **Relay:**
  - every route allow-lists its fields with `pick`;
  - errors are redacted through `MerakiError`;
  - GETs keep the 120 s timeout and the PUT gets the 600 s write timeout (the request core already does this);
  - 429 retries as now.
- **Matching rules (from the spec):**
  - names are compared with `trim().toLowerCase()`, and inner characters exactly;
  - BSSIDs are compared lower-case;
  - "already in place" means within **0.5 m** on the same floor plan.
- **Commits:**
  - prefix `behavior:` or `structure:`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - commit only when `npm test` and `npm run check` are clean.
- **Execution traps (from the handover):**
  - implementers do **no browser work**; they list browser checks for the controller;
  - run plain, separate git commands, with no `cd` or `&&` chains involving git;
  - put the report in the reply.

## Review focus

The five inputs most likely to bite that the spec doesn't name, and the decision for each. Each has a test in the task named.

1. **Two design floors share a name.** APs join floors by name, so an AP on such a floor can't be placed safely. It is skipped with `Two floors in this design are named “<floor>”.` (Task 9)
2. **Retrying failed floors.** On a retry, APs on floors uploaded in an earlier run of this flow are left out of the results. They aren't reported as `Its floor wasn't uploaded.` (Task 9)
3. **A Meraki error that already ends in a full stop.** `Couldn't list the network's access points: <reason>.` must not end in `..`. (Task 8)
4. **Empty names.** A design AP or Meraki AP whose trimmed name is `''` never matches by name. Unnamed Meraki APs are common, and `'' === ''` would wrongly match them. (Task 5)
5. **AP coordinates beyond the image edge.** In an `.esx`, these are clamped to the floor's pixel width and height before converting to metres, as the Open Intent output already does. Otherwise the AP would be sent off the plan. (Task 1)

---

## File map

| File | Status | Job |
|---|---|---|
| `src/design-aps.js` | new | `designApsFromEsx(entries)`, `designApsFromOpenIntent(design)` |
| `src/geo.js` | changed | `apLatLng`, `distanceM`; `cornersFor` reuses an extracted `pointAt` |
| `src/ap-match.js` | new | `matchAccessPoints`, `placementAction` |
| `src/ap-phase.js` | new | `runApPhase`: eligibility, list, match, position check, PUTs, progress |
| `src/meraki-messages.js` | changed | `apResultLabel`, `apSummary`, `apListError` |
| `src/convert.js` | changed | `openintent.designAps` in both directions |
| `server/meraki-client.js` | changed | `listAccessPoints`, `placeAccessPoint`; `getAllPages` takes an `itemsOf` |
| `server/meraki-routes.js` | changed | `/api/access-points`, `/api/access-points/place`; number fields |
| `meraki-flow.js`, `styles.css` | changed | Progress on Uploading, summary and `<details>` on Finished |
| `tools/fake-meraki.mjs` | changed | Stateful fake APs, the two methods |
| `tools/make-survey-fixture.mjs`, `tests/fixtures/survey-fixture.esx` | new | A synthetic survey `.esx` for convert tests and browser checks |
| `local-checks/survey.test.js`, `local-checks/sample.test.js`, `package.json` | new/changed | `npm run test:survey`; both local checks skip cleanly without their file |
| `README.md`, `docs/HANDOFF.md` | changed | Matching, BSSID source, the 403 note, the survey check |

Shared types (every task uses these names):

```
DesignAp   = { name: string, floorName: string, xM: number, yM: number, mine: boolean, bssids: string[] }
MerakiAp   = { serial: string, name: string, floorPlanId: string|null, lat: number|null, lng: number|null, bssids: string[] }
Match      = { serial: string, by: 'name'|'bssid' } | { serial: null, reason: string }
Action     = { action: 'place'|'move'|'none' } | { action: 'skip', reason: string }
ApResult   = { name, outcome: 'placed'|'moved', by: 'name'|'bssid', merakiName }
           | { name, outcome: 'in-place' }
           | { name, outcome: 'unmatched'|'skipped'|'failed', reason: string }
```

---

### Task 1: Design APs from an `.esx`

**Files:** create `src/design-aps.js` and `tests/design-aps.test.js`.

**Interfaces:**
- Produces `designApsFromEsx(entries: Map<string, Uint8Array>) → DesignAp[]`, in `accessPoints.json` order.

Rules:
- `name` is `ap.name || \`AP-${i}\`` (the same fallback as the converter).
- `floorName` is `floor.name || 'Floor'`, where the floor is `ap.location.floorPlanId`.
- `mine` is `ap.mine !== false`.
- Drop an AP when any of these holds: it has no `location.coord` with numeric `x`/`y`, its floor id isn't in `floorPlans.json`, or the floor's `metersPerUnit` isn't > 0.
- Clamp the pixels: `x` to `[0, f.width || f.cropMaxX]` and `y` to `[0, f.height || f.cropMaxY]`. Then `xM = x·mpu` and `yM = y·mpu` (top-left origin, y down).
- `bssids`: from each `measuredRadios[]` with `accessPointId === ap.id`, through `accessPointMeasurementIds` into `accessPointMeasurements[]` by `id`, take `mac`, lower-cased and de-duplicated in first-seen order.
- With no survey files, every `bssids` is `[]`. A missing `accessPoints.json` gives `[]`.

- [ ] **Step 1: Write the test helper and the first failing test**

```js
// tests/design-aps.test.js — synthetic entries only; nothing here comes from a real design.
const json = (value) => new TextEncoder().encode(JSON.stringify(value));
function esxEntries({ floors, aps, radios, measurements }) {
  const entries = new Map([['floorPlans.json', json({ floorPlans: floors })], ['accessPoints.json', json({ accessPoints: aps })]]);
  if (radios) entries.set('measuredRadios.json', json({ measuredRadios: radios }));
  if (measurements) entries.set('accessPointMeasurements.json', json({ accessPointMeasurements: measurements }));
  return entries;
}
const floor = { id: 'f1', name: 'Ground', metersPerUnit: 0.05, width: 400, height: 300 };

test('an .esx AP is placed in metres from the top-left of its floor', () => {
  const aps = designApsFromEsx(esxEntries({ floors: [floor], aps: [{ id: 'a1', name: 'AP-1', mine: true, location: { floorPlanId: 'f1', coord: { x: 100, y: 60 } } }] }));
  assert.deepEqual(aps, [{ name: 'AP-1', floorName: 'Ground', xM: 5, yM: 3, mine: true, bssids: [] }]);
});
```

- [ ] **Step 2:** run `node --test tests/design-aps.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3:** implement `designApsFromEsx` in `src/design-aps.js`. Read lists with a local JSON-reading helper; don't import from the frozen converters.
- [ ] **Step 4:** run `npm test`. Expected: all pass.
- [ ] **Step 5: Add one test at a time, each red then green.**
  - `'mine is carried through, and a missing mine counts as yours'`: `mine: false` → `false`; no key → `true`.
  - `'an AP with no location, an unknown floor or a floor with no scale is left out'`: three such APs → `[]`.
  - `'an AP beyond the image edge is clamped to the floor'`: coord `{ x: 9999, y: -5 }` → `xM: 20, yM: 0`.
  - `'BSSIDs come from measured radios, lower-cased and de-duplicated'`:
    - the AP has 2 radios;
    - the measurements have macs `'02:00:00:00:0A:01'`, `'02:00:00:00:0a:01'` and `'02:00:00:00:0a:02'`;
    - expect `bssids: ['02:00:00:00:0a:01', '02:00:00:00:0a:02']`;
    - another AP with no radios gets `[]`.
  - `'a predictive design with no survey files gives every AP no BSSIDs'`.
- [ ] **Step 6:** commit `behavior: read the design's access points and surveyed BSSIDs from an .esx`.

### Task 2: Design APs from Open Intent

**Files:** modify `src/design-aps.js` and `tests/design-aps.test.js`.

**Interfaces:**
- Produces `designApsFromOpenIntent(design) → DesignAp[]`, in `design.accesspoints` order.

Rules:
- `name` is `ap.name`, `floorName` is `ap.floorplan_name`, `mine` is `true` and `bssids` is `[]`.
- Floor sizes come from the `floorplans[]` entry with that name: its `dimensions` with `unit: 'meters'` (`width`, `length`) and `unit: 'pixels'`.
- Position:
  - If the AP has a `coordinate_xyz` with `unit: 'meters'`, then `xM = x` and `yM = lengthM − y`.
  - Otherwise, from the `pixels` coordinate: `xM = x·s` and `yM = lengthM − y·s`, where `s = widthM / pixelWidth`.
- Drop the AP if its floor has no metre size, or it has neither coordinate.

- [ ] **Step 1: Failing test** `'an Open Intent AP uses its metre coordinate with y flipped back to the top'`. The floor `'Ground'` has `meters` 20 × 15 and `pixels` 400 × 300. The AP has `coordinates: [{ coordinate_xyz: { x: 5, y: 12, z: 2.5, unit: 'meters' } }]`. Expect `[{ name: 'AP-1', floorName: 'Ground', xM: 5, yM: 3, mine: true, bssids: [] }]`.
- [ ] **Step 2:** run it. Expected: FAIL (not exported).
- [ ] **Step 3:** implement `designApsFromOpenIntent`.
- [ ] **Step 4:** run `npm test`. Expected: pass.
- [ ] **Step 5: Add one test at a time.**
  - `'without a metre coordinate the pixel one is scaled by the floor's width'`: pixels `{ x: 100, y: 240 }` → `xM: 5, yM: 3`.
  - `'an AP on a floor with no metre size, or with no coordinates, is left out'`.
- [ ] **Step 6:** commit `behavior: read the design's access points from Open Intent`.

### Task 3: Results carry `designAps`, plus a synthetic survey fixture

**Files:**
- Modify `src/convert.js` and `tests/convert.test.js`.
- Create `tools/make-survey-fixture.mjs` and `tests/fixtures/survey-fixture.esx`.

**Interfaces:**
- Consumes Tasks 1 and 2.
- Produces `result.openintent.designAps: DesignAp[]`:
  - `.esx` → OI: `designApsFromEsx(entries)`;
  - OI → `.esx`: `designApsFromOpenIntent(design)`.

`tools/make-survey-fixture.mjs` reads `tests/fixtures/fixture.esx` and keeps its floors and images. It replaces `accessPoints.json` and adds `measuredRadios.json` / `accessPointMeasurements.json`, then writes `tests/fixtures/survey-fixture.esx` with `writeZip`. The made-up APs, with ids `s1`…`s6`:

| name | mine | location | measured macs |
|---|---|---|---|
| `AP-A` | true | `fp-g` (100, 150) | `02:00:00:00:0a:01` |
| `Design-Hall` | true | `fp-g` (300, 100) | `02:00:00:00:0b:01`, `02:00:00:00:0B:02` |
| `Nowhere` | true | `fp-g` (50, 250) | `02:00:00:00:0f:01` |
| `Neighbour` | false | `fp-f` (320, 240) | `02:00:00:00:0c:01` |
| `Broken` | true | `fp-f` (100, 100) | none |
| `Unplaced` | true | no location | none |

Each AP keeps the other fields Ekahau writes, with made-up values (`vendor`, `model`, `tags: []`, `hidden: false`, `status: 'CREATED'`, `userDefinedPosition: true`), so the `.esx` → OI conversion still runs.

- [ ] **Step 1: Failing test.** Extend `'both directions hand back the Open Intent design and its images'` with:
  - `assert.deepEqual(esxResult.openintent.designAps.map((ap) => ap.name), ['AP-A', 'AP-B', 'AP-C'])`;
  - the same names for `oiResult.openintent.designAps`.
- [ ] **Step 2:** run it. Expected: FAIL (`designAps` undefined).
- [ ] **Step 3:** add `designAps` in `convertEsx` and `convertOpenIntent`.
- [ ] **Step 4:** run `npm test`. Expected: pass.
- [ ] **Step 5:** write and run `node tools/make-survey-fixture.mjs`. Add the test `'a survey .esx carries its BSSIDs through convert'`: `convert(surveyFixture, 's.esx', options)`, then the `Design-Hall` AP's `bssids` deep-equals `['02:00:00:00:0b:01', '02:00:00:00:0b:02']` and there are 5 design APs. Red first: run it before the fixture exists, and expect ENOENT.
- [ ] **Step 6:** run `npm test`, and run `git diff --stat` to confirm no `python-*.zip` fixture changed. Commit `behavior: hand the design's access points to the Meraki flow`.

### Task 4: AP position and distance in `geo.js`

**Files:** modify `src/geo.js` and `tests/geo.test.js`.

**Interfaces:**
- Produces:
  - `apLatLng({ center, rotation, widthM, lengthM }, xM, yM) → { lat, lng }`;
  - `distanceM(a: {lat,lng}, b: {lat,lng}) → number` (flat approximation, `metresPerDegreeLng(a.lat)`).

- [ ] **Step 1 (structure):** extract `pointAt(center, rotation, eastM, northM)` from `cornersFor`'s inner `at`, unexported, and use it in `cornersFor`. Run `npm test`, which must pass unchanged. Commit `structure: extract the rotated offset from cornersFor`.
- [ ] **Step 2: Failing test** `'an AP at the image's top-left lands on the plan's top-left corner'`:

```js
const plan = { center: centre, rotation: 30, widthM: 40, lengthM: 30 };
assert.deepEqual(apLatLng(plan, 0, 0), cornersFor(plan).topLeft);
```

- [ ] **Step 3:** run it. Expected: FAIL (not exported). Then implement `apLatLng` as `pointAt(center, rotation, xM − widthM/2, lengthM/2 − yM)`.
- [ ] **Step 4: Add one test at a time.**
  - `'an AP at the image's centre lands on the plan's centre'`.
  - `'at 90° an AP on the east edge lands south of the centre'`: at `(40, 15)`, `lat ≈ centre.lat − 20/111320` and `lng ≈ centre.lng`, within `1e-9`.
  - `'an AP's distance from the centre is right to 5 cm'`: at `(40, 0)` with rotation 0, the haversine distance (the file's existing `EARTH_RADIUS_M`) from `centre` is within 0.05 of `25`.
  - `'distanceM measures small flat distances'`: `distanceM(centre, offsetBy(centre, 0.3, 0.4))` is within `1e-6` of `0.5`.
- [ ] **Step 5:** run `npm test`, then commit `behavior: position access points on a placed floor`.

### Task 5: `matchAccessPoints`

**Files:** create `src/ap-match.js` and `tests/ap-match.test.js`.

**Interfaces:**
- Produces `matchAccessPoints(designAps: DesignAp[], merakiAps: MerakiAp[]) → Match[]`, aligned with `designAps`.

The algorithm, per design AP:
1. **Name.** `key = name.trim().toLowerCase()`. If `key !== ''`, collect the Meraki APs whose trimmed, lower-cased name equals `key`. Exactly one → `{ serial, by: 'name' }`.
2. **BSSID.** Otherwise, if `bssids.length > 0`, collect the Meraki APs sharing at least one lower-cased BSSID. Exactly one → `{ serial, by: 'bssid' }`. None → `No access point broadcasts this AP's BSSIDs.` n ≥ 2 → `${n} access points broadcast this AP's BSSIDs.`
3. **No BSSIDs.** 0 name hits → `No access point named “${name}” in this network.` n ≥ 2 → `${n} access points are named “${name}”.`
4. **Claimed twice.** After all APs, any serial in 2+ matches makes each of those `{ serial: null, reason: \`Matched the same Meraki access point as “${other}”.\` }`. `other` is the first *other* design AP, in input order, that claimed it.

- [ ] **Step 1: Failing test** `'a name matches ignoring case and surrounding spaces'`: design `'AP-1'` and Meraki `' ap-1 '` → `[{ serial: 'Q1', by: 'name' }]`.
- [ ] **Step 2:** run it. Expected: FAIL (module not found). **Step 3:** implement. **Step 4:** run `npm test`.
- [ ] **Step 5: Add one test at a time.** Each reason string is asserted exactly.
  - `'inner differences don't match'`: `'AP 1'` vs `'AP-1'`, no BSSIDs, gives `No access point named “AP 1” in this network.`
  - `'two Meraki APs with the name fall through to BSSID'`: they match by BSSID on `'02:00:00:00:00:01'` against Meraki's `'02:00:00:00:00:01'`, so `by: 'bssid'`.
  - `'a BSSID match ignores case'`: design `'02:00:00:00:0a:01'` vs Meraki `'02:00:00:00:0A:01'`.
  - `'several BSSID matches leave the AP unmatched'`: gives `2 access points broadcast this AP's BSSIDs.`
  - `'no BSSID match gives its reason'`: `No access point broadcasts this AP's BSSIDs.`
  - `'with no BSSIDs, duplicate names give the count'`: `2 access points are named “AP-1”.`
  - `'an empty name never matches by name'`: design `'  '` and a Meraki AP named `''` → `No access point named “  ” in this network.` (Review focus 4.)
  - `'one Meraki AP claimed by two design APs is placed for neither'`: `AP-1` by name and `AP-2` by BSSID both hit `Q1`, giving `Matched the same Meraki access point as “AP-2”.` and `… as “AP-1”.`
- [ ] **Step 6:** commit `behavior: match design access points to Meraki by name, then BSSID`.

### Task 6: `placementAction`

**Files:** modify `src/ap-match.js` and `tests/ap-match.test.js`.

**Interfaces:**
- Consumes `distanceM` (Task 4).
- Produces `placementAction(merakiAp: MerakiAp, targetFloorPlanId: string, target: {lat,lng}, floorPlanNames: Map<string,string>) → Action`.

The rules, in order:
- `floorPlanId` null or missing → `place`.
- A different id → `skip`, with the reason `` `already placed on “${floorPlanNames.get(id) ?? id}”, left as is.` ``
- Same id, and `lat` or `lng` not finite → `move`.
- `distanceM(ap, target) <= 0.5` → `none`.
- Otherwise → `move`.

- [ ] **Step 1: Failing test** `'an AP on no floor plan is placed'`. **Step 2:** run it, expect FAIL. **Step 3:** implement. **Step 4:** `npm test`.
- [ ] **Step 5: Add one test at a time.**
  - `'on the target plan within 0.5 m nothing is sent'`: `offsetBy(target, 0.3, 0.3)` → `none`.
  - `'on the target plan beyond 0.5 m it moves'`: `offsetBy(target, 0, 0.6)` → `move`.
  - `'on the target plan with no position it moves'`.
  - `'on another plan it is skipped with that plan's name'`: `already placed on “Level 2”, left as is.`
  - `'on an unknown plan the id stands in for its name'`.
- [ ] **Step 6:** commit `behavior: leave access points already in place or on another floor plan alone`.

### Task 7: Relay: list and place access points

**Files:**
- Modify `server/meraki-client.js` and `tests/meraki-client.test.js`.
- Modify `server/meraki-routes.js` and `tests/meraki-routes.test.js`.

**Interfaces:**
- Produces, on the client:
  - `listAccessPoints({ organizationId, networkId, ...ctx }) → { accessPoints: MerakiAp[], floorPlans: [{ id, name }] }`;
  - `placeAccessPoint({ serial, lat, lng, floorPlanId, ...ctx }) → { serial }`.
- Produces routes:
  - `/api/access-points` (`organizationId`, `networkId`);
  - `/api/access-points/place` (`serial`, `floorPlanId` strings; `lat`, `lng` finite numbers).
- Both routes also need `region` and `apiKey`.

The calls, with `n = encodeURIComponent(networkId)` and `o = encodeURIComponent(organizationId)`:
1. `getAllPages(ctx, \`/organizations/${o}/devices?networkIds[]=${n}&productTypes[]=wireless&perPage=1000\`)`.
2. `request(ctx, 'GET', \`/networks/${n}/floorPlans\`)`. A device's `floorPlanId` is the plan whose `devices[]` holds its serial.
3. `getAllPages(ctx, \`/organizations/${o}/wireless/ssids/statuses/byDevice?networkIds[]=${n}&hideDisabled=false&perPage=500\`, (json) => json.items)`. For this, `getAllPages(ctx, path, itemsOf = (json) => json)` gains the `itemsOf` parameter; make that change as its own `structure:` commit first.
4. The join, per device: `{ serial, name: name ?? '', floorPlanId: … ?? null, lat: lat ?? null, lng: lng ?? null, bssids }`, where `bssids` is the `basicServiceSets[].bssid` values, lower-cased and de-duplicated, or `[]`.

`placeAccessPoint` sends `PUT /devices/${encodeURIComponent(serial)}` with exactly `{ lat, lng, floorPlanId }`.

In routes, add `const NUMBERS = ['lat', 'lng']`. `isValidField` checks those with `Number.isFinite`. Corners and strings work as now.

- [ ] **Step 1 (structure):** add `itemsOf` to `getAllPages`. Run `npm test` (no behaviour change), then commit `structure: let paging read items out of a wrapper object`.
- [ ] **Step 2: Failing client test** `'access points join devices, floor plans and BSSIDs by serial'`. Use a `fakeFetch` queue of devices, then plans (`[{ floorPlanId: 'fp1', name: 'Ground', devices: [{ serial: 'Q1' }] }]`), then `{ items: [{ serial: 'Q1', basicServiceSets: [{ bssid: '02:00:00:00:0A:01' }, { bssid: '02:00:00:00:0a:01' }] }] }`. Assert:
  - the three exact URLs, starting `https://api.meraki.com/api/v1`;
  - Q1 → `{ serial: 'Q1', name: 'AP-1', floorPlanId: 'fp1', lat: 53.1, lng: -6.2, bssids: ['02:00:00:00:0a:01'] }`;
  - `floorPlans` deep-equals `[{ id: 'fp1', name: 'Ground' }]`.
- [ ] **Step 3:** run it, expect FAIL. Implement. Run `npm test`.
- [ ] **Step 4: Add one test at a time.**
  - `'an AP with no BSSID entry, name or position gets empty values'` (`name: ''`, nulls, `bssids: []`).
  - `'BSSID pages follow Link'`: the second byDevice page arrives via `Link`, and its BSSIDs are joined.
  - `'placing an AP PUTs lat, lng and floorPlanId to the encoded serial'`: serial `'Q2XX/1'` → URL ends `/devices/Q2XX%2F1`, `method: 'PUT'`, and the body JSON deep-equals `{ lat: 53.1, lng: -6.2, floorPlanId: 'fp1' }`.
- [ ] **Step 5: Routes, one test at a time.**
  - Add both routes to the test's `bodies` table and both method names to `fakeClient`'s list, so the existing table-driven tests (missing fields, allow-list, error redaction) cover them. Run, and expect FAIL until the routes exist.
  - `'place needs lat and lng as finite numbers'`: `lat: '53.1'` → 400 `Missing or invalid lat.`; `lng: null` → 400 `Missing or invalid lng.` (the route handler receives parsed JSON, where NaN arrives as `null`)
  - `'extra fields never reach the client'`: an `extra: 'x'` field on each new route is absent from `args`.
- [ ] **Step 6:** run `npm test` and `npm run check`. Commit `behavior: list and place a network's access points through the relay`.

### Task 8: Result copy

**Files:** modify `src/meraki-messages.js` and `tests/meraki-messages.test.js`.

**Interfaces:**
- Produces:
  - `apResultLabel(result: ApResult) → string`;
  - `apSummary(results: ApResult[]) → string | null`;
  - `apListError(message: string) → string`.

The labels, exact:

| result | label |
|---|---|
| placed, by name | `Placed (by name)` |
| placed, by BSSID | `Placed (by BSSID) as <merakiName>` |
| moved | `Moved (by name)` or `Moved (by BSSID) as <merakiName>` |
| in-place | `Already in place` |
| unmatched | `Not matched: <reason>` |
| skipped | `Skipped: <reason>` |
| failed | `Failed: <reason>` |

`apSummary`:
- The parts, in order: `placed`, `moved`, `already in place`, `not matched`, `skipped`, `failed`. Zero parts are left out.
- The first part carries the noun: `access point` when its count is 1, else `access points`. The parts are joined with `, ` and end with `.`.
- Empty results → `null`.

`apListError(message)` → `` `Couldn't list the network's access points: ${message.replace(/\.$/, '')}.` ``

- [ ] **Step 1: Failing test** `'AP result labels'`: assert all seven rows above. **Step 2:** run it, expect FAIL. **Step 3:** implement. **Step 4:** `npm test`.
- [ ] **Step 5: Add one test at a time.**
  - `'the AP summary counts each outcome and leaves out zeros'`: 3 placed, 1 moved and 2 unmatched give `3 access points placed, 1 moved, 2 not matched.`
  - `'the AP summary uses the singular for one'`: 1 in-place gives `1 access point already in place.`; 1 skipped and 2 failed give `1 access point skipped, 2 failed.`
  - `'no APs, no summary'`: `null`.
  - `'a listing error never ends in two full stops'`: `apListError('Something went wrong talking to Meraki.')` gives `Couldn't list the network's access points: Something went wrong talking to Meraki.` (Review focus 3.)
- [ ] **Step 6:** commit `behavior: word the access point results`.

### Task 9: `runApPhase`

**Files:** create `src/ap-phase.js` and `tests/ap-phase.test.js`.

**Interfaces:**
- Consumes `apLatLng` (Task 4), `matchAccessPoints` and `placementAction` (Tasks 5–6), and `apListError` (Task 8).
- Produces:

```
runApPhase({
  designAps,          // DesignAp[]
  floors,             // [{ name, widthM, lengthM }] by design floor index
  uploaded,           // Map<floorIndex, { floorPlanId, placement: { center, rotation } }>, this run's successes
  earlier,            // Set<floorIndex> uploaded in an earlier run of this flow
  listAccessPoints,   // () => Promise<{ accessPoints: MerakiAp[], floorPlans: [{ id, name }] }>
  placeAccessPoint,   // ({ serial, lat, lng, floorPlanId }) => Promise<unknown>; rejects with Error(message)
  onProgress,         // (done: number, total: number) => void
}) → Promise<{ results: ApResult[], listError: string | null }>
```

The steps, in order:

1. **Eligibility**, per design AP in order:
   - `!mine` → skipped, `Not your access point.`
   - Its `floorName` names 2+ floors in `floors` → skipped, `Two floors in this design are named “${floorName}”.`
   - Its single floor index is in `uploaded` → eligible.
   - The index is in `earlier` → left out of `results`.
   - Otherwise → skipped, `Its floor wasn't uploaded.`
2. **No eligible APs:** return without calling `listAccessPoints`.
3. **Listing:**
   - Call `listAccessPoints()` once.
   - If it rejects, return the skipped results plus `listError: apListError(error.message)`.
   - Otherwise, match the eligible APs. For each match, compute `target = apLatLng({ ...placement, widthM, lengthM }, xM, yM)` and run `placementAction` with `floorPlanNames = new Map(floorPlans.map(p => [p.id, p.name]))`.
   - The outcomes: unmatched → `unmatched`, `none` → `in-place` and `skip` → `skipped`.
4. **Placing:**
   - Call `onProgress(0, total)`, where `total` is the number of `place`/`move` actions.
   - PUT them one at a time, in design order. Call `onProgress(i + 1, total)` after each, whatever its outcome.
   - Success → `placed`/`moved` with `by` and `merakiName` (the Meraki AP's name).
   - Rejection → `failed` with `error.message`, and the loop continues.
5. **`results`** are in design-AP order.

- [ ] **Step 1: Failing test** `'a matched AP on an uploaded floor is placed at its design position'`. One floor `{ name: 'Ground', widthM: 40, lengthM: 30 }` is uploaded to `fp1` at `centre`/0°. The design AP is at (0, 0). Meraki `Q1` has the same name and is unplaced. Assert `placeAccessPoint` was called with `{ serial: 'Q1', ...cornersFor(...).topLeft, floorPlanId: 'fp1' }`, and the results are `[{ name: 'AP-1', outcome: 'placed', by: 'name', merakiName: 'AP-1' }]`.
- [ ] **Step 2:** run it, expect FAIL. **Step 3:** implement. **Step 4:** `npm test`.
- [ ] **Step 5: Add one test at a time.**
  - `'APs that aren't yours or whose floor wasn't uploaded are skipped with a reason'`.
  - `'with nothing eligible, Meraki is never asked'`: `listAccessPoints` is not called.
  - `'one failed placement doesn't stop the rest'`: the first PUT rejects `new Error('Bad serial.')`, giving `failed` / `Bad serial.`, and the second is placed.
  - `'progress counts the placements sent'`: the calls are `[[0,2],[1,2],[2,2]]`, and an `in-place` AP isn't counted.
  - `'a listing failure places nothing and says why'`: `listError` equals `apListError('Forbidden.')`, `placeAccessPoint` is never called, and the skipped rows are kept.
  - `'an AP on a floor whose name two design floors share is skipped'`. (Review focus 1.)
  - `'on a retry, APs on floors uploaded earlier are left out'`: floor 0 is in `earlier` and floor 1 in `uploaded`, so only floor 1's AP appears. (Review focus 2.)
  - `'already in place, moved and skipped come through as outcomes'`.
- [ ] **Step 6:** commit `behavior: run the access point phase after the floors upload`.

### Task 10: The flow, its styles and the fake Meraki

**Files:** modify `meraki-flow.js`, `styles.css` and `tools/fake-meraki.mjs`.

**Interfaces:**
- Consumes `runApPhase` (Task 9), `apResultLabel`, `apSummary` (Task 8), `openintent.designAps` (Task 3), and the routes (Task 7).

Changes in `meraki-flow.js`:
- **`uploadFloor`** also returns `floorPlanId` from the upload response.
- **Earlier uploads:** add `const uploadedEarlier = new Set()` in `startMerakiFlow`. After each run, add the indexes of the floors that uploaded.
- **After the floor loop in `uploadStep`:** add a `detail('')` progress line below the list. Then call `runApPhase` with:
  - `designAps: openintent.designAps`;
  - `floors`;
  - `uploaded`, built from this run's successful results and `placed.get(index)`;
  - `earlier: uploadedEarlier`;
  - `listAccessPoints: () => api('api/access-points', { organizationId, networkId: network.id })`;
  - `placeAccessPoint: (body) => api('api/access-points/place', body)`;
  - `onProgress`, which writes `Placing access points: ${done} of ${total}` and `announce`s it at the start and the end only (not on every AP).
  - Pass `{ results: apResults, listError }` to `finishedStep`.
- **`finishedStep`:** after the counts, show:
  - `detail(apSummary(apResults))` when it isn't null;
  - `detail(listError)` when it is set;
  - when `apResults` isn't empty, `<details class="ap-results"><summary>Access point results</summary><ul class="floor-list">…`, with one `li.floor-row` per result: `el('span', { className: 'floor-name' }, mono(name))` and a `tag` with `apResultLabel(result)`. Add `tag-placed` for placed, moved and in-place, and `tag-failed` for failed.
  - Add the summary to the `announce`.
- **`styles.css`:** style `.ap-results` and its `summary` from existing tokens. The summary needs a visible focus ring. Long labels must wrap at 375 px with no horizontal scroll.

Changes in `tools/fake-meraki.mjs`, a stateful fake:
- **The APs** (serial: name):
  - `Q2XX-0001`: `'ap-a '`;
  - `Q2XX-0002` and `Q2XX-0003`: both `'AP-B'`;
  - `Q2XX-0004`: `'AP-C'`, on `fp-l2-a`, at the lat/lng of Dublin;
  - `Q2XX-0005`: `'Hall MR'`, with BSSIDs `['02:00:00:00:0b:02']`;
  - `Q2XX-0006`: `'Broken'`.
- **`listAccessPoints`** returns `{ accessPoints, floorPlans: PLANS plus created ones }`.
- **`placeAccessPoint`** stores the AP's `lat`, `lng` and `floorPlanId`. For `Broken`, it throws `new MerakiError(400, 'Fake placement failure.')`. Remember the plans `uploadFloorPlan` creates, so `floorPlanNames` knows them.
- Update the file's header comment to list the APs.

- [ ] **Step 1:** make the changes. Run `npm test` and `npm run check`, which must be clean (there are no new unit tests; the logic is already tested in Tasks 4–9).
- [ ] **Step 2:** list the browser checks below for the controller, who runs them in the browser pane with `PORT=8123 node tools/fake-meraki.mjs`. The implementer doesn't run them.
  1. **`tests/fixtures/fixture.esx`**, upload Ground and First floor. Expect `AP-A` `Placed (by name)`; `AP-B` `Not matched: 2 access points are named “AP-B”.`; `AP-C` `Skipped: already placed on “Level 2”, left as is.`
  2. **The same file again, same placement.** `AP-A` is `Already in place`. Moving the floor on the map then gives `Moved (by name)`.
  3. **`tests/fixtures/survey-fixture.esx`.** Expect:
     - `Design-Hall` `Placed (by BSSID) as Hall MR`;
     - `Nowhere` `Not matched: No access point broadcasts this AP's BSSIDs.`;
     - `Neighbour` `Skipped: Not your access point.`;
     - `Broken` `Failed: Fake placement failure.`;
     - `Unplaced` absent.
  4. **Progress:** `Placing access points: n of m` is shown during the phase and announced.
  5. **Finished:** the summary line is right. The `<details>` opens with the keyboard (Tab, Enter) and shows a focus ring.
  6. **Retry:** a floor named `Rate` fails, then Back to floors and upload again. Only that floor's APs are in the new results.
  7. **Phone width (375 px):** no horizontal scroll, and labels wrap. Contrast of the tags is in light and dark.
- [ ] **Step 3:** commit `behavior: place access points after the floors upload and list the results`.

### Task 11: Local survey check and docs

**Files:**
- Create `local-checks/survey.test.js`.
- Modify `local-checks/sample.test.js`, `package.json`, `README.md` and `docs/HANDOFF.md`.

**Interfaces:**
- Consumes `designApsFromEsx` (Task 1).

`survey.test.js`:
- The path is `process.env.SURVEY_SAMPLE ?? new URL('../survey_sample.esx', import.meta.url)`.
- The test is `test('survey: …', { skip: existsSync(path) ? false : 'survey_sample.esx not found (local-only check)' }, …)`.
- It reads the file with `readZip`, runs `designApsFromEsx` and prints, with `t.diagnostic`, **counts only**: placed APs, mine, and with BSSIDs.
- It asserts that every BSSID matches `/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/`, and that at least one AP has BSSIDs.

`sample.test.js` gets the same `skip` pattern instead of failing when `ekahau_sample.esx` is missing. Add `"test:survey": "node --test local-checks/survey.test.js"` to `package.json`.

- [ ] **Step 1:** write `survey.test.js`. With no file, `npm run test:survey` reports the test as skipped. Commit `behavior: add a local-only check of a private survey file`.
- [ ] **Step 2:** switch `sample.test.js` to skipping. Check that, with neither file present, `npm run test:sample` shows the tests skipped, not failed. Commit `behavior: skip local checks cleanly when their private file is missing`.
- [ ] **Step 3:** the controller symlinks the private files (see the handover) and runs `npm run test:sample` and `npm run test:survey`. Expect the sample 3/3 and the survey counts printed. Remove the links afterwards and confirm `git status` is clean of them.
- [ ] **Step 4:** update `README.md` and `docs/HANDOFF.md`:
  - AP placement and its matching order;
  - BSSIDs come from Ekahau survey data only;
  - a 403 on the BSSID call means the key lacks read access to wireless status;
  - the new endpoints, including why `/networks/{id}/devices` isn't used;
  - `npm run test:survey`, and the test count.
  
  Commit `structure: document access point placement`.

## Finishing (CLAUDE.md, in order)

1. **Simplify:** run the `code-simplifier:code-simplifier` agent on the files changed in this build, and commit its changes as `structure: simplify`.
2. **Verify:** run `npm test`, `npm run check`, and `npm run test:sample` + `npm run test:survey` (with the symlinks), and report the real output.
3. **Review:** an opus whole-branch review. Name these risks:
   - the key leaking through the new routes;
   - an allow-list bypass on `/api/access-points/place`;
   - an AP on another floor plan being moved;
   - a stale reply drawing over a newer step.
4. **Finish:** use `superpowers:finishing-a-development-branch`. **Ask before any push or merge.**
5. **Summarise** what changed, how it was tested, what the simplifier changed, what is left, and any assumptions.
