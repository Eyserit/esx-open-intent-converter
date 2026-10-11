# Send to Meraki Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a conversion, upload the design's floors to a Meraki Dashboard wireless network, each placed by hand on an OpenStreetMap map, through a local Node relay that never stores the API key.

**Architecture:**
- **Local server.** `npm start` runs a Node standard-library server on `127.0.0.1:8000`. It serves the page (from an allow-list) and task-level `/api/*` routes. The routes call a Meraki client with an injected `fetch` and `sleep`.
- **The page.** It loads the Meraki flow (`meraki-flow.js`) and the map dialog (`map-place.js`, Leaflet ESM) with dynamic imports, only when `api/health` answers. On GitHub Pages nothing Meraki-related loads.
- **Pure modules.** Floors, geometry, name matching, regions and copy live in pure modules under `src/`, tested with `node:test`.

**Tech Stack:** Plain ES modules, Node 22+ standard library (`node:http`, global `fetch`), `node:test`, Leaflet 1.9.4 (vendored ESM build), OpenStreetMap tiles and Nominatim.

**Spec:** `docs/superpowers/specs/2026-10-11-meraki-upload-design.md` (read it with this plan).

## Global Constraints

- No npm dependencies. No build step. The only vendored third-party code is `vendor/leaflet/` (Leaflet 1.9.4, unchanged, with its `LICENSE`).
- Don't change `src/esx-to-oi.js`, `src/oi-to-esx.js`, `src/zip.js`, `src/detect.js` or `src/fit-image.js`. All existing tests stay green unmodified, including the exact-match tests against `esx2oi.py`.
- The API key is never written to storage, logs, URLs, the DOM after Connect, or any error message. Any error text that could contain it goes through `redact`.
- The server binds `127.0.0.1` only and prints nothing per request.
- The dropped-file cap is `MAX_FILE_BYTES = 100 * 1024 * 1024`, with the message `This file is over 100 MB.`
- The relay body cap is `MAX_BODY_BYTES = 140 * 1024 * 1024`.
- Region keys, labels and hosts are exactly:
  - `global` Global `api.meraki.com`
  - `canada` Canada `api.meraki.ca`
  - `china` China `api.meraki.cn`
  - `india` India `api.meraki.in`
  - `fedramp` US FedRAMP `api.gov-meraki.com`
- Name matching is exact (case and spaces count). Two or more existing matches blocks the floor.
- 429: wait `Retry-After` seconds (1 if missing or unparseable, capped at 60), up to 3 retries, then `Meraki is rate-limiting requests — try again in a minute.`
- OSM tiles come from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with attribution `© OpenStreetMap contributors` linked to `https://www.openstreetmap.org/copyright`. Search uses `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=…` on Enter only, at most once per second. No `Referrer-Policy` that suppresses the Referer.
- Where a step lists several tests, write them **one at a time in the listed order**, each red then green, with the full suite run after each (CLAUDE.md: never more than one failing test).
- `meraki-flow.js` uses `Uint8Array.prototype.toBase64()`, which current Chrome, Safari and Firefox have. Don't polyfill it.
- Copy is UK English. User-facing strings are exactly as written in the spec's Errors table and in this plan.
- Commit prefixes are `behavior:` or `structure:`. After each task is green, run the `code-simplifier:code-simplifier` agent on that task's changed files, re-run `npm test` and `npm run check`, and commit any change separately as `structure: simplify`. Never push.
- Work in a git worktree on branch `meraki-upload`, created via `superpowers:using-git-worktrees`. The spec commit is already on that branch.

## Review Focus

1. **Static files beyond the page** (`/ekahau_sample.esx`, `/.git/config`, `/.venv/…`, `/../x`, `/%2e%2e/x`) must return 404. The server serves only an allow-list. Pinned in Task 7.
2. **A request with a foreign `Host` header** (DNS rebinding: `Host: evil.example:8000`) must get 403 on every path, even with a matching-looking Origin. Pinned in Task 7.
3. **A Meraki `Link: rel=next` or redirect `Location` pointing outside the region's domain** must not be followed, because following it would send the key there. The call fails with `Something went wrong talking to Meraki.` Pinned in Tasks 4 and 5.
4. **A huge `Retry-After` (e.g. `3600`)** must not freeze an upload for an hour. The wait is capped at 60 s. Pinned in Task 4.
5. **Two floors with the same name in one package** would both target one Meraki plan. The second is blocked with `Two floors in this design are named “<name>”.` Pinned in Task 8.

---

## File map

| File | New/changed | Responsibility |
|---|---|---|
| `src/convert.js` | changed | Also returns `openintent: { design, images }`; exports `MAX_FILE_BYTES` |
| `src/messages.js` | changed | `too-large` card; `done` card unchanged |
| `src/floors.js` | new | `listFloors(design, images)` |
| `src/geo.js` | new | `cornersFor(…)`, `parseCoordinates(text)` |
| `src/meraki-regions.js` | new | `REGIONS` table (shared by server and page) |
| `src/floor-plan-match.js` | new | `matchFloorPlan(name, plans)` (shared by server and page) |
| `src/meraki-messages.js` | new | Floor rows, upload button, finished card, page-side error strings |
| `server/meraki-client.js` | new | `createMerakiClient({ fetch, sleep })`, `MerakiError`, `redact` |
| `server/meraki-routes.js` | new | `createRoutes(client)` |
| `server/server.js` | new | `createAppServer({ root, routes, port })` |
| `server/start.js` | new | Entry point for `npm start` |
| `tools/fake-meraki.mjs` | new | Runs the server with an in-memory fake client, for manual UI checks |
| `vendor/leaflet/` | new | Leaflet 1.9.4 `leaflet-src.esm.js`, `leaflet.css`, `images/`, `LICENSE` |
| `map-place.js` | new | Map dialog |
| `meraki-flow.js` | new | Stepper UI |
| `app.js`, `index.html`, `styles.css` | changed | Size cap, health check, Send to Meraki button, panel and dialog markup and styles, Geist Mono |
| `package.json` | changed | `"start": "node server/start.js"` |
| `README.md`, `docs/HANDOFF.md` | changed | Running locally, no-storage guarantee, outside services, Leaflet licence |

