# Wireless Design File Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages site that converts one dropped file between Ekahau `.esx` and Open Intent `.zip`, entirely in the browser.

**Architecture:** Plain ES modules with no build step. Pure converters take and return plain data and are tested in Node. The browser-only parts (canvas image decoding and the page) are thin layers over `convert()`. `esx2oi.py` stays as the reference, and a synthetic fixture pins the JavaScript port to its exact output.

**Tech Stack:** HTML, CSS and JavaScript (ES2022 modules); `DecompressionStream`/`CompressionStream` (`deflate-raw`); Node 22+ with `node:test`, no npm packages; Python 3 with Pillow in `.venv` for fixture generation only.

**Spec:** `docs/superpowers/specs/2026-10-11-wireless-design-converter-design.md`

## Global Constraints

- No npm packages or third-party JavaScript. The only external resource is the Geist font from Google Fonts.
- `package.json` has `"type": "module"` and only scripts: `test` = `node --test "tests/**/*.test.js"`, `test:sample` = `node --test local-checks/`, `check` = `node --check` on every `.js`/`.mjs` file.
- No `.esx` outside `tests/fixtures/` is ever committed. No real floor plan, real design, or anything derived from one goes into git, except the `antennaTypes` entries in `src/antenna-library.json`.
- The page defaults are `esx2oi.py`'s CLI defaults: prefix `"[Imported] "`, used materials only, fallback vendor `"ubiquiti"` and model `"uap-ac-pro"`.
- Floating-point maths in the port uses the same operation order as `esx2oi.py` (for example `w * mpu * 3.28084` as `(w*mpu)*3.28084`), so parity tests can use exact equality.
- Errors are `NotSupportedError` or `ConversionError(reason)` from `src/errors.js`. Nothing is swallowed, except where `esx2oi.py` itself skips: undecodable candidate images, and wall segments without two valid points.
- No `localStorage`, no analytics, and no requests after page load.
- Commit messages start with `structure:` or `behavior:` and end with the `Co-Authored-By` trailer.

### Refinements decided at plan time (not in the spec)

1. **The prefix is stripped on the way back.** Open Intent → `.esx` removes a leading `"[Imported] "` from material names, so a round trip doesn't stack prefixes.
2. **Round-trip tolerance.** The round trip compares exactly, except for `attenuation_flat` (±0.1, because it is re-derived from a rounded per-metre value) and floating-point coordinates (±1e-9).
3. **Parity compares materials as a set.** `esx2oi.py` iterates a Python `set`, so its material order is not deterministic. Parity sorts `wall_materials` by name before comparing.
4. **An AP with no `dot11_radios`** is still written. Ekahau won't show it (probe 1), so a note says so: "N APs have no radios and won't appear in Ekahau."
5. **Two extra small modules:** `src/errors.js` (the error classes) and `src/messages.js` (error and state → card copy, a pure function so the copy can be tested). The local sample check lives in `local-checks/`, outside the `tests/` glob.
6. **Ekahau constants** are taken from probe 4b, which Ekahau accepted:
   - Wall type: `key: "Imported"`, `lowerEdge: 0.0`, `reflectionCoefficient: 0.4`, `diffractionCoefficient: 11.0`, and one `propagationProperties` entry per band `TWO`/`FIVE`/`SIX` with `attenuationFactor = attenuation_per_m`.
   - Radio: `technology: "AX"`, `radioTechnology: "IEEE802_11"`, `antennaMounting: "CEILING"`, `antennaDirection: 0.0`, `antennaTilt: 0.0`, `shortGuardInterval: true`, `greenfield: false`, `enabled: true`, `spatialStreamCount = mimo_chains ?? 2`, `antennaHeight` = the AP's metres `z`, or `2.5` when absent.
   - Channel → `channelByCenterFrequencyDefinedNarrowChannels: [centre MHz]`: 2.4 GHz is `2407 + 5·ch` (ch 14 = 2484), 5 GHz is `5000 + 5·ch`, and 6 GHz is `5950 + 5·ch`.
   - Band map: `FREQ_2.4GHZ`↔`TWO`, `FREQ_5GHZ`↔`FIVE`, `FREQ_6GHZ`↔`SIX`.

