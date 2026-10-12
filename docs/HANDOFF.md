# Handoff: Ekahau .esx ⇄ Open Intent converter

Last updated 2026-10-12. Read this first when picking the project up in a new session.

## What it is

A single static web page that converts one dropped file between an Ekahau `.esx` design and an Open Intent `.zip`, entirely in the browser. Nothing is uploaded or stored. The direction is detected from the file's contents, not its name.

- **Live site:** https://eyserit.github.io/esx-open-intent-converter/
- **Repository:** https://github.com/Eyserit/esx-open-intent-converter (public, GitHub Pages serves `main` from the repo root)
- **Local checkout:** `/Users/joseph.leonard/Desktop/Claude/converter`
- **Status:** working end to end. Accepted in Ekahau (Open Intent → `.esx`) and in Hamina (`.esx` → Open Intent, after the 8000 px fix below).

## Ground rules for the next session

- Follow the build method in `/Users/joseph.leonard/Desktop/Claude/CLAUDE.md`: test-first, one failing test at a time, `structure:` / `behavior:` commit prefixes, never weaken a test, run the code-simplifier before finishing.
- **The repo is public.** Never commit a real design, a floor plan, or anything derived from one (names, images, coordinates). `.gitignore` blocks every `.esx` except `tests/fixtures/`. The only real-design data allowed is the antenna patterns in `src/antenna-library.json` (agreed as public).
- Plain HTML/CSS/JS ES modules. No npm packages, no build step. The only third-party JS is Leaflet 1.9.4, vendored unchanged in `vendor/leaflet/` (see its `SOURCE.md`). The public site's only external request is the Geist font from Google Fonts. The local Meraki flow also calls OpenStreetMap tiles and Nominatim.
- The Meraki upload is local only (`npm start`). The GitHub Pages site must keep working without the server, so the Meraki step must stay hidden there.
- Pushing to `main` deploys the live site within about a minute. Ask the user before pushing.

## Running and testing

```sh
python3 -m http.server 8000          # converter only, then open http://localhost:8000
npm start                            # converter plus the Meraki relay on http://localhost:8000 (PORT overrides)
PORT=8123 node tools/fake-meraki.mjs # page against a fake Meraki, API key test-key
npm test                             # 285 tests, node:test, no packages (Node 22+, built on Node 26)
npm run check                        # node --check on every .js/.mjs
npm run test:sample                  # local only: parity and round trip on the private sample
npm run test:survey                  # local only: BSSIDs read from the private survey sample (counts only)
```

- `npm run test:sample` needs `ekahau_sample.esx` in the repo root (git-ignored, private, never commit it) and `.venv` with Pillow (`python3 -m venv .venv && .venv/bin/pip install pillow`). It runs the original `esx2oi.py` and compares.
- `npm run test:survey` needs `survey_sample.esx` in the repo root (git-ignored, private; `SURVEY_SAMPLE` overrides the path). It prints counts only. With either private file missing, its local check is skipped, not failed.
- Regenerate fixtures with `.venv/bin/python tools/make-fixture.py`. Note it also rewrites the `python-*.zip` fixtures with new timestamps; restore those with `git checkout` if you didn't mean to change them.
- In the Claude desktop app, the workspace `.claude/launch.json` has a `converter` preview entry serving this folder on port 8000.

## How it fits together