---

### Task 1: Hand the Open Intent package out of `convert()`, and cap file size

**Files:**
- Modify: `src/convert.js`, `src/messages.js`, `app.js`
- Test: `tests/convert.test.js`, `tests/messages.test.js`

**Interfaces:**
- Produces:
  - `convert(...)` resolves to its existing fields plus `openintent: { design: object, images: Map<string, Uint8Array> }`.
    - For `.esx` → Open Intent, these are the post-Hamina-fit `openintent` and `images`.
    - For Open Intent → `.esx`, they are the parsed input design and the input zip entries.
  - `export const MAX_FILE_BYTES = 104857600` in `src/convert.js`.
  - `cardFor({ type: 'too-large' })` returns `{ state: 'unsupported', title: 'This file is over 100 MB.' }`.

- [ ] **Step 1: Write the failing test** in `tests/convert.test.js`

```js
test('both directions hand back the Open Intent design and its images', async () => {
  const esxResult = await convert(fixtureBytes, 'a.esx', options);
  assert.equal(esxResult.openintent.design.floorplans[0].name, 'Ground');
  const path = esxResult.openintent.design.floorplans[0].map_uri.replace('file://', '');
  assert.ok(esxResult.openintent.images.get(path) instanceof Uint8Array);

  const oiResult = await convert(esxResult.bytes, 'a.zip', options);
  assert.equal(oiResult.openintent.design.floorplans[0].name, 'Ground');
  assert.ok(oiResult.openintent.images.get(path) instanceof Uint8Array);
});
```

- [ ] **Step 2:** Run `node --test tests/convert.test.js`. Expected: FAIL, `Cannot read properties of undefined (reading 'design')`.
- [ ] **Step 3:** In `convertEsx` and `convertOpenIntent`, add `openintent: { design, images }` to the returned object. Use the fitted `openintent` and `images` for `.esx`, and `design` and `entries` for Open Intent.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Write the failing test** in `tests/messages.test.js`: `test('a file over the cap gets the too-large card', …)` asserts `cardFor({ type: 'too-large' })` deep-equals `{ state: 'unsupported', title: 'This file is over 100 MB.' }`.
- [ ] **Step 6:** Run `npm test`. Expected: only that test fails.
- [ ] **Step 7:** Add `export const MAX_FILE_BYTES = 100 * 1024 * 1024;` to `src/convert.js` and a `case 'too-large'` to `cardFor`.
- [ ] **Step 8:** In `app.js`, change `handleFiles` to `if (files[0].size > MAX_FILE_BYTES) return show({ type: 'too-large' });` before `convertFile`, so an oversized file is never read.
- [ ] **Step 9:** Run `npm test && npm run check`. Expected: all pass.
- [ ] **Step 10:** Commit: `behavior: return the Open Intent package from convert and cap dropped files at 100 MB`. Then simplify, re-test, and commit `structure: simplify` if anything changed.

---

### Task 2: List floors from an Open Intent package

**Files:**
- Create: `src/floors.js`
- Test: `tests/floors.test.js`

**Interfaces:**
- Consumes: `convert(...).openintent` (Task 1).
- Produces: `listFloors(design, images) -> Floor[]`, where:
  - `Floor = { name: string, widthM: number|null, lengthM: number|null, image: { bytes: Uint8Array, type: 'png'|'jpeg'|'gif' } | null, problem: string|null }`
  - Order follows `design.floorplans`.
  - `problem` is the first that applies, else `null`:
    - `The floor image is missing.` when `map_uri` is absent or its path isn't in `images`
    - `The floor image isn't PNG, JPG or GIF.` when the magic bytes match none of those
    - `The floor has no size in metres.` when there's no `unit: 'meters'` dimension with positive `width` and `length`
  - `widthM` is the `meters` dimension's `width`, and `lengthM` its `length`.

- [ ] **Step 1: Write the failing tests** in `tests/floors.test.js`, building the package with `convert(fixture.esx)`:
  - `test('lists each floor with its metre size and PNG image', …)`: for `Ground`, `widthM === 20`, `lengthM === 15`, `image.type === 'png'`, `problem === null`.
  - `test('a missing image is a problem, not a crash', …)`: delete the image from the Map, and `problem === 'The floor image is missing.'`, `image === null`.
  - `test('a non-image file is a problem', …)`: set the bytes to `new TextEncoder().encode('hello')`, and expect the PNG/JPG/GIF problem.
  - `test('JPEG and GIF are recognised', …)`: bytes starting `FF D8 FF` give `'jpeg'`, and `47 49 46 38` give `'gif'`.
  - `test('a floor without metres is a problem', …)`: remove the `meters` dimension, and `problem === 'The floor has no size in metres.'`.
  - `test('a floor without map_uri is a problem', …)`.
