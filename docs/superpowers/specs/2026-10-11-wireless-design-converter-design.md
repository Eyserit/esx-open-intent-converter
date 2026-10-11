# Wireless design file converter: design

Date: 2026-10-11
Status: awaiting review

## Goal

A single web page, hosted on GitHub Pages, where a Wi-Fi engineer drops one file and gets the converted file back as a download. An Ekahau `.esx` becomes an Open Intent `.zip`, and an Open Intent `.zip` becomes an `.esx`. The page works out the direction from the file's contents. Conversion runs entirely in the browser; the file never leaves the user's machine and nothing is stored.

### Out of scope

- Options, settings, sign-up, batch conversion, or more than one file at a time.
- Open Intent `coverage_areas` → Ekahau requirement areas, and reference markers (no real test data yet).
- Ekahau data that Open Intent cannot carry beyond what is listed under "Open Intent → .esx" below.
- A server of any kind.

## Decisions so far

| Topic | Decision |
|---|---|
| Hosting | Static site on public GitHub Pages, no build step |
| Language | Plain HTML, CSS and JavaScript (ES modules); `esx2oi.py` is ported to JavaScript |
| Zip handling | Hand-written reader and writer on the platform `DecompressionStream`/`CompressionStream` (`deflate-raw`), no library |
| Tests | Node 22+ (installed with Homebrew) and the built-in `node:test`; no npm packages |
| Lint and types | No ESLint or TypeScript; `node --check` for syntax, JSDoc and tests for the rest |
| Reverse fidelity | Floors, walls and APs with radios (option A) |
| Antennas | Bundled library of real `antennaTypes` entries, keyed by vendor and model, with a generated generic omni fallback. The real patterns are public; that is accepted |
| Public repo contents | No floor plans or real designs. `ekahau_sample.esx` and `probe-throwaway/` are git-ignored |

### Evidence from the Ekahau probe

| Probe | Result |
|---|---|
| 0: floors and walls, minimal `project.json`, no thumbnail or requirements | Opens; image, scale and walls correct |
| 1: plus APs, no radios | Opens; APs do not appear |
| 2: plus radios, no antenna types | Does not open |
| 3: plus the sample's real Mist AP34 antenna types | Opens; APs, model, heatmap, channels and power correct |
| 4a: synthetic flat omni patterns, model Mist AP34 | Opens; Ekahau uses our pattern, not its own |
| 4b: synthetic flat omni patterns, unknown model `Generic OI-Omni` | Opens; APs shown with that model, heatmap shows coverage |

Conclusion: every AP needs radios, every radio needs an `antennaTypeId` that resolves, and Ekahau accepts antenna patterns we generate, for known and unknown models.

## Licensing

`esx2oi.py` is Apache-2.0 (Copyright 2025 oiconvert). The JavaScript port keeps that copyright line and licence header, adds a notice that it is a modified port, and the `LICENSE` file stays in the repo. `esx2oi.py` itself stays in the repo as the reference implementation used by the test tooling; the page does not load it.

## Structure

```
index.html, styles.css, app.js   page: one card, the states below
src/zip.js                       readZip(bytes) → entries; writeZip(entries) → bytes
src/detect.js                    detectFormat(entries) → "esx" | "oi" | null
src/esx-to-oi.js                 JavaScript port of esx2oi.py, pure functions
src/oi-to-esx.js                 Open Intent → .esx
src/antennas.js                  library lookup by vendor/model/band, or generated generic omni
src/antenna-library.json         antennaTypes entries only (starts with Mist AP34)
src/convert.js                   convert(bytes, fileName, imageTools, onProgress) → { outputName, bytes, notes }
src/browser-images.js            canvas-based imageTools (browser only)
tests/                           node:test suites, synthetic fixture and expected output
tools/add-antennas.mjs           harvest antennaTypes from an .esx into the library
tools/make-fixture.py            build the synthetic fixture and its expected Open Intent output
esx2oi.py, LICENSE               reference implementation and attribution
```

Boundaries:

