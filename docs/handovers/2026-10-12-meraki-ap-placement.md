# Handover: place access points on Meraki floor plans

Written 2026-10-12 for a new Claude Code session. Read this whole file first, then `docs/HANDOFF.md`, then the spec.

## Your task

Build the feature in **`docs/superpowers/specs/2026-10-12-meraki-ap-placement-design.md`** (approved by the user). After the Send to Meraki flow uploads floor plans, it automatically places the design's access points on them in Meraki:
- **matching:** by name (trimmed, case ignored), then by BSSID from Ekahau survey data;
- **position check:** an AP on a different floor plan is never moved, and one already within 0.5 m is not re-sent;
- **results:** a list of outcomes on the Finished screen.

**Next step:** use `superpowers:writing-plans` to turn the spec into a plan, show the user and wait for approval. Then execute it test-first. The user's build method is in `/Users/joseph.leonard/Desktop/Claude/CLAUDE.md`, which is mandatory; follow it exactly.

## Where things are

| What | Where |
|---|---|
| Main checkout | `/Users/joseph.leonard/Desktop/Claude/converter` (on branch `docs-handoff`) |
| Work happens in | the worktree `/Users/joseph.leonard/Desktop/Claude/converter/.claude/worktrees/meraki-upload`, branch **`meraki-upload`** |
| Branch state | 69 commits ahead of `main` (`bb2d301`). HEAD is `0dc1dba`. **Nothing pushed or merged.** It includes the unmerged `docs-handoff` commit. |
| Remote | `github.com/Eyserit/esx-open-intent-converter` (public). GitHub Pages serves `main`. Pushing to `main` deploys the live site, so **ask before any push or merge.** |
| This feature's spec | `docs/superpowers/specs/2026-10-12-meraki-ap-placement-design.md` |
| The Meraki upload it builds on | spec `docs/superpowers/specs/2026-10-11-meraki-upload-design.md`, plan `docs/superpowers/plans/2026-10-11-meraki-upload.md` |
| Project overview | `docs/HANDOFF.md` (files, commands, hard-won facts, known gaps) |

To enter the worktree: if your session starts in the main checkout, use the `EnterWorktree` tool with `path` set to the worktree above. Don't create another one.

## Private files: never commit them, never copy their contents into the repo

The repo is public. `.gitignore` blocks `*.esx` (except `tests/fixtures/`). Both private files live in the **main checkout root**, not the worktree:
- `ekahau_sample.esx`: a predictive design with no survey data. Used by `npm run test:sample` (with `.venv` for Pillow).
- **A survey `.esx`** the user added for this feature. Its filename contains a customer name, so never write that filename into any committed file. List the main checkout's root to find it.
  - The spec's local check reads it as `survey_sample.esx` in the repo root, or from the `SURVEY_SAMPLE` env var.
  - To use it from the worktree, symlink both private files in temporarily and remove the links afterwards:

  ```bash
  ln -s "/Users/joseph.leonard/Desktop/Claude/converter/<survey file>.esx" survey_sample.esx
  ```

- When inspecting private files, print **structure and counts only**, never names, BSSIDs or coordinates. Test fixtures must be **synthetic**, with made-up names, ids and BSSIDs that follow the real structure.

What the survey file contains (field names only) is in the spec under "Facts checked". In short:
- `accessPoints.json` has `mine`, `name` and `location`;
- `measuredRadios.json` links each AP to its measurements through `accessPointId`;
- `accessPointMeasurements.json` holds the `mac` field, which is the BSSID.

Predictive designs have no survey files at all.

## Current state (all verified at HEAD `0dc1dba`)

- **Tests:** `npm test` passes 230 of 230, and `npm run check` is clean.
- **Private sample:** `npm run test:sample` passes 3 of 3 (needs the symlinks above).
- **Working in the real Meraki Dashboard (user-confirmed):**
  - floor plans upload, both create and update by exact name;
  - map placement (per floor, or "one building" with a shared centre);
  - floor names chosen per floor (Meraki allows at most 25 characters: letters, numbers, spaces, `-`, `_`);
  - `.esx` files with no walls convert.
- **Firefox:** the API key field's masking relies on `-webkit-text-security`, which has been checked in Chromium only.

### Running it
- **Real Meraki:** `PORT=8001 npm start` from the worktree, then open `http://localhost:8001`. Port 8000 is taken by the user's own preview server (Python), so use another port. The user may already have it running in their terminal (tab 0); the server serves files fresh, so a page reload picks up changes.
- **Fake Meraki:** `PORT=8123 node tools/fake-meraki.mjs`, test key `test-key`. It has organisations, networks, existing plans "Ground" (one) and "Level 2" (two), and a floor named "Rate" that gets a 429. This feature extends it with fake APs.
- **Converting in the browser preview:** inject `tests/fixtures/fixture.esx` into `#file` with a `DataTransfer`. **Wait for `card.dataset.state === 'done'` and a visible `#meraki` pill before clicking it.** A programmatic `.click()` on the hidden pill mid-conversion starts the flow with no package (a test artefact, not a real bug).
- `read_network_requests` in the browser pane doesn't list cross-origin requests (OSM, Nominatim); use `performance.getEntriesByType('resource')`.

## Architecture you'll extend (read these files)

- **`server/meraki-request.js`:** the request core.
  - region → host;
  - https + same-domain checks on redirects, paging and absolute URLs;
  - 429 retries capped at 60 s, up to 3;
  - 120 s timeout for GET and 600 s for writes;
  - key redaction.
  - `isWithinDomain` and `GENERIC_MESSAGE` are exported.