- [ ] **Step 2:** Run `node --test tests/floors.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `listFloors` in `src/floors.js`, with magic-byte checks as in `src/oi-to-esx.js` `imageFormatOf`. Don't import that file's internal function; copy the two signatures and add GIF.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `behavior: list floors, sizes and images from an Open Intent package`. Then simplify, re-test, and commit if changed.

---

### Task 3: Floor corners and coordinate parsing

**Files:**
- Create: `src/geo.js`
- Test: `tests/geo.test.js`

**Interfaces:**
- Produces:
  - `cornersFor({ center: {lat, lng}, widthM, lengthM, rotation }) -> { topLeft, topRight, bottomRight, bottomLeft }`, each `{ lat, lng }`. `rotation` is in degrees, clockwise, and 0 means the image's top edge runs due east.
  - `parseCoordinates(text) -> {lat, lng} | null`.
- **Algorithm (pinned by the spec):**
  - Use a local flat approximation. Take the corner offsets before rotation in metres (east x, north y): TL(−w/2, +l/2), TR(+w/2, +l/2), BR(+w/2, −l/2), BL(−w/2, −l/2).
  - Rotate clockwise by θ: `x' = x·cosθ + y·sinθ`, `y' = −x·sinθ + y·cosθ`.
  - Convert: `lat = lat0 + y'/111320`, `lng = lng0 + x'/(111320·cos(lat0))`.

- [ ] **Step 1: Write the failing tests** in `tests/geo.test.js`, with a haversine `metresBetween(a, b)` helper in the test file:
  - `test('at 0° the top edge runs due east', …)`, at centre `{lat: 53.35, lng: -6.26}`, 40 × 20 m: `topLeft.lat === topRight.lat` (within 1e-9) and `topRight.lng > topLeft.lng`.
  - `test('at 90° the top edge runs due south', …)`: `topRight.lat < topLeft.lat` and the longitudes are equal within 1e-9.
  - `test('sides keep their metre lengths within 5 cm', …)`, for rotations `[0, 37, 90, -120]` and latitudes `[0, 53.35, 64]`: top edge ≈ 40, left edge ≈ 20, `|Δ| < 0.05`.
  - `test('the centre is the middle of the diagonal', …)`.
  - `test('parses coordinates in common forms', …)`: `'53.3498, -6.2603'`, `'53.3498 -6.2603'` and `' 53.3498,-6.2603 '` → `{lat: 53.3498, lng: -6.2603}`.
  - `test('rejects text and out-of-range coordinates', …)`: `'Dublin'`, `'91, 0'`, `'0, 181'`, `''`, `'1,2,3'` → `null`.
- [ ] **Step 2:** Run `node --test tests/geo.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement both functions in `src/geo.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `behavior: work out floor corners from centre, size and rotation, and parse typed coordinates`. Then simplify, re-test, and commit if changed.

---

### Task 4: Meraki client core: regions, auth, errors, redaction, retries, redirects

**Files:**
- Create: `src/meraki-regions.js`, `server/meraki-client.js`
- Test: `tests/meraki-client.test.js`

**Interfaces:**
- Produces:
  - `REGIONS` in `src/meraki-regions.js`: `{ global: { label: 'Global', host: 'api.meraki.com', domain: 'meraki.com' }, canada: {…'api.meraki.ca', domain 'meraki.ca'}, china: {…'api.meraki.cn', 'meraki.cn'}, india: {…'api.meraki.in', 'meraki.in'}, fedramp: { label: 'US FedRAMP', host: 'api.gov-meraki.com', domain: 'gov-meraki.com' } }`.
  - `class MerakiError extends Error { status }`: `message` is user-facing copy and `status` is the HTTP status the route will return.
  - `redact(text, apiKey) -> string`: replaces every occurrence with `[redacted]`.
  - `createMerakiClient({ fetch, sleep }) -> client`. For this task, internally `request(ctx, method, path, body?) -> { json, headers }`, where `ctx = { region, apiKey }`. It's exercised through a temporary export `client._request`, which Task 5 replaces with public methods. Rules:
    - An unknown region → `MerakiError(400, 'Unknown Meraki region.')`.
    - URL is `https://<host>/api/v1<path>`. Headers: `Authorization: Bearer <key>`, `Accept: application/json`, plus `Content-Type: application/json` when there's a body. `redirect: 'manual'`, `signal: AbortSignal.timeout(120000)`.
    - **3xx with `Location`:** follow if the URL's hostname is the region domain or ends with `.<domain>`, at most 3 hops, keeping method, body and auth. Otherwise → `MerakiError(502, 'Something went wrong talking to Meraki.')`.
    - **429:** `await sleep(ms)` with `min(Retry-After, 60)` seconds (1 s if missing or not a number), at most 3 retries, then `MerakiError(429, 'Meraki is rate-limiting requests — try again in a minute.')`.
    - **401** → `MerakiError(401, "That API key wasn't accepted by Meraki (<label>).")`.
    - **Other 4xx** → `MerakiError(502, <body.errors joined with ' '> || 'Something went wrong talking to Meraki.')`.
    - **5xx** → `MerakiError(502, 'Something went wrong talking to Meraki.')`.
    - **`fetch` throws** (network error or timeout) → `MerakiError(502, "Couldn't reach <host>.")`.
    - Every `MerakiError` message passes through `redact(…, apiKey)`.

