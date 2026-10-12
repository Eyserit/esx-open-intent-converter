import { GENERIC_MESSAGE, MerakiError } from './meraki-request.js';

const CORNERS = ['topLeftCorner', 'topRightCorner'];
const NUMBERS = ['lat', 'lng'];

const CREDENTIALS = ['region', 'apiKey'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// The client spreads leftover fields into its request context, so callers must not smuggle extras in.
function pick(body, fields) {
  return Object.fromEntries(fields.map((field) => [field, body[field]]));
}

function isCorner(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
}

function isValidField(field, value) {
  if (CORNERS.includes(field)) return isCorner(value);
  if (NUMBERS.includes(field)) return Number.isFinite(value);
  return isNonEmptyString(value);
}

function firstInvalidField(body, fields) {
  return fields.find((field) => !isValidField(field, body?.[field]));
}

export function createRoutes(client) {
  function route(fields, call) {
    return async (body) => {
      const allowed = [...CREDENTIALS, ...fields];
      const invalid = firstInvalidField(body, allowed);
      if (invalid) return { status: 400, json: { error: `Missing or invalid ${invalid}.` } };
      try {
        return { status: 200, json: await call(pick(body, allowed)) };
      } catch (error) {
        if (error instanceof MerakiError) return { status: error.status, json: { error: error.message } };
        // Unknown errors may carry the API key, so their text never reaches the browser.
        return { status: 500, json: { error: GENERIC_MESSAGE } };
      }
    };
  }

  return new Map([
    ['/api/organizations', route([], (body) => client.listOrganizations(body))],
    ['/api/networks', route(['organizationId'], (body) => client.listWirelessNetworks(body))],
    ['/api/floor-plans', route(['networkId'], (body) => client.listFloorPlans(body))],
    [
      '/api/floor-plans/upload',
      route(['networkId', 'name', 'imageContents', ...CORNERS], (body) => client.uploadFloorPlan(body)),
    ],
    ['/api/access-points', route(['organizationId', 'networkId'], (body) => client.listAccessPoints(body))],
    [
      '/api/access-points/place',
      route(['serial', 'lat', 'lng', 'floorPlanId'], (body) => client.placeAccessPoint(body)),
    ],
  ]);
}