| File | Job |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page: one card, states Idle / Dragging / Converting / Done / Not supported. `app.js` only knows `convert()` and `cardFor()`. |
| `src/convert.js` | Entry point: read zip → detect → convert → (Hamina fit) → write zip. Reports progress stages. |
| `src/zip.js` | Hand-written zip reader/writer on the browser's `deflate-raw` streams. Rejects Zip64 and encryption. |
| `src/detect.js` | `.esx` = top-level `floorPlans.json` + `project.json`; Open Intent = any top-level `.json` with `openintent_version`. |
| `src/esx-to-oi.js` | JavaScript port of `esx2oi.py` (Apache-2.0). Must stay at exact parity with it; don't change float order, rounding or skip paths. Two deliberate differences: each floor uses its own `image-<imageId>` when present, and the wall files (`wallSegments.json`, `wallPoints.json`, `wallTypes.json`) are optional, because Ekahau leaves them out when no walls are drawn (`esx2oi.py` stops with "missing"). |
| `src/fit-image.js` | Shrinks plans over 8000 px for Hamina (see below). Runs after the port, so parity is unaffected. |
| `src/oi-to-esx.js` | Open Intent → `.esx`: floors, walls, APs, radios, antenna types. |
| `src/antennas.js`, `src/antenna-library.json` | Real antenna patterns by vendor/model/band, or a generated flat "generic omni" pattern. |
| `src/messages.js` | All card copy (pure, tested). |
| `src/browser-images.js` | Canvas-based decode / PNG encode / resize. Node tests use `tests/helpers/node-images.js` instead. |
| `server/start.js`, `server/server.js` | `npm start`. Static files plus POST routes, bound to 127.0.0.1 only. 140 MB request body cap (a 100 MB file base64-encoded fits); the 100 MB file cap is in `src/convert.js` and `app.js`. |
| `server/meraki-routes.js` | The `/api/...` routes (organisations, networks, floor plans, upload, `/api/access-points` and `/api/access-points/place`). Pure validation, then the client. |
| `server/meraki-client.js`, `server/meraki-request.js` | Calls to the Dashboard API: paging, retries on rate limits, upload. The relay refuses redirects and paging URLs outside the region's https domain. |
| `meraki-flow.js` | Browser side of the Send to Meraki steps (key, network, floors, map, Uploading, access point results, Finished). Uploading has no Back, by design. Finished has Disconnect, which returns to the Done card with the download kept. |
| `map-place.js` | The Leaflet map dialog: search, drag, rotate. |
| `src/meraki-regions.js`, `src/meraki-messages.js` | Region list and the flow's card copy (pure, tested). |
| `src/floors.js`, `src/floor-plan-match.js`, `src/geo.js` | Pure helpers: floor selection, exact-name matching and duplicate detection, outline corners and rotation maths. |
| `src/design-aps.js` | The design's APs as `{ name, floorName, xM, yM, mine, bssids }`: from an `.esx` (BSSIDs via `measuredRadios` → `accessPointMeasurements`) or from Open Intent (no BSSIDs). Handed on as `result.openintent.designAps`. |
| `src/ap-match.js` | `matchAccessPoints` (name, then BSSID, with ambiguity and double-claim rules) and `placementAction` (place, move, none or skip; 0.5 m tolerance). |
| `src/ap-phase.js` | `runApPhase`: the access point phase after the floor uploads (list, match, place, collect results), kept out of `meraki-flow.js` so it can be tested. |
| `tools/fake-meraki.mjs` | Fake Meraki behind the real routes, including a few fake APs with BSSIDs. A floor named "Rate" gets a rate-limit error on its first upload. |
| `tools/make-survey-fixture.mjs` | Builds `tests/fixtures/survey-fixture.esx`: synthetic APs and survey measurements on `fixture.esx`'s floors. |
| `vendor/leaflet/` | Leaflet 1.9.4 with its licence. |
| `src/errors.js` | Only `NotSupportedError` and `ConversionError(reason)` may escape `convert()`. Reasons are standalone phrases shown after "…couldn't be converted: ". |
| `esx2oi.py`, `LICENSE` | The reference implementation, kept for attribution and the parity tests. Not loaded by the page. |

Design docs: `docs/superpowers/specs/2026-10-11-wireless-design-converter-design.md` (the spec) and `docs/superpowers/plans/2026-10-11-wireless-design-converter.md` (the plan, with its refinements).

## Hard-won facts (don't rediscover these)

**Ekahau (.esx), proven by probe files opened in Ekahau:**
- Every AP needs at least one simulated radio, or it doesn't appear.
- Every radio's `antennaTypeId` must resolve to an entry in `antennaTypes.json`, or the file won't open at all.
- Ekahau accepts antenna patterns we generate, for known and unknown vendor/model.
- A minimal `project.json` is fine; no thumbnail or requirements needed.
- Channels are stored as centre frequencies: 2.4 GHz `2407 + 5·ch` (ch 14 = 2484), 5 GHz `5000 + 5·ch`, 6 GHz `5950 + 5·ch`.
- Ekahau has one `metersPerUnit` per floor. It also has a crop region (`cropMin/Max`), but coordinates are in full-image pixels, so crop can be ignored.

**Open Intent:**
- Spec: https://github.com/google/openintent (2.0.0). Origin is the lower-left corner, so Y is flipped against Ekahau's top-left.
- `esx2oi.py` ignores Ekahau's real radios and writes fixed ones (2.4 GHz ch 11 and 5 GHz ch 36, 6 dBm, Ubiquiti `uap-ac-pro`, originals kept in `*_original`). The port matches that on purpose.

**Hamina:**
- Hamina shrinks floor plan images larger than 8000 px but keeps reading AP and wall pixel positions against the original size, so everything lands too far from the corner (24% on a 9954 px plan). `esx2oi.py` has the same bug. `src/fit-image.js` caps the longest side at 8000 px and scales every pixel value to match; metres and feet stay, with the height adjusted to keep one scale (a ~2 cm change on a 430 m plan). Whether Hamina's limit is width or longest side is unconfirmed; capping the longest side is safe either way.