- [ ] **Step 1: Write the failing tests** with a `fakeFetch(responses)` helper that records calls and returns `new Response(JSON.stringify(body), { status, headers })` in order, and `const sleeps = []; const sleep = async (ms) => { sleeps.push(ms); }`:
  - `test('each region calls its own host with a Bearer key', …)`: loop over `REGIONS` and assert `calls[0].url === 'https://api.meraki.ca/api/v1/organizations'` (etc.) and `calls[0].init.headers.Authorization === 'Bearer k123'`.
  - `test('an unknown region is rejected before any request', …)`: status 400, no calls.
  - `test('401 says the key was not accepted, naming the region', …)`: message `That API key wasn't accepted by Meraki (Canada).`
  - `test('429 waits for Retry-After then succeeds', …)`: `[429 {Retry-After: '2'}, 200]` → `sleeps` deep-equals `[2000]`.
  - `test('429 without Retry-After waits 1 second', …)`.
  - `test('a huge Retry-After is capped at 60 seconds', …)`: `'3600'` → `[60000]`.
  - `test('gives up after 3 retries with the rate-limit message', …)`: four 429s → status 429, `sleeps.length === 3`.
  - `test('other errors are not retried', …)`: a 500 → one call, status 502.
  - `test('Meraki error text is passed on with the key removed', …)`: 400 `{errors: ['Key k123 lacks access']}` → message `Key [redacted] lacks access`.
  - `test('a network error names the host and never the key', …)`: `fetch` throws `new TypeError('failed https://x?key=k123')` → message `Couldn't reach api.meraki.com.`, not containing `k123`.
  - `test('follows a redirect within the region domain, keeping the key', …)`: 307 `Location: https://n149.meraki.com/api/v1/organizations` → the second call goes to that URL with the same Authorization.
  - `test('refuses a redirect outside the region domain', …)`: `Location: https://evil.example/…` → status 502, only 1 call, the generic message.
  - `test('meraki.com.evil.example is outside the domain', …)`.
- [ ] **Step 2:** Run `node --test tests/meraki-client.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `REGIONS`, `MerakiError`, `redact` and `createMerakiClient` with the internal `request`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `behavior: add the Meraki request core with retries, redirects and key redaction`. Then simplify, re-test, and commit if changed.

---

### Task 5: Meraki client: organisations, wireless networks, floor plans, upload

**Files:**
- Create: `src/floor-plan-match.js`
- Modify: `server/meraki-client.js`
- Test: `tests/meraki-client.test.js`, `tests/floor-plan-match.test.js`

**Interfaces:**
- Consumes: Task 4's `request`.
- Produces:
  - `matchFloorPlan(name, plans) -> { action: 'create' } | { action: 'update', id } | { action: 'blocked', count }`. `plans` is `[{ id, name }]`, compared with `===`.
  - Client methods, all taking `{ region, apiKey, … }`:
    - `listOrganizations(ctx) -> [{ id, name }]`: `GET /organizations`, paged. A 403 is reported like a 401, as the key not being accepted.
    - `listWirelessNetworks({ …ctx, organizationId }) -> [{ id, name, url }]`: `GET /organizations/{id}/networks`, paged, keeping only those whose `productTypes` includes `'wireless'`.
    - `listFloorPlans({ …ctx, networkId }) -> [{ id: floorPlanId, name }]`: `GET /networks/{id}/floorPlans`.
    - `uploadFloorPlan({ …ctx, networkId, name, imageContents, topLeftCorner, topRightCorner }) -> { action: 'created'|'updated', floorPlanId }`:
      1. Re-lists the plans, then calls `matchFloorPlan`.
      2. `blocked` → `MerakiError(409, '<count> floor plans named “<name>” in this network: rename one in Dashboard.')`.
      3. `create` → `POST /networks/{id}/floorPlans`.
      4. `update` → `PUT /networks/{id}/floorPlans/{floorPlanId}`.
      5. The body is `{ name, imageContents, topLeftCorner, topRightCorner }`.
  - Path ids go through `encodeURIComponent`.
  - **Paging:** follow `Link` `rel=next` URLs under the same domain rule as redirects; a next URL outside the domain → the generic 502.
  - Remove the temporary `_request` export.

- [ ] **Step 1: Write the failing tests:**
  - `tests/floor-plan-match.test.js`:
    - `test('no match creates', …)`
    - `test('one exact match updates that plan', …)`
    - `test('case and spaces must match exactly', …)`: `'level 1'` and `'Level 1 '` vs `'Level 1'` → create.
    - `test('two matches block with the count', …)`
  - `tests/meraki-client.test.js`:
    - `test('organisations follow Link pages', …)`: page 1 has a `Link: <https://n1.meraki.com/api/v1/organizations?startingAfter=2>; rel=next` header; result from both pages in order.
    - `test('a Link page outside the domain is refused', …)`
    - `test('only wireless networks are returned, with their Dashboard url', …)`: `productTypes ['switch']` excluded, `['appliance','wireless']` included, result shape `{id, name, url}`.
    - `test('403 listing organisations says the key was not accepted', …)`
    - `test('upload creates when no plan has the name', …)`: second call is `POST …/networks/N%2F1/floorPlans` (networkId `'N/1'`), with a body deep-equal to the four fields; returns `{ action: 'created', floorPlanId }` from the response.
    - `test('upload updates the one plan with the same name', …)`: `PUT …/floorPlans/fp1`.
    - `test('upload refuses when two plans share the name', …)`: status 409, message `2 floor plans named “Level 2” in this network: rename one in Dashboard.`, and no POST or PUT made.
    - `test('upload re-lists plans at upload time', …)`: the first call is `GET …/floorPlans`.
- [ ] **Step 2:** Run the two test files. Expected: FAIL.
- [ ] **Step 3:** Implement `matchFloorPlan` and the four client methods.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `behavior: list organisations, wireless networks and floor plans, and create or update floor plans by exact name`. Then simplify, re-test, and commit if changed.

---

### Task 6: API routes

**Files:**
- Create: `server/meraki-routes.js`
- Test: `tests/meraki-routes.test.js`

