# Send to Meraki Dashboard: design

Date: 2026-10-11
Status: awaiting review

## Goal

After a conversion, let the user upload the design's floor plans to a Cisco Meraki Dashboard network. The user places each floor on a map, and each floor is created or updated in Meraki as a floor plan. The Meraki calls go through a small local Node server on the user's own Mac, so the API key travels only from that machine to Meraki. No third party ever handles it. The public GitHub Pages site stays exactly as it is, apart from a new 100 MB file cap.

Built for one user (the project owner) running `npm start` on this Mac.

### Out of scope

- Placing access points on the floor plans.
- Reading geo data from files. Ekahau projects normally have no GPS reference points, and no Open Intent sample with geo data exists. Every floor is placed by hand on the map. Conversion code and parity with `esx2oi.py` are untouched.
- A hosted backend, a cloud relay, or the Meraki option on the public site.
- Packaged desktop apps, Windows support, or setup for other users.
- Satellite imagery (Esri's keyless terms are unclear; see Decisions).
- Retrying anything other than Meraki's 429 responses.
- Changing the site's colours to the original brief's `#050505` / `#F2711C→#FFA15A`. The new screens use the live site's tokens (`#0a0908`, `#ff7a2f`).

## Decisions

| Topic | Decision |
|---|---|
| Where the relay runs | Locally only (`npm start`), Node standard library, no npm packages |
| Who runs it | The owner, on macOS, with the Node already installed (22+) |
| Server shape | Task-level routes on the local server; the Meraki client lives in Node (approach 1) |
| Public site | Hides the Meraki option; it appears only when `GET /api/health` answers |
| Dropped-file cap | 100 MB, on both the public and local page |
| Floor position | Placed by hand on a map for every floor; no geo read from files |
| Map library | Leaflet 1.9.4, copied unchanged into `vendor/leaflet/` with its licence; no npm, no CDN |
| Map imagery | OpenStreetMap standard tiles only, with on-map attribution |
| Getting to the building | One box: coordinates (`lat, lng`) jump there; anything else searches OpenStreetMap Nominatim on Enter only |
| Map layout | A near full-screen dialog over the page (option B) |
| Visual design | Claude's mockup in the live card's style (approved) |
| Name matching | Exact match, case and spaces included. Two or more existing plans with the name → that floor can't be uploaded |
| What is sent to Meraki | `name`, `imageContents` and `topLeftCorner` + `topRightCorner` (adjacent, so Meraki applies the rotation) |
| 429 handling | Wait `Retry-After` seconds (1 if missing), up to 3 retries per call, then fail that floor |

### Facts checked

- **Meraki `POST /networks/{networkId}/floorPlans`:** `name` and `imageContents` (base64 PNG, GIF or JPG) are required. Either `center` or two adjacent corners must be given. `center` alone places the plan with no rotation; two adjacent corners rotate it to match. No two points may share a lat/lng. The docs give no image size limit, so we don't invent one; Meraki's own rejection reason is shown instead. Images are stored as PNG.
- **Esri World Imagery** without a key is a grey area, and Esri's docs point to API keys or ArcGIS accounts. The user chose not to use it.
- **To confirm while planning:** the current OpenStreetMap tile and Nominatim usage policies (attribution, Referer, one search per second), and the `PUT /networks/{networkId}/floorPlans/{floorPlanId}` body, which is expected to match POST.

## Architecture

```
browser (http://localhost:8000)                 local Node server (127.0.0.1:8000)          Meraki
 index.html / app.js  ── static files ───────── server/server.js
 meraki-flow.js       ── POST /api/* JSON ────▶ server/meraki-routes.js ─▶ meraki-client.js ─▶ api.meraki.*
 map-place.js ─ Leaflet ─ tiles ─▶ tile.openstreetmap.org
             └─ search ─▶ nominatim.openstreetmap.org
```

On GitHub Pages the same page loads, `/api/health` fails, and nothing Meraki-related is shown or loaded.

### Units

| Unit | Job | Depends on |
|---|---|---|
| `server/server.js` | Listens on `127.0.0.1` only. Serves the repo's static files and routes `/api/*`. Parses JSON bodies with a size cap. Rejects `/api/*` requests whose `Origin` isn't its own. Logs only its startup line. | `meraki-routes.js` |
| `server/meraki-routes.js` | One handler per route. Validates the request JSON, calls the client, and turns its errors into `{ error }` plus a status. | `meraki-client.js` |
| `server/meraki-client.js` | Region → host, auth header, `Link` paging, wireless filter, 429 retry, exact name matching, POST vs PUT, and removing the key from error text. Takes `fetch` and `sleep` as parameters so tests fake both. | injected `fetch`, `sleep` |
| `src/geo.js` | Pure maths: floor width and length in metres + centre (lat/lng) + rotation (degrees clockwise from north) → four corners; the two sent are top-left and top-right. | — |
| `src/floors.js` | From an Open Intent design plus zip entries, lists floors: name, metre width and length, image bytes and type (from `map_uri`). | — |
| `meraki-flow.js` | The stepper: Connect → Network → Floors → Uploading → Finished, in the existing card. Holds the key in one variable. | `/api/*`, `map-place.js`, `src/floors.js` |
| `src/meraki-messages.js` | All copy for the flow, as pure functions (like `src/messages.js`). | — |
| `map-place.js` | The map dialog: Leaflet map, search box, to-scale outline with move and rotate (pointer and keyboard), Done/Close. Returns `{ center, rotation }` or nothing. | Leaflet, `src/geo.js` |
| `vendor/leaflet/` | Leaflet 1.9.4 JS, CSS, images and licence, unchanged. | — |

**Changed:**
- `app.js`: the 100 MB check, the health check, and passing the finished conversion to `meraki-flow.js`.
- `index.html` / `styles.css`: the Send to Meraki pill, the stepper and dialog styles, and Geist Mono.
- `package.json`: `npm start`.
- `README.md`.

**Unchanged:** `src/convert.js`, `src/esx-to-oi.js`, `src/oi-to-esx.js`, `src/zip.js`, `src/detect.js`, `src/fit-image.js`, and parity with `esx2oi.py`.

### Which package the floors come from

The Meraki flow always reads the Open Intent side of the conversion:
- for `.esx` → Open Intent, the converted output (after the Hamina 8000 px fit);
- for Open Intent → `.esx`, the dropped input.

`convert()` will return the Open Intent design and its image entries alongside the bytes it does now. Its existing results and tests are otherwise unchanged.

## API routes

All routes are `POST` with a JSON body. Every body carries `region` (`global`, `canada`, `china`, `india`, `fedramp`) and `apiKey`. Responses are JSON. Errors are `{ "error": "<plain reason>" }` with a 4xx/5xx status.

| Route | Extra body | Meraki calls | Returns |
|---|---|---|---|
| `GET /api/health` | — | none | `{ "ok": true }` |
| `/api/organizations` | — | `GET /organizations` (paged) | `[{ id, name }]` |
| `/api/networks` | `organizationId` | `GET /organizations/{id}/networks` (paged) | `[{ id, name, url }]`, only where `productTypes` includes `wireless` |
| `/api/floor-plans` | `networkId` | `GET /networks/{id}/floorPlans` | `[{ id, name }]` |
| `/api/floor-plans/upload` | `networkId`, `name`, `imageContents`, `topLeftCorner`, `topRightCorner` | re-lists plans, then `POST` or `PUT` | `{ action: "created" \| "updated", floorPlanId }` |

**Region hosts:**

| `region` | Host |
|---|---|
| `global` | `api.meraki.com` |
| `canada` | `api.meraki.ca` |
| `china` | `api.meraki.cn` |
| `india` | `api.meraki.in` |
| `fedramp` | `api.gov-meraki.com` |

All are reached at `https://<host>/api/v1`. Any other `region` is a 400.

**Body size cap:** 140 MB, which holds a 100 MB image after base64.

## The flow

1. **Done card (local only):** Download (primary), Send to Meraki, Convert another.
2. **Connect:**
   - You pick a region (default Global) and enter the API key (`type="password"`, `autocomplete="off"`).
   - Connect calls `/api/organizations`. Errors show inline under the key, and the key keeps its value.
3. **Network:**
   - You pick an organisation, then a network. Choosing an organisation loads its networks.
   - "No wireless networks in this organisation" is shown inline.
4. **Floors:** one row per floor in the package. Each row has:
   - a checkbox
   - the name, in Geist Mono
   - an action label: `Create`, `Update existing`, or `Can't upload` with its reason
   - a placement tag: `Not placed yet` or `Placed`
   - a `Place on map` / `Edit` button

   Floors are ticked by default unless blocked. **Upload N floors** is enabled only when at least one floor is ticked and every ticked floor is placed. A hint says why when it's disabled.
5. **Map dialog:**
   - **Search box.** Coordinates jump straight there, with no outside request. Anything else searches Nominatim, and Enter jumps to the first result.
   - **Where it opens.** On the last placement in this session if there is one; otherwise on a world view.
   - **Outline.** Drawn to the floor's metre size, centred on the map's centre until moved.
   - **Moving and rotating.** Drag the body to move it and drag the handle to rotate. There's also a rotation slider with a degrees readout. On the keyboard, arrows move it, Shift+arrows move it further, and `[` / `]` rotate it.
   - **Closing.** Done saves the placement. Close or Esc discards it. Focus returns to the floor's button.
6. **Uploading:**
   - Floors upload one at a time, each showing Waiting, Uploading, Created / Updated, or Failed with its reason.
   - A failure doesn't stop the rest.
   - Progress is announced through the existing `aria-live` region.
7. **Finished:**
   - Shows "N floors sent to <network>" with counts of created, updated and failed.
   - Buttons: **Open in Dashboard** (the network's `url`) and Convert another.
   - If any floors failed, there's also **Back to floors**, which keeps the placements so failed floors can be sent again.
8. **Back and Disconnect:**
   - Back is available on each step.
   - Disconnect clears the key from memory and returns to the Done card.

## The API key

- **In the page:** one variable inside `meraki-flow.js`, never in `localStorage`, `sessionStorage`, cookies, URLs or the DOM after Connect. The input is cleared once connected. It's gone on Disconnect, Convert another, or closing the tab.
- **On the server:** it exists only in the request that carries it. It's never stored or logged, and never put in a URL; it travels only in the `Authorization: Bearer` header to Meraki. Every error leaving `meraki-client.js` has the key replaced with `[redacted]`, and a test checks this for each error path.
- **The server** binds to `127.0.0.1` only. `/api/*` rejects any request whose `Origin` header isn't `http://localhost:<port>` or `http://127.0.0.1:<port>`, so other websites open in the browser can't use the relay.

## Geometry

- Corners are worked out on a local flat approximation around the centre. Metres east and north convert to degrees with 1° latitude ≈ 111 320 m, and 1° longitude ≈ 111 320 · cos(latitude) m. That's accurate to a few centimetres across a building, and the tests pin the tolerance.
- **Rotation 0** means the image's top edge runs due east. Positive values rotate clockwise.
- **Width** is the image's horizontal side and **length** its vertical side, both read from the floor's `meters` dimension. The outline uses the same values, so the outline on the map and the plan in Meraki match.

## Errors

| Where | Message |
|---|---|
| Dropped file over 100 MB | "This file is over 100 MB." (Not supported card; public and local) |
| Connect, 401/403 | "That API key wasn't accepted by Meraki (<Region>)." |
| Connect, can't reach host | "Couldn't reach <host>." |
| Connect, zero organisations | "This API key doesn't have access to any organisations." |
| Network, none wireless | "No wireless networks in this organisation." |
| Map search, no result | "No match for that address." |
| Map search, failed | "Address search isn't available right now. You can paste coordinates instead." |
| Upload, 429 after retries | "Meraki is rate-limiting requests — try again in a minute." |
| Upload, duplicate found at upload time | "2 floor plans named “<name>” in this network: rename one in Dashboard." |
| Upload, other Meraki 4xx | Meraki's own `errors[]` text, with the key removed |
| Local server stopped | "The local server isn't running — restart it with `npm start`." |
| Anything else | "Something went wrong talking to Meraki." |

The server never sends stack traces.

## Testing

All tests use `node:test` with no packages, and run with `npm test` alongside the existing 130.

- **`tests/meraki-client.test.js`** (faked `fetch` and `sleep`):
  - every region host, and rejecting unknown regions
  - the Bearer header
  - `Link` paging across several pages
  - the wireless filter
  - 429: honours `Retry-After`, uses 1 s when it's missing, gives up after 3 retries
  - other statuses aren't retried
  - name matching: exact, case-sensitive, a duplicate blocks
  - POST when there's no match, PUT when there's one
  - the upload re-lists plans before deciding
  - the key absent from every error message, including Meraki error bodies and network errors that echo it
- **`tests/server.test.js`** (real server on an ephemeral port, with a fake client injected):
  - static files and content types, and blocking `..` path traversal
  - `/api/health`
  - each route's validation
  - a wrong `Origin` gets 403
  - a body over the cap gets 413
  - listens on `127.0.0.1`
  - no per-request output
- **`tests/geo.test.js`:**
  - at 0° the top edge runs east, at 90° south
  - the corners are the right metre distances apart within 5 cm
  - the two corners sent are adjacent and distinct
- **`tests/floors.test.js`:** floors from the fixture's converted output and from an Open Intent input: names, metre sizes, and image bytes and type.
- **`tests/meraki-messages.test.js`:** each message and label.
- **`tests/convert.test.js`:** the extra Open Intent design and images in the result, and the 100 MB cap.
- **By hand in the browser preview, and reported as manual:**
  - the full flow against a faked `/api`
  - the map dialog: pointer, keyboard only, Esc and focus return
  - phone width (375 px)
  - text contrast of 4.5:1 or better on the new elements

  A real-Meraki check is done by the owner with their own key.

## Done means

- The local flow uploads selected floors to a chosen wireless network: created or updated by exact name, with the outline position and rotation applied in Meraki.
- The public site behaves as before, plus the 100 MB cap.
- The new tests and all existing tests pass, and `npm run check` is clean.
- The README explains `npm start` and the Meraki flow. It states the no-storage guarantee: files are converted in the browser and nothing is stored; the API key exists only in page memory and in the request that carries it, and goes only to Meraki. It also names the outside services the map uses (OpenStreetMap tiles and Nominatim) and what they can see.
- Leaflet's licence is included, and the README notes it.
