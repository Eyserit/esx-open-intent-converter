import { duplicatePlansMessage, matchFloorPlan } from '../src/floor-plan-match.js';
import { REGIONS } from '../src/meraki-regions.js';
import { GENERIC_MESSAGE, MerakiError, createRequest, isWithinDomain } from './meraki-request.js';

export { MerakiError } from './meraki-request.js';

const NEXT_LINK = /<([^>]*)>\s*;\s*rel="?next"?/;
// A broken or hostile server could link pages forever.
const MAX_PAGES = 100;

function nextPageUrl(linkHeader, domain) {
  const match = NEXT_LINK.exec(linkHeader ?? '');
  if (!match) return null;
  let next;
  try {
    next = new URL(match[1]);
  } catch {
    throw new MerakiError(502, GENERIC_MESSAGE);
  }
  // Following a page link elsewhere would hand the API key to that host.
  if (!isWithinDomain(next, domain)) throw new MerakiError(502, GENERIC_MESSAGE);
  return next.href;
}

export function createMerakiClient({ fetch, sleep }) {
  const request = createRequest({ fetch, sleep });

  async function getAllPages(ctx, path, itemsOf = (json) => json) {
    const items = [];
    let target = path;
    for (let page = 0; target; page++) {
      if (page === MAX_PAGES) throw new MerakiError(502, GENERIC_MESSAGE);
      const { json, headers } = await request(ctx, 'GET', target);
      items.push(...itemsOf(json));
      target = nextPageUrl(headers.get('Link'), REGIONS[ctx.region].domain);
    }
    return items;
  }

  async function listOrganizations(ctx) {
    const orgs = await getAllPages({ ...ctx, forbiddenMeansBadKey: true }, '/organizations');
    return orgs.map(({ id, name }) => ({ id, name }));
  }

  async function listWirelessNetworks({ organizationId, ...ctx }) {
    const networks = await getAllPages(ctx, `/organizations/${encodeURIComponent(organizationId)}/networks`);
    return networks
      .filter((network) => network.productTypes.includes('wireless'))
      .map(({ id, name, url }) => ({ id, name, url }));
  }

  async function listFloorPlans({ networkId, ...ctx }) {
    const { json } = await request(ctx, 'GET', `/networks/${encodeURIComponent(networkId)}/floorPlans`);
    return json.map(({ floorPlanId, name }) => ({ id: floorPlanId, name }));
  }

  async function uploadFloorPlan({ networkId, name, imageContents, topLeftCorner, topRightCorner, ...ctx }) {
    // Re-listed at upload time so a plan added since the last look is not duplicated.
    const plans = await listFloorPlans({ ...ctx, networkId });
    const match = matchFloorPlan(name, plans);
    if (match.action === 'blocked') throw new MerakiError(409, duplicatePlansMessage(name, match.count));
    const body = { name, imageContents, topLeftCorner, topRightCorner };
    const base = `/networks/${encodeURIComponent(networkId)}/floorPlans`;
    if (match.action === 'update') {
      const { json } = await request(ctx, 'PUT', `${base}/${encodeURIComponent(match.id)}`, body);
      return { action: 'updated', floorPlanId: json.floorPlanId };
    }
    const { json } = await request(ctx, 'POST', base, body);
    return { action: 'created', floorPlanId: json.floorPlanId };
  }

  return { listOrganizations, listWirelessNetworks, listFloorPlans, uploadFloorPlan };
}