**Interfaces:**
- Consumes: the client methods from Task 5, and `MerakiError`.
- Produces: `createRoutes(client) -> Map<string, (body) => Promise<{ status, json }>>` with keys:
  - `'/api/organizations'`
  - `'/api/networks'`
  - `'/api/floor-plans'`
  - `'/api/floor-plans/upload'`

  Behaviour:
  - Validation runs before any client call. Each required field must be a non-empty string, except `topLeftCorner`/`topRightCorner`, which must be `{lat, lng}` finite numbers. A failure → `{ status: 400, json: { error: 'Missing or invalid <field>.' } }`.
  - Required fields: `region` and `apiKey` everywhere; `organizationId` for networks; `networkId` for floor-plans; and `networkId`, `name`, `imageContents` and the corners for upload.
  - A `MerakiError` → `{ status: e.status, json: { error: e.message } }`.
  - Any other throw → `{ status: 500, json: { error: 'Something went wrong talking to Meraki.' } }`, with nothing logged.
  - Success → `{ status: 200, json: <client result> }`.

- [ ] **Step 1: Write the failing tests** with a fake client object whose methods record their arguments:
  - `test('each route passes its fields to the client and returns 200', …)`, one assertion per route.
  - `test('a missing field is a 400 naming it, and the client is not called', …)`: omitting `apiKey` gives `Missing or invalid apiKey.`
  - `test('corners must be numbers', …)`: `topLeftCorner: { lat: '1', lng: 2 }` → 400.
  - `test('a MerakiError keeps its status and message', …)`
  - `test('an unexpected error is a 500 with the generic message', …)`: the fake throws `new Error('boom k123')`, and the response contains neither `boom` nor `k123`.
- [ ] **Step 2:** Run `node --test tests/meraki-routes.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `createRoutes`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `behavior: add validated Meraki API routes`. Then simplify, re-test, and commit if changed.

---

### Task 7: Local server and `npm start`

**Files:**
- Create: `server/server.js`, `server/start.js`, `tools/fake-meraki.mjs`
- Modify: `package.json`
- Test: `tests/server.test.js`

**Interfaces:**
- Consumes: `createRoutes` (Task 6).
- Produces:
  - `createAppServer({ root, routes, maxBodyBytes = MAX_BODY_BYTES }) -> http.Server` (not yet listening; the caller listens on `127.0.0.1`). `<port>` in the rules below is read from `server.address().port` at request time, so tests can listen on port 0. Export `MAX_BODY_BYTES`.
  - `server/start.js` reads `PORT` (default `8000`), builds `createMerakiClient({ fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })`, and listens on `127.0.0.1`. It prints exactly one line: `Converter running at http://localhost:<port> — press Ctrl+C to stop.`
  - `package.json`: `"start": "node server/start.js"`.
  - `tools/fake-meraki.mjs` starts `createAppServer` on port 8000 with `createRoutes(fakeClient)`. `fakeClient`:
    - accepts the key `test-key`; any other key gets a 401 `MerakiError`
    - has 2 organisations, and networks with mixed `productTypes`
    - has one existing plan named `Ground`, and two named `Level 2`
    - waits 400 ms per upload
    - returns 429 copy on the first upload of a floor named `Rate`

    It prints its URL on start.
- **Rules, in order, for every request:**
  1. The `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`, else 403 `{error:'Forbidden.'}`.
  2. `GET /api/health` → 200 `{ ok: true }`.
  3. `POST` to a route key:
     - `Origin` must be `http://localhost:<port>` or `http://127.0.0.1:<port>`, else 403.
     - A body over `MAX_BODY_BYTES` → 413 `{error:'That image is too large to send.'}`. Stop reading as soon as the cap is passed.
     - Invalid JSON → 400 `{error:'Invalid request.'}`.
     - Otherwise, the route's result.
  4. Any other `/api/*` → 404 JSON.
  5. `GET` static, allow-list only: `/` → `index.html`, plus `index.html`, `styles.css`, `app.js`, `meraki-flow.js`, `map-place.js`, and anything under `src/` or `vendor/`.
     - Decode the path, `path.resolve` it against `root`, and require the result to stay inside an allowed location. Otherwise 404.
     - Content types: `.html text/html; charset=utf-8`, `.css text/css`, `.js text/javascript`, `.json application/json`, `.png image/png`, `.svg image/svg+xml`.
     - `Cache-Control: no-store`.
  6. Anything else → 404.

  No `console.*` or `process.stdout` output anywhere in `server.js`.

- [ ] **Step 1: Write the failing tests.** Start `createAppServer({ root: repo root, routes: fakeRoutes })` listening on `127.0.0.1` port 0. Send requests with `node:http` `request`, because global `fetch` can't set `Host`, and give explicit `Host`/`Origin` headers:
  - `test('serves the page and its scripts with content types', …)`: `/` and `/app.js`.
  - `test('health answers ok', …)`
  - `test('does not serve files outside the allow-list', …)`: `/ekahau_sample.esx`, `/.git/config`, `/.venv/pyvenv.cfg`, `/package.json`, `/../etc/passwd`, `/%2e%2e/package.json`, `/src/../package.json` → all 404.
  - `test('a foreign Host is refused on every path', …)`: `Host: evil.example:<port>` on `/` and `/api/health` → 403.
  - `test('an API POST from another origin is refused', …)`: `Origin: https://evil.example` → 403, and the fake route isn't called.
  - `test('a POST without Origin is refused', …)`
  - `test('an oversized body is 413', …)`: a server built with `maxBodyBytes: 10` gets a 20-byte body.
  - `test('invalid JSON is 400', …)`
  - `test('routes get the parsed body and their status and json are returned', …)`
  - `test('prints nothing per request', …)`: wrap `process.stdout.write`, `console.log` and `console.error` for the duration and assert no calls.
