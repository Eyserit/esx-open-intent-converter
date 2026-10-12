# Ekahau .esx and Open Intent converter

A single web page that converts between an Ekahau `.esx` design and an Open Intent `.zip`.

Live site: https://eyserit.github.io/esx-open-intent-converter/

## What the page does

- Drop one file on the page. The direction is detected from the file's contents, not its name.
- It runs entirely in your browser. Nothing is uploaded or stored, and there are no requests after the page loads.

## What converts

**.esx to Open Intent** mirrors `esx2oi.py` (the port is tested for parity against it). One thing to be aware of: like `esx2oi.py`, it exports fixed radios (2.4 GHz channel 11 and 5 GHz channel 36, both at 6 dBm) rather than the design's real radios.

Floor plans larger than 8000 px on their longest side are shrunk to 8000 px, and every pixel position (APs, walls, the plan's pixel size) is scaled to match. Hamina shrinks larger images on import but keeps reading positions against the original size, which put every AP and wall in the wrong place. Smaller plans are untouched and match `esx2oi.py` exactly.

**Open Intent to .esx** writes floors, walls, and APs with their radios. Antenna patterns come from the bundled library in `src/antenna-library.json`. If a model isn't in the library, a generic omni pattern is used, and the page reports how many APs used it.

Anything else is rejected with an explicit error rather than guessed at.

## Run it locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. This serves the converter only. For the Meraki upload, use `npm start` (below).

## Send floor plans to Meraki (local only)

Run `npm start` and open http://localhost:8000. Set `PORT` to use another port. It needs Node 22 or later. The public site has no Meraki step.

After a conversion, the Done card offers "Send to Meraki Dashboard". The flow:

1. Paste a Dashboard API key and pick the region.
2. Pick the organisation and the wireless network.
3. Pick the floors to send.
4. Place each floor on the map (search an address or drag the outline) and set its rotation.
5. Upload. A floor is created, or updated if a floor plan with exactly the same name exists. The outline position and rotation are applied in Meraki.

Floor plans only. APs are not placed.

**What is stored and where data goes.** Files are converted in the browser and nothing is stored. The API key exists only in page memory and in the request that carries it, and goes only to Meraki. The local server relays requests to Meraki and keeps nothing.

**Outside services.** The map uses OpenStreetMap tiles and Nominatim address search. They see your IP address and the area or text you search for. They never see your API key or your files.

**Limits.** An uploaded file can be at most 100 MB. The cap applies to the public site too.

**Checking the page without a real Dashboard.** `PORT=8123 node tools/fake-meraki.mjs` serves the page against a fake Meraki. Use the API key `test-key`.

Leaflet 1.9.4 (BSD-2-Clause) is included unchanged in `vendor/leaflet/`, with its licence.

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