**Meraki Dashboard (floor plans):**
- Two adjacent corners rotate the plan. `center` alone doesn't rotate it.
- A PUT with a new image and no position re-centres the plan with no rotation, so we always send corners.
- Meraki documents no image size limit. We cap uploads at 100 MB ourselves.
- Reading geo data from Ekahau or Open Intent to pre-place a floor is not done.

**Meraki Dashboard (access points):**
- Devices: `GET /organizations/{orgId}/devices?networkIds[]=…&productTypes[]=wireless&perPage=1000` (paged) gives `serial`, `name`, `lat`, `lng` for wireless devices only. `GET /networks/{id}/devices` isn't used: Meraki marks it deprecated and it has no `productType`.
- That endpoint has no `floorPlanId`. Each floor plan's `devices[]` (from `GET /networks/{id}/floorPlans`) lists its serials, so an AP's floor plan is the one whose `devices` contains it. `listAccessPoints` returns `{ accessPoints, floorPlans }`.
- BSSIDs: `GET /organizations/{orgId}/wireless/ssids/statuses/byDevice` (`basicServiceSets[].bssid`). A 403 means the key lacks read access to wireless status; Meraki's own text is shown, redacted.
- Placement: `PUT /devices/{serial}` with `lat`, `lng` and `floorPlanId`.
- Matching: name (trim, ignore case; empty names never match; 2+ Meraki APs with that name falls through), then BSSID (exactly one Meraki AP shares a lower-case BSSID). A Meraki AP claimed by 2+ design APs is placed for none. BSSIDs exist only in Ekahau survey data.
- Only APs marked `mine` are placed (a missing `mine` counts as yours). Two design floors with the same name are skipped, since APs join floors by name. AP coordinates beyond the image edge are clamped to it.

**Map services:**
- OpenStreetMap tiles need attribution, a normal Referer and no prefetching.
- Nominatim allows at most one request a second. Search on Enter only, no autocomplete.
- Esri's keyless imagery terms are unclear, so satellite imagery was dropped.

**Browser caching:** GitHub Pages sends `max-age=600`, so after a deploy a browser can run old code for up to 10 minutes. Test fixes in a private window, or check the download size and image dimensions.

## Known gaps and possible next steps

1. **Cache-busting** so users get new code immediately after a deploy (offered, not done).
2. **Malformed Open Intent from other tools** can still show "Something went wrong" instead of a named reason: a coordinate without `coordinate_xyz`, `null` items inside `floorplans` / `accesspoints` / `dot11_radios`, a material without `rf_properties`, nameless floors.
3. **Real radios in `.esx` → Open Intent.** Currently fixed radios, for parity with `esx2oi.py`. Carrying the design's real channels and power would be a deliberate break from parity.
4. **Not converted:** coverage areas, reference markers, channel width, AP azimuth/tilt, GPS.
5. **A zipped folder** (design files inside a subfolder, as macOS "Compress" makes) is reported as not supported, because detection only looks at the top level.
6. **More AP models:** `node tools/add-antennas.mjs "<path to .esx>"` copies only antenna patterns into the library. Check `git diff` before committing; the library is public.
7. Minor: `defaultAntennas` order is TWO, FIVE, SIX (Ekahau accepted it); case variants of a vendor name create duplicate antenna types (harmless).
8. **Meraki upload gaps:** paging has no page cap; the Nominatim response isn't validated beyond `ok`; the fake server's 401 always says "(Global)".
9. **AP placement gaps:** APs are placed only on floors uploaded in this run, never on floors from an earlier run. BSSID matching needs Ekahau survey data; Open Intent and predictive designs match by name only. A `byDevice` entry with a null `basicServiceSets` or a non-string `bssid` currently fails the whole listing instead of being skipped.

## Recent history

- Built test-first through a 13-task plan, with a review after every task and a whole-branch review at the end.
- Added the local Send to Meraki Dashboard flow (spec `docs/superpowers/specs/2026-10-11-meraki-upload-design.md`).
- Added access point placement to the Send to Meraki flow (spec `docs/superpowers/specs/2026-10-12-meraki-ap-placement-design.md`, plan with its changes from the spec in `docs/superpowers/plans/2026-10-12-meraki-ap-placement.md`), plus the `test:survey` local check.
- Fixed after launch: Hamina misplacing APs and walls on plans over 8000 px (`src/fit-image.js`).
- An early commit (the plan, before the design was cleaned up) contains the sample's floor name. The user chose to leave history as it is.
