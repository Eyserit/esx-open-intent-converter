# Ekahau .esx and Open Intent converter

A single web page that converts between an Ekahau `.esx` design and an Open Intent `.zip`.

Live site: (added when published)

## What the page does

- Drop one file on the page. The direction is detected from the file's contents, not its name.
- It runs entirely in your browser. Nothing is uploaded or stored, and there are no requests after the page loads.

## What converts

**.esx to Open Intent** mirrors `esx2oi.py` (the port is tested for parity against it). One thing to be aware of: like `esx2oi.py`, it exports fixed radios (2.4 GHz channel 11 and 5 GHz channel 36, both at 6 dBm) rather than the design's real radios.

**Open Intent to .esx** writes floors, walls, and APs with their radios. Antenna patterns come from the bundled library in `src/antenna-library.json`. If a model isn't in the library, a generic omni pattern is used, and the page reports how many APs used it.

Anything else is rejected with an explicit error rather than guessed at.

## Run it locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tests and checks

No npm packages are needed, only Node 22 or later (built and tested on Node 26).

- `npm test` runs the test suite against the small synthetic fixtures in `tests/fixtures/`.
- `npm run check` runs `node --check` on every `.js` and `.mjs` file.
- `npm run test:sample` runs local-only checks against a real design. It needs a private `ekahau_sample.esx` in the repo root and a `.venv` with Pillow. Never commit real designs.

## Regenerating fixtures

```sh
.venv/bin/python tools/make-fixture.py
```

## Adding antenna models

```sh
node tools/add-antennas.mjs <file.esx> [<file.esx> ...]
```

This copies only the `antennaTypes` entries from each design into `src/antenna-library.json`. Nothing else from the design is kept.

## Licence and attribution

`src/esx-to-oi.js` is a modified JavaScript port of `esx2oi.py`, which is Apache-2.0 licensed. The original copyright (Copyright 2025 oiconvert) is retained in the file header. The licence text is in [LICENSE](LICENSE).
