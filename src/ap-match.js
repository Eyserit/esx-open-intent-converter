import { distanceM } from './geo.js';

const IN_PLACE_M = 0.5;
const key = (name) => name.trim().toLowerCase();

function matchByName(design, merakiAps) {
  const wanted = key(design.name);
  if (wanted === '') return [];
  return merakiAps.filter((ap) => key(ap.name) === wanted);
}

function nameReason(design, count) {
  if (count === 0) return `No access point named “${design.name}” in this network.`;
  return `${count} access points are named “${design.name}”.`;
}

function matchByBssid(design, merakiAps) {
  const wanted = new Set(design.bssids.map((bssid) => bssid.toLowerCase()));
  return merakiAps.filter((ap) => ap.bssids.some((bssid) => wanted.has(bssid.toLowerCase())));
}

function bssidReason(count) {
  if (count === 0) return "No access point broadcasts this AP's BSSIDs.";
  return `${count} access points broadcast this AP's BSSIDs.`;
}

function matchOne(design, merakiAps) {
  const named = matchByName(design, merakiAps);
  if (named.length === 1) return { serial: named[0].serial, by: 'name' };
  if (design.bssids.length === 0) return { serial: null, reason: nameReason(design, named.length) };
  const broadcasting = matchByBssid(design, merakiAps);
  if (broadcasting.length === 1) return { serial: broadcasting[0].serial, by: 'bssid' };
  return { serial: null, reason: bssidReason(broadcasting.length) };
}

// A serial can sit on only one plan position, so every claimant of it is left unmatched.
function releaseSharedSerials(matches, designAps) {
  return matches.map((match, index) => {
    if (match.serial === null) return match;
    const otherIndex = matches.findIndex((m, i) => i !== index && m.serial === match.serial);
    if (otherIndex === -1) return match;
    return { serial: null, reason: `Matched the same Meraki access point as “${designAps[otherIndex].name}”.` };
  });
}

export function matchAccessPoints(designAps, merakiAps) {
  const matches = designAps.map((design) => matchOne(design, merakiAps));
  return releaseSharedSerials(matches, designAps);
}

export function placementAction(merakiAp, targetFloorPlanId, target, floorPlanNames) {
  const { floorPlanId } = merakiAp;
  if (floorPlanId == null) return { action: 'place' };
  if (floorPlanId !== targetFloorPlanId) {
    return { action: 'skip', reason: `already placed on “${floorPlanNames.get(floorPlanId) ?? floorPlanId}”, left as is.` };
  }
  if (!Number.isFinite(merakiAp.lat) || !Number.isFinite(merakiAp.lng)) return { action: 'move' };
  return distanceM(merakiAp, target) <= IN_PLACE_M ? { action: 'none' } : { action: 'move' };
}