- `app.js` knows only `convert()` and the page states.
- `convert()` reads the zip, detects the format, calls one converter, writes the output zip and reports progress.
- The converters take and return plain data, so they run unchanged in Node tests.
- Image decoding and PNG encoding (Pillow's job in `esx2oi.py`) is injected as `imageTools`. The page passes a canvas implementation; tests pass a Node stand-in.

The page uses `esx2oi.py`'s CLI defaults: material prefix `[Imported] `, only used wall types exported, AP fallback vendor `ubiquiti` and model `uap-ac-pro`.

## Format detection

By contents, never by file name:

1. Not a zip archive → not supported.
2. Top-level `floorPlans.json` and `project.json` → Ekahau `.esx`.
3. A top-level `.json` file whose object has an `openintent_version` key → Open Intent.
4. Both or neither → not supported.

## Conversion flows

### .esx → Open Intent

Follows `esx2oi.py` `main()`: load structures, build wall materials, build floors (choosing the best floor image and writing it as PNG through `imageTools`), build APs, then write `openintent.json` and an `images/` folder. Output must match what `esx2oi.py` produces for the same input, apart from PNG bytes.

### Open Intent → .esx

Matches the shape that probes 3 and 4 proved Ekahau accepts:

- `version` and a minimal `project.json` (project name only; no author or history).
- Each floor: `floorPlans.json` and `images.json` entries plus an `image-<uuid>` file holding the PNG unchanged. Scale (`metersPerUnit`) comes from the floor's pixel and metre dimensions.
- Wall materials → `wallTypes` (thickness, attenuation, colour). Walls → `wallPoints` and `wallSegments`, with Y flipped back.
- APs: name and position with Y flipped back; vendor and model from `manufacturer_original`/`model_original` when present, otherwise the Open Intent fields.
- Radios: one simulated radio per Open Intent radio, carrying band, channel and power. Each links to an antenna type for its vendor, model and band: from the library when present, otherwise a generic omni pattern generated for that band (flat 3 dBi on 2.4 GHz, 4 dBi on 5 and 6 GHz, as in probe 4).
- All IDs are new, from `crypto.randomUUID()`.

### Output name and notes

The output keeps the input's base name with the new extension (`Site A.esx` ↔ `Site A.zip`). `convert()` also returns notes, currently one kind: "N APs used a generic antenna (model not in library)". The Done card shows notes in a quiet line, or nothing when there are none.

## Page

### Look

Taken from the Claude Design brief: near-black ground with a faint warm glow; a large centred two-line headline in Geist; the card is a dark input surface with a soft double border and inner highlight; pill buttons with a halo; one warm orange accent for the primary action; a quiet hairline footer strip. No third-party names, nav or logos. The whole page is the drop zone; the only call to action is Choose file.

### States (all in the same card)

| State | Content |
|---|---|
| Idle | Drop here or choose a file; names both accepted formats |
| Dragging | Card lights up: "Release to convert" |
| Converting | File name, detected direction (e.g. "Ekahau .esx → Open Intent .zip"), progress bar |
| Done | Output file name, primary Download, secondary Convert another, notes line if any |
| Not supported | "This isn't an Ekahau .esx or an Open Intent zip." Neutral, not alarm red. Try another file |

Variants of the Not supported card, same style and button:

- Recognised but broken: "This looks like an Ekahau .esx, but it couldn't be converted: <reason>."
- Unexpected error: "Something went wrong converting this file." Full error to the console.
- More than one file dropped: "Drop one file at a time."

Trust line under the card: files are converted in your browser and never uploaded.

### Behaviour

- Progress moves in real stages reported through `onProgress`: reading, converting, images, writing.
- The download is a Blob URL with a `download` file name, revoked on Convert another.
- No localStorage, no network requests after page load, no analytics.
- Keyboard: the card is focusable; Enter or Space opens the file picker. State changes are announced through an `aria-live` region.

## Errors

| Error | When | Card |
|---|---|---|
| `NotSupportedError` | Not a zip, or neither format | Not supported |
| `ConversionError(reason)` | Recognised format but a required file is missing or unreadable, an image cannot be decoded, or the zip uses Zip64 or encryption | Recognised but broken |
| Any other exception | A bug | Unexpected error |

No silent fallbacks. The generic antenna is the only deliberate fallback, and it is always reported in the notes.

## Testing

Main suite, `npm test` (`node --test`, no packages), committed:

- `zip`: write then read round trip; reads stored and deflated zips made by Python `zipfile`; detects CRC mismatch; rejects Zip64 and encryption with `ConversionError`.
- `detect`: `.esx`, Open Intent, a renamed `.esx`, an unrelated zip, a non-zip.
- `esx-to-oi` parity: a synthetic fixture `.esx` (grey image, a few walls of several materials, a few APs with radios) converted by the port deep-equals the `openintent.json` produced by `esx2oi.py`. Images are compared by dimensions, not bytes. The port needs a `round1` that matches Python's round-half-even; this test guards it.
- `oi-to-esx` integrity: every radio's `antennaTypeId`, every AP's floor, every wall's points and wall type resolve. Generic-antenna notes are counted correctly.
- Round trip: `.esx` → OI → `.esx` → OI equals the first OI, ignoring IDs.
- `convert` and `antennas`: output names, notes, library match, omni fallback per band.

Fixture tooling: `tools/make-fixture.py` builds the fixture and runs `esx2oi.py` on it to produce the expected output. It needs Pillow in a git-ignored `.venv` and runs only when the fixture changes.

Local sample check, `npm run test:sample`: parity and round trip on the real `ekahau_sample.esx`. Separate from the main suite so the public tests never reference it. Fails loudly if the file is missing.

Human checks:

- All page states checked in the browser pane.
- Final acceptance: the sample converted to Open Intent and back opens correctly in Ekahau (floors, walls, APs, heatmap, channels, power).
