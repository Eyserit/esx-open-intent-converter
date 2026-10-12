# Place access points on Meraki floor plans: design

Date: 2026-10-12
Status: awaiting review
Builds on: `docs/superpowers/specs/2026-10-11-meraki-upload-design.md` (the local Send to Meraki flow, already built on branch `meraki-upload`).

## Goal

After the Send to Meraki flow uploads the floor plans, it also places the design's access points on those floor plans in Meraki. Each design AP is matched to a real AP already claimed into the chosen network:

1. **by name** (case and surrounding spaces ignored);
2. failing that, **by BSSID**: the design AP's measured BSSIDs, from an Ekahau survey, compared with the BSSIDs each Meraki AP broadcasts.

A design AP with no measured BSSIDs is matched by name only. Matched APs are placed automatically, with no review step, and a results list follows.

### Out of scope

- Changing AP names, tags or notes in Meraki.
- Removing APs from floor plans, or claiming devices into the network.
- A review or confirm step before placing.
- Placing APs on floor plans uploaded in an earlier run.
- Anything on the public GitHub Pages site.
- Changes to the converters, and parity with `esx2oi.py` (unchanged).

## Decisions

| Topic | Decision |
|---|---|
| Fallback match | BSSID: any measured BSSID of the design AP equals a BSSID of exactly one Meraki AP |
| No measured BSSIDs | Name only. If the name doesn't match, the AP is unmatched |
| Which design APs | Only yours (`mine: true` in Ekahau; every AP from an Open Intent input), positioned on a floor that uploaded successfully in this run |
| Name comparison | Trimmed, case ignored. Inner characters are compared exactly |
| Ambiguity | A name matching 2+ Meraki APs is not a name match (it falls through to BSSID). A Meraki AP claimed by 2+ design APs is placed for none of them |
| When | Automatically, straight after the floor uploads, then a results list |
| Already-placed APs | Position check: an AP on a **different** floor plan is left alone; one on the floor plan just uploaded is moved only if it's more than 0.5 m from the design position (see Position check) |
| BSSID source | Ekahau survey data. Open Intent input has none, so it matches by name only |

## Facts checked

- **Ekahau survey `.esx`** (a private sample, git-ignored; no values are copied here):
  - `accessPoints.json` → `accessPoints[]` with `id`, `name`, `mine` (bool), `location` (`floorPlanId`, `coord {x, y}` in image pixels; missing when the AP is unplaced), `vendor`, `model`, `tags`, `hidden`, `status`, `userDefinedPosition`.
  - `measuredRadios.json` → `measuredRadios[]` with `id`, `accessPointId`, `accessPointMeasurementIds[]`, `status`.
  - `accessPointMeasurements.json` → `accessPointMeasurements[]` with `id`, `mac` (`aa:bb:cc:dd:ee:ff`: this is the BSSID), `ssid`, `security`, `technologies`, `channelByCenterFrequencyDefinedNarrowChannels`, `informationElements`, `status`.
  - The sample has 34 APs: 24 `mine`, 27 positioned. Every AP has 1–9 distinct BSSIDs.
  - Predictive designs, such as the earlier sample, have no `measuredRadios.json` or `accessPointMeasurements.json` at all.
  - Survey files may also include `buildings.json` / `buildingFloors.json`. These aren't used here.
- **Meraki** `GET /organizations/{organizationId}/wireless/ssids/statuses/byDevice`:
  - Query params: `networkIds[]`, `hideDisabled` (default true), `perPage` 3–500, `Link` paging.
  - Returns `{ items: [{ serial, name, network: { id, name }, basicServiceSets: [{ bssid, ssid: {…}, radio: {…} }] }], meta }`.
- **Meraki** `GET /networks/{networkId}/devices`: devices with `serial`, `name`, `model`, `lat`, `lng`, `floorPlanId`, and `productType` or a model prefix.
  - **To confirm while planning:** how to tell APs apart (`productType === 'wireless'` vs a model starting `MR`/`CW`).
- **Meraki** `PUT /devices/{serial}`: body fields `lat`, `lng`, `floorPlanId` (null detaches). None are required.

## Architecture

The existing units are unchanged except where listed.

| Unit | New/changed | Job |
|---|---|---|
| `src/design-aps.js` | new | `designApsFromEsx(entries)` and `designApsFromOpenIntent(design)` → `DesignAp[]` |
| `src/ap-match.js` | new | `matchAccessPoints(designAps, merakiAps)` → per-AP outcome |
| `src/geo.js` | changed | `apLatLng({ center, rotation, widthM, lengthM }, xM, yM)` → `{ lat, lng }` |
| `src/convert.js` | changed | Results also carry `designAps` (from `.esx` entries for the `.esx` direction, from the Open Intent design for the other) |
| `server/meraki-client.js` | changed | `listAccessPoints({ …ctx, organizationId, networkId })` → `[{ serial, name, bssids }]`; `placeAccessPoint({ …ctx, serial, lat, lng, floorPlanId })` |
| `server/meraki-routes.js` | changed | `/api/access-points` and `/api/access-points/place`, validated and allow-listed like the others |
| `src/meraki-messages.js` | changed | AP outcome labels and the summary line |
| `meraki-flow.js`, `styles.css` | changed | The AP phase on the Uploading screen, and the results on Finished |
| `tools/fake-meraki.mjs` | changed | Fake APs with names and BSSIDs, and the two new methods |
| `local-checks/survey.test.js` | new | Local-only: runs `designApsFromEsx` on a private survey file (`SURVEY_SAMPLE` env var, default `survey_sample.esx` in the repo root, git-ignored) and prints counts only |