- [ ] **Step 2:** Run `node --test tests/server.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `server/server.js`, `server/start.js` and the `package.json` script.
- [ ] **Step 4:** Run `npm test && npm run check`. Expected: all pass.
- [ ] **Step 5:** Run `npm start` in the background and `curl -s -H 'Host: localhost:8000' http://127.0.0.1:8000/api/health`. Expected: `{"ok":true}`. Stop the server.
- [ ] **Step 6:** Write `tools/fake-meraki.mjs` as specified above. Run it and `curl` its health route the same way. No unit test; it's a manual-check tool.
- [ ] **Step 7:** Commit: `behavior: add the local server that serves the page and relays Meraki calls`. Then simplify, re-test, and commit if changed.

---

### Task 8: Floor rows and flow copy

**Files:**
- Create: `src/meraki-messages.js`
- Test: `tests/meraki-messages.test.js`

**Interfaces:**
- Consumes: `Floor` (Task 2), `matchFloorPlan` (Task 5), `REGIONS` (Task 4).
- Produces:
  - `floorRows(floors, existingPlans, placements: Map<name, placement>, unticked: Set<name>) -> Row[]`:
    - `Row = { name, action: 'create'|'update'|'blocked', reason: string|null, placed: boolean, ticked: boolean }`
    - `blocked` applies, in order, when:
      - the floor's `problem` is set (`reason` = that problem)
      - an earlier floor in the package has the same name (`Two floors in this design are named “<name>”.`)
      - `matchFloorPlan` blocks (`<count> floor plans named “<name>” in this network: rename one in Dashboard.`)
    - `ticked` = not blocked and not in `unticked`.
  - `uploadButton(rows) -> { enabled, label, hint }`:
    - `label` is `Upload N floors`, or `Upload 1 floor`.
    - `enabled` when N ≥ 1 and every ticked row is placed.
    - `hint`:
      - `'Tick at least one floor.'` when N = 0
      - `'Place every ticked floor on the map first.'` when any ticked floor isn't placed
      - `null` otherwise
  - `ACTION_LABELS = { create: 'Create', update: 'Update existing', blocked: "Can't upload" }`.
  - `finishedCard({ networkName, results })`, where `results` is `[{ name, outcome: 'created'|'updated'|'failed', error? }]`. It returns `{ title, detail }`:
    - title: `N floors sent to <networkName>` (or `1 floor sent to …`), where N = created + updated
    - detail: `X created, Y updated.`, plus ` Z failed.` when Z > 0
  - Constants:
    - `NO_ORGANISATIONS = "This API key doesn't have access to any organisations."`
    - `NO_WIRELESS = 'No wireless networks in this organisation.'`
    - `SEARCH_NO_MATCH = 'No match for that address.'`
    - `SEARCH_UNAVAILABLE = "Address search isn't available right now. You can paste coordinates instead."`
    - `SERVER_STOPPED = "The local server isn't running — restart it with npm start."`
    - `GENERIC = 'Something went wrong talking to Meraki.'`

- [ ] **Step 1: Write the failing tests:**
  - `test('a fresh floor creates and is ticked', …)`
  - `test('an existing plan with the same name updates', …)`
  - `test('a floor with a problem is blocked with its reason and unticked', …)`
  - `test('a second floor with the same name in the design is blocked', …)`: rows `['Ground','Ground']` → the second is blocked with `Two floors in this design are named “Ground”.`, the first is not.
  - `test('duplicate plans in the network block the floor', …)`
  - `test('unticking a floor is respected', …)`
  - `test('upload needs every ticked floor placed', …)`: the enabled/label/hint cases above, including the singular.
  - `test('finished card counts outcomes', …)`: 1 created, 1 updated → `2 floors sent to HQ`, `1 created, 1 updated.`; adding a failed one adds ` 1 failed.`
- [ ] **Step 2:** Run `node --test tests/meraki-messages.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/meraki-messages.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `behavior: work out floor rows, the upload button and the flow's copy`. Then simplify, re-test, and commit if changed.

---

### Task 9: Vendor Leaflet and build the map dialog