## Review Focus

1. **Open Intent from another tool with AP positions only in metres or feet** (no `pixels` entry): the position comes from metres ÷ mpu, or feet ÷ 3.28084 ÷ mpu. Tested in Task 8.
2. **A real `.esx` whose floor image is a JPEG:** `esxToOi` must pass it through `imageTools.toPng`, never copy the raw bytes. Tested in Task 4 with a recording stand-in, and checked in the browser in Task 11.
3. **Non-ASCII floor and project names** (the sample's floor is `CDSP-manual-Automação-AP34`): `sanitizeFilename` matches Python, and zip entry names are written with the UTF-8 flag. Tested in Tasks 2 and 3.
4. **Awkward file names** (`site.v2.esx`, `design` with no extension, `SITE.ESX`): the output name is the base name without its last extension, plus `.zip` or `.esx`. Tested in Task 9.
5. **An Open Intent AP whose `floorplan_name` matches no floor, or a floor with no scale:** `ConversionError` naming the AP or floor, never a crash. Tested in Task 7 and Task 8.

---

### Task 0: Tooling

**Files:**
- Create: `package.json`, `tests/smoke.test.js`
- Modify: `.gitignore` (add `node_modules/`)

- [ ] **Step 1:** Ask the user, then run `brew install node`. Verify that `node --version` is ≥ v22 and that `node -e "new DecompressionStream('deflate-raw')"` exits 0.
- [ ] **Step 2:** Create `.venv` with `python3 -m venv .venv && .venv/bin/pip install pillow`.
- [ ] **Step 3:** Write `package.json` (scripts as in Global Constraints) and `tests/smoke.test.js` asserting `1 + 1 === 2`. Run `npm test`: 1 pass. Run `npm run check`: exit 0.
- [ ] **Step 4:** Commit `structure: add Node test tooling`. The smoke test stays until Task 1 adds real tests, then Task 1 deletes it in the same commit.

### Task 1: Zip reader

**Files:**
- Create: `src/errors.js`, `src/zip.js`, `tools/make-fixture.py`, `tests/zip.test.js`, `tests/fixtures/python-stored.zip`, `tests/fixtures/python-deflated.zip`, `tests/fixtures/python-zip64.zip`, `tests/fixtures/not-a-zip.bin`

**Interfaces:**
- Produces:
  - `class NotSupportedError extends Error`
  - `class ConversionError extends Error { constructor(reason: string) }`, with `.reason`
  - `readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>>`, which skips directory entries (names ending `/`)

- [ ] **Step 1:** `tools/make-fixture.py` with a `zip_fixtures()` function that writes the three Python zips into `tests/fixtures/`:
  - `python-stored.zip`: `a.txt` = `hello`, plus `dir/b.json` = `{"x":1}`, stored.
  - `python-deflated.zip`: the same entries, deflated, plus `images/` as a directory entry and `naïve.txt` = `ü`.
  - `python-zip64.zip`: `a.txt`, written with `force_zip64=True`.
  - `not-a-zip.bin`: 100 bytes of `0x41`.

  Run it with `.venv/bin/python tools/make-fixture.py`.
- [ ] **Step 2: failing tests** in `tests/zip.test.js`:
  - `reads stored entries`: the map has keys `["a.txt","dir/b.json"]`, and `a.txt` decodes to `"hello"`.
  - `reads deflated entries and skips directories`: `images/` is absent, and `naïve.txt` decodes to `"ü"`.
  - `rejects a non-zip with NotSupportedError`.
  - `rejects zip64 with ConversionError` whose reason contains `"Zip64"`.
  - `rejects a CRC mismatch`: flip one byte inside the stored `hello` data, then expect a `ConversionError` whose reason contains `"corrupt"`.
  - `rejects encrypted entries`: set general-purpose flag bit 0 in the central directory entry of the stored zip, then expect a `ConversionError` whose reason contains `"encrypted"`.

  Run `npm test` and confirm it fails because `readZip` isn't defined. Add one test at a time, keeping only one failing at once, as CLAUDE.md requires.
- [ ] **Step 3:** Implement `readZip`. Find the EOCD (`0x06054b50`) by scanning back up to 65,557 bytes; finding none means `NotSupportedError`. Walk the central directory.
  - Zip64 (the locator signature `0x07064b50` is present, or any `0xFFFF`/`0xFFFFFFFF` field) → `ConversionError("uses Zip64, which isn't supported")`.
  - Flag bit 0 set → `ConversionError("is encrypted")`.
  - Method 0 means stored; method 8 means inflate through `DecompressionStream('deflate-raw')`; any other method → `ConversionError("uses an unsupported compression method")`.
  - A CRC-32 mismatch → `ConversionError("is corrupt (checksum mismatch)")`.

  Names are decoded as UTF-8.
- [ ] **Step 4:** `npm test` all pass, and `npm run check` is clean. Commit `behavior: read zip archives with platform deflate streams`.

### Task 2: Zip writer

**Files:**
- Modify: `src/zip.js`, `tests/zip.test.js`

**Interfaces:**
- Produces: `writeZip(entries: Array<[name: string, data: Uint8Array]>): Promise<Uint8Array>`. Entries are kept in the given order; a name ending `/` becomes an empty stored directory entry.

- [ ] **Step 1: failing tests:**
  - `round-trips entries through readZip`, including the name `Automação/ü.json` and a 1 MB pseudo-random buffer.
  - `sets the UTF-8 flag` (bit 11) on every central directory entry.
  - `is deterministic`: two calls with the same input give identical bytes.
  - `Python can read it`: a test that writes a zip to `os.tmpdir()`, runs `python3 -I -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None"`, and expects exit 0.
- [ ] **Step 2:** Implement `writeZip` with deflate through `CompressionStream('deflate-raw')`, the DOS date fixed at 1980-01-01 00:00, CRC-32 shared with the reader, and version needed 20.
- [ ] **Step 3:** All pass and check is clean. Commit `behavior: write zip archives`.

### Task 3: Format detection

**Files:**
- Create: `src/detect.js`, `tests/detect.test.js`

**Interfaces:**
- Consumes: `readZip`, `writeZip`
- Produces: `detectFormat(entries: Map<string, Uint8Array>): "esx" | "oi" | null`

- [ ] **Step 1: failing tests.** Build the entry maps in the test.
  - `{floorPlans.json, project.json}` → `"esx"`.
  - `{openintent.json: {"openintent_version":"2.0.0"}}` → `"oi"`.
  - `{design.json: {"openintent_version":"2.0.0"}}` → `"oi"`.
  - `{sub/openintent.json …}` (not top level) → `null`.
  - `{openintent.json: "not json"}` → `null`.
  - A map with both → `null`.
  - `{a.txt}` → `null`.
- [ ] **Step 2:** Implement. "Top level" means the name contains no `/`. A JSON parse failure means not a match, and doesn't throw.
- [ ] **Step 3:** All pass. Commit `behavior: detect format from archive contents`.

### Task 4: Port helpers, fixture `.esx`, and floors with images

**Files:**
- Create: `src/esx-to-oi.js`, `tests/esx-to-oi.test.js`, `tests/helpers/node-images.js`, `tests/fixtures/fixture.esx`, `tests/fixtures/fixture.expected.json`
- Modify: `tools/make-fixture.py`

**Interfaces:**
- Produces, all exported from `src/esx-to-oi.js`:
  - `round1(x: number): number`, which must equal Python's `float(f"{x:.1f}")`
  - `sanitizeFilename(s: string): string`
  - `buildWallMaterials(wallTypes: Record<id, object>, wallSegments: object[], prefix: string): { materials: object[], id2name: Record<id,string> }`
  - `buildWallsForFloor(floorId, imgH: number, wallSegments, wallPoints: Record<id,object>, id2name): object[]`
  - `chooseBestImage(entries: Map, targetW: number, targetH: number, imageTools): Promise<{ size: [w,h], png: Uint8Array }>`
  - `buildFloorObjects(entries, floors, wallSegments, wallPoints, id2name, projPrefix, metersPerUnit: Record<id,number>, projectName, imageTools): Promise<{ floorsOut, images: Map<string,Uint8Array>, floorImgH: Record<id,number> }>`
  - `imageTools` shape: `{ size(bytes): Promise<{width,height}>; toPng(bytes): Promise<Uint8Array> }`, where `size` rejects on bytes it can't decode
- `tests/helpers/node-images.js` exports `nodeImageTools`, which reads the PNG IHDR for size, rejects non-PNGs, and makes `toPng` the identity for PNGs. It also exports `recordingImageTools(inner)`, which logs the `toPng` calls.

- [ ] **Step 1:** Extend `make-fixture.py` with `esx_fixture()`. It writes `tests/fixtures/fixture.esx`, runs `.venv/bin/python esx2oi.py` on it into a temporary zip, and writes `fixture.expected.json` = `{ "openintent": <parsed openintent.json>, "images": { "<rel>": [w, h] } }`. The fixture contains:
  - `project.json` title `"Fixture Síte"`.
  - Two floors:
    - `Ground` (400×300, mpu 0.05, image `image-g` PNG).
    - `First floor` (640×480, mpu 0.04, image `image-f` PNG).
  - Three wall types:
    - `Drywall`: `FIVE` 30, `TWO` 25, thickness 0.1.
    - `Brick`: `TWO` 12.34 only, thickness 0.25.
    - `Unused`: a wall type no segment uses.
  - Walls: four segments on Ground, two on First, and one whose second point id is missing.
  - Three APs:
    - `AP-A`: Mist AP34, Ground.
    - `AP-B`: Mist AP34, Ground, with x = 9999 to test clamping.
    - `AP-C`: Acme X1, First floor.
- [ ] **Step 2: failing tests, one at a time:**
  - `round1` cases: `0.25→0.2`, `0.75→0.8`, `1.25→1.2`, `0.35→0.3`, `2.675→2.7`, `-0.25→-0.2`, `3→3`.
  - `sanitizeFilename("CDSP-manual-Automação-AP34") === "CDSP-manual-Automacao-AP34"`, `sanitizeFilename("..a b/c..") === "a_b_c"` and `sanitizeFilename("日本") === "Floor"`.
  - `buildWallMaterials` on the fixture: two materials, no `Unused`, Brick `attenuation_per_m` 12.3 (the `TWO` fallback), and Drywall 30 (the `FIVE` value is preferred).
  - `buildWallsForFloor`: Ground gives four segments, the one with the missing point is skipped, and `y` is flipped (`300 - y`).
  - `buildFloorObjects` matches `expected.openintent.floorplans` with exact deep equality, and the image sizes match `expected.images`.
  - `JPEG goes through toPng`: a fixture variant whose `image-g` is replaced by a JPEG; `recordingImageTools` shows that `toPng` was called with the JPEG bytes.
- [ ] **Step 3:** Implement each function as a line-by-line port of the Python function with the same name. `round1` must break exact binary halves (`x*10` an exact `.5`) towards the even digit, otherwise use `Number(x.toFixed(1))`. `chooseBestImage` skips candidates whose `size()` rejects, as Python does, and throws `ConversionError("has no floor image")` when there are none.
- [ ] **Step 4:** All pass. Commit `behavior: port esx2oi floor, wall and image building`.

### Task 5: APs and full `.esx` → Open Intent parity

**Files:**
- Modify: `src/esx-to-oi.js`, `tests/esx-to-oi.test.js`

**Interfaces:**
- Consumes: Task 4 helpers, `ConversionError`
- Produces:
  - `buildAps(aps, floorNameById, floorImgHById, metersPerUnit, floorDimsByName, fallbackVendor, fallbackModel): object[]`
  - `esxToOi(entries: Map, imageTools): Promise<{ openintent: object, images: Map<string, Uint8Array> }>`

- [ ] **Step 1: failing tests:**
  - `buildAps` deep-equals `expected.openintent.accesspoints`, including AP-B clamped to 400.
  - `esxToOi(fixture)`: the full `openintent` deep-equals expected, after sorting `wall_materials` by name on both sides.
  - A missing `wallSegments.json` → `ConversionError` whose reason is `"missing wallSegments.json"`.
- [ ] **Step 2:** Implement. Required files are `floorPlans.json`, `wallSegments.json`, `wallPoints.json` and `wallTypes.json`; `accessPoints.json` and `project.json` are optional, as in Python. Object key order follows Python's.
- [ ] **Step 3:** All pass. Commit `behavior: convert esx to Open Intent with parity to esx2oi.py`.

### Task 6: Antenna library

**Files:**
- Create: `src/antennas.js`, `src/antenna-library.json`, `tools/add-antennas.mjs`, `tests/antennas.test.js`

**Interfaces:**
- Produces:
  - `findAntenna(library: object[], vendor, model, band: "TWO"|"FIVE"|"SIX"): object | null`. The vendor and model match is case-insensitive and trimmed, and only `radioTechnology === "IEEE802_11"` entries count.
  - `genericAntenna(vendor, model, band): object`
  - `mergeAntennaTypes(library, antennaTypes): object[]`. It removes `id` and `status`, keeps only Wi-Fi entries, and replaces any existing entry with the same vendor, model and band.

- [ ] **Step 1: failing tests:**
  - `findAntenna` matches `"mist"/"ap34"/"FIVE"`, ignores BLE entries, and returns `null` for unknown models.
  - `genericAntenna("Acme","X1","TWO")` returns:
    - `name: "Acme X1 2.4GHz"`, `maxGain: 3`
    - 72 `hplane` gains, all 3, at angles 0..355; 72 `eplane` gains
    - `hplane.alignmentAngle: 180`, `eplane.alignmentAngle: 90`
    - `directional: false`, `defaultMounting: "CEILING"`, `apCoupling: "INTERNAL_ANTENNA"`
  - `FIVE` and `SIX` have `maxGain` 4.
  - `mergeAntennaTypes` replaces an existing entry and drops `id`/`status`/BLE.
- [ ] **Step 2:** Implement. `tools/add-antennas.mjs <file.esx>…` reads each archive with `readZip`, merges its `antennaTypes.json`, and writes `src/antenna-library.json` sorted by vendor, model and band, with two-space indentation.
- [ ] **Step 3:** Run `node tools/add-antennas.mjs ekahau_sample.esx`. Confirm the library holds exactly three entries (Mist AP34 2.4, 5 and 6 GHz) and nothing else from the design. All tests pass. Commit `behavior: add antenna library with generic omni fallback` (the library JSON is included, as approved).

### Task 7: Open Intent → `.esx` floors, images and walls

**Files:**
- Create: `src/oi-to-esx.js`, `tests/oi-to-esx.test.js`

**Interfaces:**
- Consumes: `ConversionError`
- Produces:
  - `buildEsxFloors(oi, files: Map, newId: () => string): { floorPlans, images, imageFiles: Map<string,Uint8Array>, floorByName: Record<name, { id, mpu, heightPx }> }`
  - `buildEsxWalls(oi, floorByName, newId): { wallTypes, wallPoints, wallSegments }`

- [ ] **Step 1: failing tests**, using `esxToOi(fixture).openintent` as the input:
  - Each floor has `width`/`height`/`cropMax*` equal to the pixel dimensions, `metersPerUnit` = metres width ÷ pixel width, an `imageId` that resolves in `images`, and an `image-<id>` file whose bytes equal the Open Intent PNG.
  - `imageFormat` is `"PNG"` for PNG magic bytes and `"JPEG"` for JPEG magic bytes.
  - Scale comes from feet when there is no metres dimension.
  - A floor with no pixels dimension, or no metres or feet dimension → `ConversionError` naming the floor.
  - A missing image file → `ConversionError` naming the path.
  - Wall types are named without the `"[Imported] "` prefix, with constants per Refinement 6.
  - Wall points are flipped back (`heightPx - y`) and every `wallSegments[].wallPoints`/`wallTypeId` resolves.
  - `project.json` is not built here.
- [ ] **Step 2:** Implement. `map_uri` is the zip path after stripping `file://`.
- [ ] **Step 3:** All pass. Commit `behavior: build esx floors and walls from Open Intent`.

### Task 8: Open Intent → `.esx` APs, radios, antennas and notes

**Files:**
- Modify: `src/oi-to-esx.js`, `tests/oi-to-esx.test.js`

**Interfaces:**
- Consumes: `buildEsxFloors`, `buildEsxWalls`, `findAntenna`, `genericAntenna`
- Produces: `oiToEsx(oi, files: Map, library, fallbackName: string, newId = () => crypto.randomUUID()): { files: Map<string, Uint8Array>, notes: string[] }`. The files are `version` (`"2.0"`), `project.json` (shape as in probe 4b: `schemaVersion "1.9.0"`, name and title = first floor's `project_name` or else `fallbackName`, empty customer, location and responsiblePerson), plus all the JSON files from probe 4b.

- [ ] **Step 1: failing tests:**
  - **Integrity:** every radio's `accessPointId`, `antennaTypeId` and `defaultAntennas[].antennaTypeId`, and every AP's `location.floorPlanId`, resolve.
  - Each AP gets `vendor`/`model` from `manufacturer_original`/`model_original`, or from `manufacturer`/`model` when those are empty.
  - Radios: channel 11 gives `[2462]`, channel 36 gives `[5180]`, 6 GHz channel 37 gives `[6135]`, and `transmitPower` gives `6`.
  - **Antenna types:** there are exactly three per (vendor, model) used, one each for `TWO`, `FIVE` and `SIX`. The Mist ones come from the library; the Acme ones are generic.
  - **Notes:** the fixture gives `["1 AP used a generic antenna (model not in library)"]`; the plural is `"2 APs used …"`.
  - **No radios:** an AP with no `dot11_radios` adds the note `"1 AP has no radios and won't appear in Ekahau"`.
  - **Position in metres only:** an AP with only a metres coordinate is placed at metres ÷ mpu, flipped.
  - **Unknown floor:** an unknown `floorplan_name` → `ConversionError` naming the AP.
  - **Unknown band:** an unknown band → `ConversionError` naming the AP.
- [ ] **Step 2:** Implement. Radios and constants follow Refinement 6, and antenna types are deduplicated per (vendor, model, band).
- [ ] **Step 3:** All pass. Commit `behavior: build esx access points, radios and antennas from Open Intent`.

### Task 9: `convert()` and the round trip

**Files:**
- Create: `src/convert.js`, `tests/convert.test.js`

**Interfaces:**
- Consumes: `readZip`, `writeZip`, `detectFormat`, `esxToOi`, `oiToEsx`
- Produces: `convert(bytes: Uint8Array, fileName: string, { imageTools, library, onProgress = () => {} }): Promise<{ direction: "esx-to-oi" | "oi-to-esx", outputName: string, bytes: Uint8Array, notes: string[] }>`
  - `onProgress` receives `{ stage: "reading" | "converting" | "images" | "writing", direction? }`; `direction` is set from `"converting"` onwards.
  - The `.esx` → Open Intent output zip is written in Python's order: `images/`, the images, then `openintent.json`, as compact JSON.
  - `NotSupportedError` is thrown when `detectFormat` returns `null`.

- [ ] **Step 1: failing tests:**
  - **Output names:** `Site A.esx` → `Site A.zip`, `site.v2.esx` → `site.v2.zip`, `design` → `design.zip`, `SITE.ESX` → `SITE.zip`, and an Open Intent `Site A.zip` → `Site A.esx`.
  - **Progress:** the stages arrive in order, with the direction set.
  - **Not supported:** an unrelated zip → `NotSupportedError`.
  - **Round trip:** fixture → Open Intent₁ → `.esx` → Open Intent₂ equals Open Intent₁, ignoring `floor_id`, with materials sorted, the tolerances from Refinement 2, and images compared by size.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** All pass. Commit `behavior: add convert entry point`.

### Task 10: Local sample check

**Files:**
- Create: `local-checks/sample.test.js`

- [ ] **Step 1:** Write two checks:
  - **Parity:** the test runs `.venv/bin/python esx2oi.py --esx ekahau_sample.esx --out <tmpdir>/sample.zip`, then compares it with `convert()` exactly as in Task 5. It fails with "ekahau_sample.esx not found (local-only check)" if the file is missing.
  - **Round trip:** the same comparison as Task 9, on the sample.

  It uses `nodeImageTools`. If the sample image isn't a PNG, the check fails clearly rather than skipping; in that case, stop and report.
- [ ] **Step 2:** Run `npm run test:sample` and confirm both pass. `npm test` doesn't run them. Commit `behavior: add local-only sample parity check` (the check file references the path only; the sample stays ignored).

### Task 11: Page

**Files:**
- Create: `src/messages.js`, `tests/messages.test.js`, `src/browser-images.js`, `index.html`, `styles.css`, `app.js`, `.nojekyll`

**Interfaces:**
- Consumes: `convert`, `NotSupportedError`, `ConversionError`
- Produces: `cardFor(event): { state: "idle"|"dragging"|"converting"|"done"|"unsupported", title: string, detail?: string }`. Events are `{type:"idle"}`, `{type:"dragging"}`, `{type:"converting", fileName, direction?}`, `{type:"done", outputName, notes}`, `{type:"error", error, format?}` and `{type:"multiple"}`.

- [ ] **Step 1: failing tests for `cardFor`, using the spec's exact copy:**
  - **Not supported:** gives `"This isn't an Ekahau .esx or an Open Intent zip."`
  - **Recognised but broken:** a `ConversionError("missing wallSegments.json")` with format `esx` gives `"This looks like an Ekahau .esx, but it couldn't be converted: missing wallSegments.json."`
  - **Unexpected:** a plain `Error` gives `"Something went wrong converting this file."`
  - **Multiple files:** gives `"Drop one file at a time."`
  - **Direction labels:** `"Ekahau .esx → Open Intent .zip"` and `"Open Intent .zip → Ekahau .esx"`.
  - **Done:** shows the notes joined by `" · "`.
- [ ] **Step 2:** Implement `messages.js`. All pass.
- [ ] **Step 3:** Build `browser-images.js`, `index.html`, `styles.css` and `app.js`.
  - **`browser-images.js`:** `size` uses `createImageBitmap`; `toPng` draws onto an `OffscreenCanvas` and calls `convertToBlob({type:"image/png"})`.
  - **Look and copy:** as in the spec, using Geist from Google Fonts. The trust line is "Files are converted in your browser and never uploaded."
  - **Interaction:**
    - The card is focusable; Enter or Space opens the file picker.
    - An `aria-live` region announces state changes.
    - The library is loaded by `fetch("src/antenna-library.json")` at page load.
    - The Blob URL is revoked on Convert another.
    - The whole page is the drop target.
- [ ] **Step 4: check in the browser pane** (a `.claude/launch.json` entry `python3 -m http.server 8000`). Check every state:
  - **Idle**, **Dragging** (simulated with a `dragenter` event), and **Not supported** (with a `.txt` file).
  - **Done** for the fixture `.esx`: download its Open Intent `.zip`, convert that back, and confirm Done again with no notes.
  - **Recognised-but-broken**, by dropping a fixture with `wallSegments.json` removed.
  - **Console:** no errors, and no network requests after load.
  - **Layout:** checked at 375 px width.

  Screenshot each state.
- [ ] **Step 5:** `npm test` and `npm run check` are clean. Commit `behavior: add converter page`.

### Task 12: Publishing

- [ ] **Step 1:** Rewrite `README.md`: what the page does, a link to the site (once known), how to run `npm test` and `npm run test:sample`, how to add antenna models with `tools/add-antennas.mjs`, and the Apache-2.0 attribution for the port. Add the modified-port notice and the original copyright header at the top of `src/esx-to-oi.js`. Commit `structure: document the converter`.
- [ ] **Step 2:** Run `git ls-files` and confirm it lists no `.esx` outside `tests/fixtures/` and no image other than the fixtures.
- [ ] **Step 3:** **Ask the user** before creating the GitHub repository, pushing, and turning on Pages (source: `main`, root). Then verify that the live URL serves the page and converts the fixture.
- [ ] **Step 4:** Final acceptance (user): convert `ekahau_sample.esx` → Open Intent → `.esx` on the live page and open the result in Ekahau. Check floors, walls, APs, heatmap, channels and power.

### After Task 12 (from CLAUDE.md)

Simplify with `code-simplifier`, then commit `structure: simplify`. Then re-verify (`npm test`, `npm run test:sample`, `npm run check`), get a code review, finish the branch, and summarise. After acceptance, delete `probe-throwaway/`.