### `DesignAp`

```
{ name: string, floorName: string, xM: number, yM: number, mine: boolean, bssids: string[] }
```

- `xM` and `yM` are metres from the floor image's **top-left**, with y pointing down (Ekahau's convention).
- From `.esx`: `x · metersPerUnit`, `y · metersPerUnit`, using the AP's floor's `metersPerUnit`. Unplaced APs (no `location`, or an unknown floor) are left out.
- From Open Intent: use the `meters` coordinate if present; otherwise pixels × (floor metres width / pixel width). Flip y back from Open Intent's bottom-left origin: `yM = lengthM − y`.
- `bssids` are lower-case, de-duplicated, from all measured radios of that AP. Open Intent input always has `[]`.
- `floorName` uses the same floor names as the Open Intent package the flow lists, so APs join to uploaded floors by name.

### Position

- `apLatLng` uses the same local flat approximation and rotation as `cornersFor`.
- The offset from the floor centre is `east = xM − widthM/2`, `north = lengthM/2 − yM`, rotated clockwise by `rotation`, then converted to degrees with 111 320 m per degree.
- An AP at the image's top-left gives exactly `cornersFor(...).topLeft`. A test pins this.
- The floor's placement is the one used for its upload: its own, or the building placement.

### Matching (`matchAccessPoints`)

Input: `DesignAp[]` (already filtered to the eligible APs), and `merakiAps: [{ serial, name, bssids }]`.

For each design AP:
1. **Name:** the Meraki APs whose `name.trim().toLowerCase()` equals the design name's. Exactly one → `{ by: 'name', serial }`.
2. **BSSID:** otherwise, if `bssids` isn't empty, the Meraki APs sharing at least one BSSID (lower-case). Exactly one → `{ by: 'bssid', serial }`.
3. **Otherwise unmatched**, with the reason:
   - `No access point named “<name>” in this network.` (no BSSIDs, no name match)
   - `<n> access points are named “<name>”.` (several name matches, no BSSIDs)
   - `No access point broadcasts this AP's BSSIDs.` (has BSSIDs, no name and no BSSID match)
   - `<n> access points broadcast this AP's BSSIDs.` (several BSSID matches)
4. **Claimed twice:** after step 3, any serial claimed by 2+ design APs → each becomes unmatched with `Matched the same Meraki access point as “<other design name>”.`

### Position check (`placementAction`)