**Files:**
- Create: `vendor/leaflet/` (from the npm tarball), `map-place.js`
- Modify: `index.html` (a `<dialog id="map-dialog">`), `styles.css` (dialog styles)
- Test: manual (Leaflet and pointer handling aren't unit-testable here without a DOM). Pure parts are already covered by `geo.test.js`.

**Interfaces:**
- Consumes: `cornersFor`, `parseCoordinates` (Task 3), and `SEARCH_NO_MATCH`, `SEARCH_UNAVAILABLE` (Task 8).
- Produces: `placeFloor({ floor: { name, widthM, lengthM }, start: { center, rotation } | null, near: { lat, lng } | null }) -> Promise<{ center: {lat, lng}, rotation } | null>`. It resolves `null` on Close or Esc, and always returns focus to `document.activeElement` as it was at the call.

- [ ] **Step 1: Vendor Leaflet.**
  1. In the scratchpad, run `npm pack leaflet@1.9.4`. npm verifies the registry integrity hash.
  2. Extract it, and copy `package/dist/leaflet-src.esm.js`, `package/dist/leaflet.css`, `package/dist/images/*` and `package/LICENSE` into `vendor/leaflet/` unchanged.
  3. Record the tarball's `integrity` line (from `npm view leaflet@1.9.4 dist.integrity`) in `vendor/leaflet/SOURCE.md`, with the date.
- [ ] **Step 2:** Add `<dialog id="map-dialog" class="map-dialog" aria-labelledby="map-title">` to `index.html` with:
  - a heading `#map-title`
  - a Close pill
  - a search `<input type="search">` with a visible label `Search an address or paste coordinates`
  - a `#map` div
  - a rotation `<input type="range" min="-180" max="180" step="0.5">` with a degrees readout in Geist Mono
  - a `Done` primary pill
  - a hint line: `Drag the outline to move it and the round handle to rotate it. With the outline focused: arrows move it (Shift for 5 m), [ and ] rotate it.`

  Styles follow mockup option B: near full-screen (`width: min(1100px, 100vw - 32px); height: min(800px, 100dvh - 32px)`), the card surface, and a `::backdrop` of `rgba(0,0,0,.6)`. At ≤480 px it fills the viewport.
- [ ] **Step 3: Implement `map-place.js`:**
  - **Leaflet setup.** `import * as L from './vendor/leaflet/leaflet-src.esm.js'`. Inject `vendor/leaflet/leaflet.css` once. Set `L.Icon.Default.imagePath = 'vendor/leaflet/images/'`.
  - **Tiles.** The tile layer uses the Global Constraints URL and attribution, with `maxZoom: 19`.
  - **Opening view.** At `start.center` (zoom 19), or else at `near` (zoom 18), or else the world (zoom 2).
  - **The outline.** An `L.polygon` from `cornersFor`, plus two draggable `L.marker`s with `divIcon`s:
    - **Centre marker.** Dragging it moves the centre. With the marker focused, `keydown` handles arrows: 0.5 m, or 5 m with Shift, converted with the same 111 320 m/° rule. `[` rotates by −1° and `]` by +1°. `preventDefault` on those keys.
    - **Rotate handle.** It sits beyond the top edge's midpoint. Dragging it sets rotation to the bearing from centre to handle.
    - Every change redraws the polygon and handle and syncs the slider and readout. Slider input sets rotation.
  - **Initial placement.** When `start` is null, the outline is placed at the map centre on first open, and re-centred after each successful search.
  - **Search.** On Enter only:
    - `parseCoordinates` first, to fly there.
    - Otherwise, if at least 1000 ms have passed since the last search, `fetch` Nominatim (Global Constraints URL with `encodeURIComponent(q)`) and fly to the first result at zoom 18.
    - An empty array shows `SEARCH_NO_MATCH`, and a failed fetch or non-OK response shows `SEARCH_UNAVAILABLE`, both inline under the box with `role="status"`.
  - **Done and Close.** Done resolves `{ center, rotation }`. Close and the dialog's `cancel` event (Esc) resolve `null`.
  - **Lifecycle.** Open with `showModal()`, call `map.invalidateSize()` after opening, and remove the map on close.
- [ ] **Step 4: Manual check.** Use a scratch page in the scratchpad, served through `node tools/fake-meraki.mjs` (Task 7) with a temporary allow-list entry you remove afterwards, or simpler: a temporary `<button>` in `index.html` that calls `placeFloor` with a 40 × 20 m floor, removed before committing. Check in the Claude browser preview:
  - The tiles load and the attribution is visible bottom-right.
  - Coordinates `53.3498, -6.2603` jump there without a Nominatim request (check `read_network_requests`).
  - An address search makes exactly one Nominatim request per Enter.
  - Drag move, drag rotate and the slider all work.
  - Keyboard-only: Tab to the outline, arrows, Shift+arrows, `[`/`]`, Esc returns focus.
  - At 375 px wide the dialog fills the screen and nothing scrolls sideways.
  - The browser console shows no errors.
- [ ] **Step 5:** Run `npm test && npm run check`. Expected: all pass. `node --check` may skip ESM vendor syntax issues; if `npm run check` fails on `vendor/`, add `-path ./vendor` to the prune list in `package.json` (a one-line change) rather than editing Leaflet.
- [ ] **Step 6:** Commit in two parts:
  - `structure: vendor Leaflet 1.9.4` (only `vendor/`)
  - `behavior: add the map dialog for placing a floor`

  Then simplify (`map-place.js` and styles only, never `vendor/`), re-test, and commit if changed.

---

### Task 10: The Send to Meraki flow in the card

**Files:**
- Create: `meraki-flow.js`
- Modify: `app.js`, `index.html`, `styles.css`
- Test: manual against the fake server. The logic it relies on is covered by Tasks 2–8.

**Interfaces:**
- Consumes: `listFloors`, `cornersFor`, `REGIONS`, `floorRows`, `uploadButton`, `ACTION_LABELS`, `finishedCard`, the constants, and `placeFloor`.
- Produces: `startMerakiFlow({ container, openintent, onExit }) -> void`. `container` is the `#meraki-panel` element; `onExit()` is called on Disconnect or Back from Connect and returns to the Done card.

- [ ] **Step 1: `index.html`:**
  - Add a `Send to Meraki` pill with `id="meraki"` and `hidden` to `.actions`, between Download and Convert another.
  - Add `<div id="meraki-panel" class="meraki" hidden></div>` inside `.card-inner`.
  - Load `Geist Mono` (400;500) in the existing Google Fonts link.
- [ ] **Step 2: `app.js`:**
  - On load, `fetch('api/health')`. Only if it's OK with `{ ok: true }`, set `merakiAvailable = true`; swallow failures. The path is relative so GitHub Pages' subpath 404s.
  - `ACTIONS.done` becomes `['download', 'meraki', 'another']`, and the meraki pill is shown only when `merakiAvailable` and the result has `openintent`.
  - Clicking it:
    1. `await import('./meraki-flow.js')`
    2. sets `card.dataset.state = 'meraki'` and hides the glyph, title, detail and actions
    3. shows the panel and calls `startMerakiFlow`
  - `onExit` restores `show(currentEvent)` and hides the panel.
  - Keep the last result's `openintent` in a variable, cleared on Convert another.
- [ ] **Step 3: Implement `meraki-flow.js`.** It renders into `container` with DOM APIs (`textContent`, never `innerHTML` with data). The steps follow the spec's "The flow" and the approved mockup:
  - **Stepper.** An `<ol class="stepper">` with `aria-current="step"` on the current step.
  - **Connect:**
    - `<select>` of `REGIONS` labels, plus `<input type="password" autocomplete="off">` with label `API key`.
    - Connect posts `api/organizations`.
    - Errors show inline under the key with `role="alert"`, and the key stays in the field.
    - On success the key moves to a module variable and the input is cleared.
    - An empty org list shows `NO_ORGANISATIONS`.
    - A `fetch` rejection (server gone) shows `SERVER_STOPPED`.
  - **Network:** organisation and network `<select>`s. Choosing an organisation posts `api/networks`, and an empty list shows `NO_WIRELESS`. Next posts `api/floor-plans`.
  - **Floors:**
    - Rows come from `floorRows(listFloors(openintent.design, openintent.images), plans, placements, unticked)`.
    - Each row is a real `<input type="checkbox">` with a `<label>`, the name in Geist Mono, `ACTION_LABELS`, the reason, a `Placed`/`Not placed yet` tag, and a `Place on map`/`Edit` pill.
    - That pill calls `placeFloor({ floor, start: placements.get(name) ?? null, near: lastPlacedCenter })` and stores a non-null result.
    - The upload pill uses `uploadButton(rows)`, and its hint is linked with `aria-describedby`.
  - **Uploading:**
    - Floors upload sequentially. For each ticked row:
      1. `imageContents = image.bytes.toBase64()`
      2. `{ topLeft, topRight } = cornersFor(...)`
      3. post `api/floor-plans/upload`
    - Row status: `Waiting`, `Uploading…`, `Created`, `Updated`, or `Failed: <error>`.
    - The status is announced via the page's `#status` live region, and a failure continues to the next floor.
  - **Finished:**
    - `finishedCard`, plus an `Open in Dashboard` primary link to the network `url` (`target="_blank" rel="noopener"`) and `Convert another`.
    - `Back to floors` appears when any floor failed and keeps the placements.
  - **Back and Disconnect.** Back is on each step. Disconnect sets the key variable to `null` and calls `onExit`.
  - **Focus.** It moves to each step's heading (`tabindex="-1"`) on step change.
  - **Request helper.** All posts go through one `api(path, body)` helper that adds `region` and `apiKey`, sends JSON, and returns `json` or throws `{ message: json.error ?? GENERIC }`.
- [ ] **Step 4: `styles.css`.** Add the stepper, form fields, floor list, tags and inline error from the approved mockup (`.superpowers/brainstorm/*/content/meraki-flow.html`). Orange stays only on `.pill-primary`. Add `--mono: "Geist Mono", ui-monospace, monospace`.
- [ ] **Step 5: Manual check.** Run `node tools/fake-meraki.mjs`, open it in the Claude browser preview, and convert `tests/fixtures/fixture.esx`. Then walk the whole flow:
  - a bad key shows the inline error, the key is kept, and the region is named
  - with `test-key`: the organisation, then a network list with no switch-only networks
  - the floor rows: `Ground` shows Update existing, and a duplicate `Level 2` would be blocked
  - placing on the map unlocks Upload
  - the per-floor progress, then the finished counts and the Dashboard link

  Then check:
  - Keyboard-only through every step.
  - 375 px width.
  - Contrast ≥ 4.5:1 on new text (use `javascript_tool` to read computed colours and compute ratios).
  - `localStorage`, `sessionStorage` and `document.cookie` are empty after Connect, and the key appears nowhere in `document.body.innerHTML`.
  - The `api/*` requests' URLs don't contain the key (`read_network_requests`).

  Also serve the folder with `python3 -m http.server 8001` and confirm the Done card shows no Send to Meraki and that no `meraki-flow.js` or `vendor/` request is made.
- [ ] **Step 6:** Run `npm test && npm run check`. Expected: all pass.
- [ ] **Step 7:** Commit: `behavior: add the Send to Meraki flow to the card`. Then simplify, re-test, and commit if changed.

---

### Task 11: Documentation

**Files:**
- Modify: `README.md`, `docs/HANDOFF.md`

- [ ] **Step 1: `README.md`.** Add a "Send floor plans to Meraki (local only)" section:
  - `npm start`, then open `http://localhost:8000`, Node 22+.
  - What the flow does, and that APs aren't placed.
  - The no-storage guarantee, verbatim from the spec's Done means.
  - The outside services: OpenStreetMap tiles and Nominatim see your IP and the area or text you search, never your key or files.
  - The 100 MB cap.
  - Leaflet 1.9.4 (BSD-2-Clause) in `vendor/leaflet/`.
- [ ] **Step 2: `docs/HANDOFF.md`.** Update the file table (server, client, routes, pure modules, flow, map), the commands (`npm start`, `node tools/fake-meraki.mjs`), the test count, and the hard-won facts:
  - Meraki: two adjacent corners rotate the plan; a new image without position re-centres it with no rotation; no documented size limit.
  - The OSM and Nominatim policy points.
  - Esri's keyless terms are unclear.
- [ ] **Step 3:** Run `npm test && npm run check`. Expected: all pass.
- [ ] **Step 4:** Commit: `structure: document the local Meraki upload`.

---

## Finishing (per CLAUDE.md)

1. Run the code-simplifier over every file changed on the branch. Run `npm test && npm run check` and commit `structure: simplify`.
2. `superpowers:verification-before-completion`: report real output from `npm test`, `npm run check` and `npm run test:sample` (parity unchanged), plus the manual check results.
3. `superpowers:requesting-code-review` on the whole branch, then `superpowers:receiving-code-review`.
4. `superpowers:finishing-a-development-branch`. Don't push without asking.
