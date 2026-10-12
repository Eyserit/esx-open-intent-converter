# Ekahau .esx and Open Intent converter

A single web page that converts between an Ekahau `.esx` design and an Open Intent `.zip`. Run locally, it can also upload floor plans and place access points in a Cisco Meraki Dashboard network.

Live site (conversion only): https://eyserit.github.io/esx-open-intent-converter/

## Quick start: run it locally (conversion and Meraki upload)

You need [Node.js](https://nodejs.org) 22 or later. Check with `node --version`. There are no packages to install.

1. Get the code. Either clone it:

   ```sh
   git clone https://github.com/Eyserit/esx-open-intent-converter.git
   cd esx-open-intent-converter
   ```

   Or click **Code → Download ZIP** on GitHub, unzip it, and `cd` into the unzipped folder (`esx-open-intent-converter-main`).

2. Start it:

   ```sh
   npm start
   ```

3. Open http://localhost:8000. Leave the terminal open while you use it, and press Ctrl+C to stop.

If port 8000 is busy, use `PORT=8001 npm start` and open http://localhost:8001. To update a clone later, run `git pull`.

Step-by-step instructions for macOS and Windows, including installing Node.js and Git, are in [README.txt](README.txt).

## What the page does

- Drop one file on the page. The direction is detected from the file's contents, not its name.
- It runs entirely in your browser. Nothing is uploaded or stored, and there are no requests after the page loads.

## What converts

**.esx to Open Intent** mirrors `esx2oi.py` (the port is tested for parity against it). One thing to be aware of: like `esx2oi.py`, it exports fixed radios (2.4 GHz channel 11 and 5 GHz channel 36, both at 6 dBm) rather than the design's real radios.

Floor plans larger than 8000 px on their longest side are shrunk to 8000 px, and every pixel position (APs, walls, the plan's pixel size) is scaled to match. Hamina shrinks larger images on import but keeps reading positions against the original size, which put every AP and wall in the wrong place. Smaller plans are untouched and match `esx2oi.py` exactly.

**Open Intent to .esx** writes floors, walls, and APs with their radios. Antenna patterns come from the bundled library in `src/antenna-library.json`. If a model isn't in the library, a generic omni pattern is used, and the page reports how many APs used it.

Anything else is rejected with an explicit error rather than guessed at.

## Converter only, without Node

Any static file server works, for example:

```sh
python3 -m http.server 8000
```

This serves the converter only. The Meraki upload needs `npm start` (see Quick start).

## Send floor plans to Meraki (local only)

Run `npm start` and open http://localhost:8000. Set `PORT` to use another port. It needs Node 22 or later. The public site has no Meraki step.

After a conversion, the Done card offers "Send to Meraki". The flow:

1. Pick the region, then paste a Dashboard API key.
2. Pick the organisation and the wireless network.
3. Pick the floors to send.
   Each floor has a "Name in Meraki", suggested from its name. Meraki allows up to 25 characters: letters, numbers, spaces, - and _.
4. Place each floor on the map (search an address, drag the outline, or use "Move outline here") and set its rotation.
   With 2 or more floors, tick "These floors are one building: place them together" to place the largest ticked floor once; every floor shares its centre and rotation.
5. Upload. A floor is created, or updated if a floor plan with exactly the same name exists. The outline position and rotation are applied in Meraki.

6. Access points are then placed on the floors that uploaded. Each of your design's APs (an Open Intent input counts every AP) is matched to an AP already claimed into the chosen network, first by name (case and surrounding spaces ignored), then by BSSID. Matched APs are placed on the floor plan at their design position, with no review step, and a results list follows.
   - An AP already on another floor plan is left alone. One already on this floor plan is moved only if it is more than 0.5 m from the design position.
   - BSSIDs come from Ekahau survey data only. A predictive design, or an Open Intent input, has none, so it matches by name only.
   - If the BSSID lookup fails with a 403, the API key lacks read access to wireless status.
   - Only floors uploaded in this run get APs.

The relay uses these Meraki endpoints for access points: `GET /organizations/{orgId}/devices?networkIds[]=…&productTypes[]=wireless` for the devices, each floor plan's `devices[]` for which floor plan an AP is on, `GET /organizations/{orgId}/wireless/ssids/statuses/byDevice` for BSSIDs, and `PUT /devices/{serial}` to place an AP. `GET /networks/{id}/devices` is not used because Meraki marks it deprecated.

**What is stored and where data goes.** Files are converted in the browser and nothing is stored. The API key exists only in page memory and in the request that carries it, and goes only to Meraki. The local server relays requests to Meraki and keeps nothing.

**Outside services.** The map uses OpenStreetMap tiles and Nominatim address search. They see your IP address and the area or text you search for. They never see your API key or your files.

**Limits.** An uploaded file can be at most 100 MB. The cap applies to the public site too.

**Checking the page without a real Dashboard.** `PORT=8123 node tools/fake-meraki.mjs` serves the page against a fake Meraki, with a few fake access points. Use the API key `test-key`.

Leaflet 1.9.4 (BSD-2-Clause) is included unchanged in `vendor/leaflet/`, with its licence.

## Tests and checks

No npm packages are needed, only Node 22 or later (built and tested on Node 26).

- `npm test` runs the test suite against the small synthetic fixtures in `tests/fixtures/`.
- `npm run check` runs `node --check` on every `.js` and `.mjs` file.
- `npm run test:sample` runs local-only checks against a real design. It needs a private `ekahau_sample.esx` in the repo root and a `.venv` with Pillow. Never commit real designs.
- `npm run test:survey` runs a local-only check that BSSIDs are read from a real Ekahau survey. It needs a private `survey_sample.esx` in the repo root (or set `SURVEY_SAMPLE` to another path) and prints counts only. Without the file it is skipped, as `test:sample` is without its file.

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