A pure `placementAction(merakiAp, targetFloorPlanId, target, floorPlanNames)` in `src/ap-match.js`, run per matched AP before any PUT. `merakiAp` carries `floorPlanId`, `lat` and `lng` from the device list; `target` is the `{ lat, lng }` from `apLatLng`; `floorPlanNames` maps floor plan id → name (from the network's floor plans, already listed for the Floors step).

| The Meraki AP is currently… | Action | Result row |
|---|---|---|
| On no floor plan (`floorPlanId` null or missing) | `place` | `Placed (by name)` / `Placed (by BSSID) as <Meraki name>` |
| On the target floor plan, within **0.5 m** of `target` (same flat metres approximation as `geo.js`) | `none` | `Already in place` |
| On the target floor plan, further than 0.5 m away, or with no lat/lng | `move` | `Moved (by name)` / `Moved (by BSSID) as <Meraki name>` |
| On a **different** floor plan | `skip` | `Skipped: already placed on “<floor plan name>”, left as is.` (the id when the name is unknown) |

`place` and `move` both send the same PUT. Only the result label differs.

## The flow

1. **Floors:** the floors upload exactly as now.
2. **AP phase.** It runs only if any eligible design AP sits on a floor that uploaded successfully.
   - **Eligible:** `mine`, on a ticked floor that uploaded.
   - **Skipped and counted, with a reason:** `Not your access point.` / `Its floor wasn't uploaded.`
   - **Steps:**
     1. `POST /api/access-points` once.
     2. Match.
     3. For each matched AP in order: `POST /api/access-points/place` with `lat`, `lng` from `apLatLng`, and `floorPlanId` from that floor's upload result.
   - **Progress:** on the Uploading screen, below the floors: "Placing access points: 12 of 18".
   - A failure of one AP doesn't stop the rest.
   - If listing fails, the phase ends with `Couldn't list the network's access points: <reason>.` and nothing is placed.
3. **Finished:**
   - The existing floor summary.
   - A line: `<p> access points placed, <m> moved, <a> already in place, <u> not matched, <s> skipped.` (zero parts are left out; nothing is shown if there were no APs).
   - Failed placements are counted as `<f> failed`.
   - A `<details>` list "Access point results": one row per design AP with its name (Geist Mono) and its result:
     - `Placed (by name)` or `Placed (by BSSID) as <Meraki name>`;
     - `Moved (by name)` or `Moved (by BSSID) as <Meraki name>`;
     - `Already in place`;
     - `Not matched: <reason>`;
     - `Skipped: <reason>`;
     - `Failed: <Meraki's error>`.
4. **Back to floors** after failed floors keeps the existing behaviour. Retrying floors also re-runs the AP phase, but only for APs on the floors uploaded in that retry.

## Server

- **`listAccessPoints`:**
  1. `GET /networks/{networkId}/devices` (wireless APs only).
  2. `GET /organizations/{organizationId}/wireless/ssids/statuses/byDevice?networkIds[]={networkId}&hideDisabled=false&perPage=500`, paged with the existing Link cap.
  3. Join by serial: `{ serial, name: device.name ?? '', floorPlanId: device.floorPlanId ?? null, lat: device.lat ?? null, lng: device.lng ?? null, bssids: lower-case, de-duplicated }`. An AP that has no BSSID entry gets `bssids: []`.
  - The flow reuses the floor plan list it already fetched for the Floors step for `floorPlanNames`. If it was fetched before the uploads, it re-lists once after them, so the ids just created are known.
  - The route needs `organizationId` too. The flow already has it from the Network step.
- **`placeAccessPoint`:** `PUT /devices/{encodeURIComponent(serial)}` with `{ lat, lng, floorPlanId }`. Returns `{ serial }`.
- **Routes:**
  - `/api/access-points` needs `region`, `apiKey`, `organizationId`, `networkId` (strings).
  - `/api/access-points/place` needs `region`, `apiKey`, `serial`, `floorPlanId` (strings) and `lat`, `lng` (finite numbers).
  - Allow-listed fields only, errors redacted, timeouts and 429 retries as now. `PUT` gets the 600 s timeout like other writes.

## Errors

| Where | Message |
|---|---|
| Listing APs fails | `Couldn't list the network's access points: <reason>.` (floors stay uploaded) |
| Key lacks read access to wireless status (403) | Meraki's own text, through the existing redaction |
| One placement fails | `Failed: <Meraki's error>` on that AP's row |

## Testing

All tests use `node:test` with no packages, test-first and one at a time.

- **`tests/design-aps.test.js`.** Uses a **synthetic** survey fixture, hand-built zip entries with the real file's structure and made-up names, ids and BSSIDs. Nothing from the private file goes in the repo. Cases:
  - metre positions from pixels and `metersPerUnit`;
  - the `mine` flag carried through;
  - unplaced APs dropped;
  - BSSIDs collected through `measuredRadios` → `accessPointMeasurements`, lower-cased and de-duplicated;
  - an AP with no radios gets `[]`;
  - a predictive design with no survey files gets every `bssids` `[]`;
  - Open Intent input: meters coordinates, the pixel fallback and the y flip.
- **`tests/ap-match.test.js`** (`placementAction`): no floor plan → place; same floor plan within 0.5 m → none; same floor plan beyond 0.5 m or no lat/lng → move; a different floor plan → skip with its name, or the id when the name is unknown.
- **`tests/ap-match.test.js`** (`matchAccessPoints`):
  - a name match, ignoring case and surrounding spaces;
  - inner differences don't match;
  - duplicate Meraki names fall through to BSSID;
  - the BSSID match;
  - several BSSID matches;
  - no BSSIDs → name only;
  - each reason string, exact;
  - one Meraki AP claimed twice → both unmatched.
- **`tests/geo.test.js`:**
  - `apLatLng` at the top-left equals `cornersFor().topLeft` and at the centre equals the centre;
  - at 0° and 90°;
  - with metre accuracy within 5 cm.
- **`tests/meraki-client.test.js` / `tests/meraki-routes.test.js`:**
  - joining devices with BSSIDs (missing entries, case), paging, non-AP devices filtered out;
  - the place body and path encoding;
  - route validation and the allow-list.
- **`tests/meraki-messages.test.js`:** the summary line and the outcome labels.
- **`tests/convert.test.js`:** `designAps` is present in both directions.
- **By hand**, with fake-meraki gaining APs with names and BSSIDs: name and BSSID matches, unmatched and skipped rows, the progress, and the results list. Also keyboard use, phone width and contrast.
- **Local only:** `npm run test:survey` runs `local-checks/survey.test.js` on the private survey file and prints counts only (APs, mine, positioned, with BSSIDs).

## Done means

- Floors upload as before, and eligible APs are then placed automatically, by name or BSSID, at their design positions. An AP already on another floor plan is never moved, and one already in place isn't re-sent.
- The Finished screen reports every design AP's outcome.
- All tests pass, including the existing ones and the `esx2oi.py` parity checks. `npm run check` is clean.
- README and HANDOFF are updated: what matching does, BSSID comes from survey data, the 403 note, and the local survey check.
- No private data is in the repo.
