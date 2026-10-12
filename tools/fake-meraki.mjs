// Manual-check tool: serves the page on port 8000 with a fake Meraki behind the real routes.
// Use the API key "test-key". A floor named "Rate" gets a rate-limit error on its first upload.
// Fake access points (serial: name): Q2XX-0001 "ap-a ", Q2XX-0002 and Q2XX-0003 both "AP-B",
// Q2XX-0004 "AP-C" already placed on Level 2 (fp-l2-a) in Dublin, Q2XX-0005 "Hall MR" with BSSID
// 02:00:00:00:0b:02, Q2XX-0006 "Broken" (placing it fails). Placing stores lat, lng and floor plan.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MerakiError } from '../server/meraki-client.js';
import { createRoutes } from '../server/meraki-routes.js';
import { createAppServer } from '../server/server.js';
import { duplicatePlansMessage } from '../src/floor-plan-match.js';

const PORT = Number(process.env.PORT ?? 8000);
const GOOD_KEY = 'test-key';
const UPLOAD_DELAY_MS = 400;

const ORGANIZATIONS = [
  { id: 'org-1', name: 'Acme Campus' },
  { id: 'org-2', name: 'Beta Branches' },
];
const NETWORKS = [
  { id: 'N_1', name: 'HQ wireless', url: 'https://n1.meraki.com/HQ-wireless/n/1/manage', productTypes: ['wireless', 'switch'] },
  { id: 'N_2', name: 'Warehouse', url: 'https://n1.meraki.com/Warehouse/n/2/manage', productTypes: ['wireless'] },
  { id: 'N_3', name: 'Switch only', url: 'https://n1.meraki.com/Switch/n/3/manage', productTypes: ['switch'] },
  { id: 'N_4', name: 'Cameras', url: 'https://n1.meraki.com/Cameras/n/4/manage', productTypes: ['camera'] },
];
const PLANS = [
  { id: 'fp-ground', name: 'Ground' },
  { id: 'fp-l2-a', name: 'Level 2' },
  { id: 'fp-l2-b', name: 'Level 2' },
];

const ACCESS_POINTS = [
  { serial: 'Q2XX-0001', name: 'ap-a ', floorPlanId: null, lat: null, lng: null, bssids: [] },
  { serial: 'Q2XX-0002', name: 'AP-B', floorPlanId: null, lat: null, lng: null, bssids: [] },
  { serial: 'Q2XX-0003', name: 'AP-B', floorPlanId: null, lat: null, lng: null, bssids: [] },
  { serial: 'Q2XX-0004', name: 'AP-C', floorPlanId: 'fp-l2-a', lat: 53.3498, lng: -6.2603, bssids: [] },
  { serial: 'Q2XX-0005', name: 'Hall MR', floorPlanId: null, lat: null, lng: null, bssids: ['02:00:00:00:0b:02'] },
  { serial: 'Q2XX-0006', name: 'Broken', floorPlanId: null, lat: null, lng: null, bssids: [] },
];
// Plans made by uploadFloorPlan, so listings include them with their names.
const created = [];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function checkKey(apiKey) {
  if (apiKey !== GOOD_KEY) throw new MerakiError(401, "That API key wasn't accepted by Meraki (Global).");
}

let rateLimited = false;
let nextId = 1;

const fakeClient = {
  async listOrganizations({ apiKey }) {
    checkKey(apiKey);
    return ORGANIZATIONS;
  },
  async listWirelessNetworks({ apiKey }) {
    checkKey(apiKey);
    return NETWORKS.filter((network) => network.productTypes.includes('wireless')).map(({ id, name, url }) => ({ id, name, url }));
  },
  async listFloorPlans({ apiKey }) {
    checkKey(apiKey);
    return [...PLANS, ...created];
  },
  async listAccessPoints({ apiKey }) {
    checkKey(apiKey);
    return { accessPoints: ACCESS_POINTS, floorPlans: [...PLANS, ...created] };
  },
  async placeAccessPoint({ apiKey, serial, lat, lng, floorPlanId }) {
    checkKey(apiKey);
    const found = ACCESS_POINTS.find((ap) => ap.serial === serial);
    if (!found) throw new MerakiError(404, 'Fake access point not found.');
    if (found.name === 'Broken') throw new MerakiError(400, 'Fake placement failure.');
    Object.assign(found, { lat, lng, floorPlanId });
    return {};
  },
  async uploadFloorPlan({ apiKey, name }) {
    checkKey(apiKey);
    await sleep(UPLOAD_DELAY_MS);
    if (name === 'Rate' && !rateLimited) {
      rateLimited = true;
      throw new MerakiError(429, 'Meraki is rate-limiting requests — try again in a minute.');
    }
    const matches = [...PLANS, ...created].filter((plan) => plan.name === name);
    if (matches.length > 1) throw new MerakiError(409, duplicatePlansMessage(name, matches.length));
    if (matches.length === 1) return { action: 'updated', floorPlanId: matches[0].id };
    const plan = { id: `fp-new-${nextId++}`, name };
    created.push(plan);
    return { action: 'created', floorPlanId: plan.id };
  },
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
createAppServer({ root, routes: createRoutes(fakeClient) }).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Fake Meraki running at http://localhost:${PORT} — API key: ${GOOD_KEY}. Press Ctrl+C to stop.\n`);
});