- **`server/meraki-client.js`:** `listOrganizations`, `listWirelessNetworks`, `listFloorPlans` and `uploadFloorPlan`. Paging is capped at 100 pages. Add `listAccessPoints` and `placeAccessPoint` here.
- **`server/meraki-routes.js`:** `createRoutes(client)`, with per-route field allow-lists (`pick`) and validation. Add `/api/access-points` and `/api/access-points/place`.
- **`server/server.js`:**
  - static allow-list: `/`, `index.html`, `styles.css`, `app.js`, `meraki-flow.js`, `map-place.js`, `src/**`, `vendor/**`;
  - Host and Origin checks;
  - 140 MB body cap;
  - no logging.
- **`src/meraki-messages.js`:** pure, tested.
  - Functions: `floorRows`, `uploadButton`, `finishedCard`, `effectivePlacements`, `buildingReferenceIndex`, `suggestMerakiName`, `merakiNameProblem`.
  - Copy constants live here too.
  - Placements, names and unticked state are **keyed by floor index**.
- **`src/geo.js`:** `cornersFor`, `offsetBy`, `bearingTo`, `wrapRotation`, `parseCoordinates` and `metresPerDegreeLng`. Add `apLatLng` here, using the same maths.
- **`meraki-flow.js`:** the stepper UI.
  - It builds DOM once and updates it in place (focus must survive typing), and writes text with `textContent` only.
  - The key lives in one module variable.
  - `uploadStep` / `uploadFloor` is where the AP phase hooks in.
- **`src/convert.js`:** results carry `openintent: { design, images }`. Add `designAps` as the spec says.
- **Converters are frozen:** don't change `src/esx-to-oi.js`, `src/oi-to-esx.js`, `zip.js`, `detect.js` or `fit-image.js` without a strong reason. The `.esx` → Open Intent port must stay at exact parity with `esx2oi.py`, apart from its two documented deliberate differences (per-floor images, optional wall files).

## Process that worked, and traps to avoid

- **CLAUDE.md's method:**
  - a large task gets brainstorm → spec → plan (approved) → worktree → subagent-driven development;
  - one failing test at a time;
  - `structure:` / `behavior:` commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - the `code-simplifier:code-simplifier` agent runs after each task, and its changes are committed separately as `structure: simplify`;
  - verification-before-completion, then requesting-code-review, then finishing-a-development-branch.
- **Subagents with browser tools stalled.** One implementer sat idle for about 12 hours at a browser-check step. Give implementers **no browser work**: they do headless checks and list browser checks for you, and you (the controller) run them in the browser pane. Run implementers in the foreground (`run_in_background: false`).
- **Subagents can't always write report files.** Ask them to put the report in their reply, in a set number of lines.
- **The worktree guard refuses compound shell commands** that mention git, `cd` to the main checkout, or `awk` programs. The superpowers SDD helper scripts (`sdd-workspace`, `task-brief`, `review-package`) are refused too. Instead:
  - run plain, separate git commands;
  - write a Node or Python script to the scratchpad and run it with an absolute path;
  - build review diffs with `git diff -U8 BASE..HEAD > .superpowers/sdd/<name>/review.diff` (`.superpowers/` is git-ignored).
- **Simplifier replies:** a couple of them returned only "placeholder". When that happens, check `git log`, `git show --stat` and the test run yourself.
- **Reviewers earned their keep.** Use an opus reviewer for security-adjacent server code, and give the reviewer named risks. Past catches:
  - a key-leak path through an unparseable body;
  - an injectable ctx flag;
  - same-named floors sharing state;
  - a map Done that could upload an unchosen position.
- **The user:**
  - prefers short answers with a clear recommendation, then waits to choose;
  - uses UK/Irish English;
  - wants pushes and merges asked about first;
  - checks things against their real Dashboard and reports real Meraki errors (e.g. the 25-character name limit).

## Decisions already made for this feature (don't reopen)

- **Matching:** name first (trimmed, case ignored). Then BSSID (the design AP's measured BSSIDs against Meraki's `basicServiceSets[].bssid`). With no measured BSSIDs, name only.
- **Which design APs:** only `mine`, positioned on a floor uploaded successfully in this run. Open Intent input: every AP counts, name-only.
- **Ambiguity:**
  - a name matching 2+ Meraki APs falls through to BSSID;
  - several BSSID matches → unmatched;
  - one Meraki AP claimed by 2+ design APs → none placed.
- **Automatic placing:** no review step.
- **Position check:**
  - not on a plan → place;
  - same plan within 0.5 m → nothing sent;
  - same plan further away → move;
  - a different plan → skip and leave it.
- **Meraki calls:**
  - `GET /networks/{id}/devices` for name, serial, floorPlanId, lat and lng;
  - `GET /organizations/{orgId}/wireless/ssids/statuses/byDevice?networkIds[]=…&hideDisabled=false&perPage=500` for BSSIDs;
  - `PUT /devices/{serial}` with `{ lat, lng, floorPlanId }`.
- **Open for the plan:** how the device list marks an AP (`productType === 'wireless'` vs a model prefix such as `MR` or `CW`). Check Meraki's docs, and don't guess.

## Known gaps carried over (from the final review; fine to leave unless the spec touches them)

- `fake-meraki`'s 401 always says "(Global)".
- Meraki checkbox names read "Ground, Update existing" by design.
- Leaflet's empty map div keeps its classes after close (harmless).
- Firefox key masking is unverified.
- `npm run test:sample` runs everything in `local-checks/`, so a new `survey.test.js` there runs with it. The spec names `npm run test:survey`: add that script, and make sure each local check skips cleanly when its private file is missing.

## When you finish

Per CLAUDE.md:
1. simplify;
2. re-verify with real output (`npm test`, `npm run check`, `npm run test:sample`, plus the survey check);
3. a whole-branch review;
4. update README and `docs/HANDOFF.md`;
5. present the finishing options: merge locally, PR, or keep.

Don't push or merge without asking.
