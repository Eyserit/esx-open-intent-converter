// Places design APs on the Meraki floor plans just uploaded; only the injected functions touch the network.
import { apLatLng } from './geo.js';
import { matchAccessPoints, placementAction } from './ap-match.js';
import { apListError } from './meraki-messages.js';

function eligibility(design, floors, uploaded, earlier) {
  if (!design.mine) return { skip: 'Not your access point.' };
  const named = floors.flatMap((floor, i) => (floor.name === design.floorName ? [i] : []));
  if (named.length > 1) return { skip: `Two floors in this design are named “${design.floorName}”.` };
  const [index = -1] = named;
  if (uploaded.has(index)) return { floorIndex: index };
  if (earlier.has(index)) return { leftOut: true };
  return { skip: 'Its floor wasn\'t uploaded.' };
}

function targetFor(design, floorIndex, floors, uploaded) {
  const { placement } = uploaded.get(floorIndex);
  const { widthM, lengthM } = floors[floorIndex];
  return apLatLng({ ...placement, widthM, lengthM }, design.xM, design.yM);
}

// Decides each eligible row's fate; rows that need a PUT get `send` and the rest get their final `result`.
function plan(row, match, merakiAps, floors, uploaded, floorPlanNames) {
  const { name, design, floorIndex } = row;
  if (match.serial === null) return { result: { name, outcome: 'unmatched', reason: match.reason } };
  const merakiAp = merakiAps.find((ap) => ap.serial === match.serial);
  const { floorPlanId } = uploaded.get(floorIndex);
  const target = targetFor(design, floorIndex, floors, uploaded);
  const action = placementAction(merakiAp, floorPlanId, target, floorPlanNames);
  if (action.action === 'none') return { result: { name, outcome: 'in-place' } };
  if (action.action === 'skip') return { result: { name, outcome: 'skipped', reason: action.reason } };
  const outcome = action.action === 'place' ? 'placed' : 'moved';
  return {
    send: { serial: match.serial, ...target, floorPlanId },
    done: { name, outcome, by: match.by, merakiName: merakiAp.name },
  };
}

export async function runApPhase({ designAps, floors, uploaded, earlier, listAccessPoints, placeAccessPoint, onProgress }) {
  const rows = designAps.flatMap((design) => {
    const verdict = eligibility(design, floors, uploaded, earlier);
    if (verdict.leftOut) return [];
    if (verdict.skip) return [{ name: design.name, outcome: 'skipped', reason: verdict.skip }];
    return [{ name: design.name, floorIndex: verdict.floorIndex, design }];
  });
  const eligible = rows.filter((row) => row.design);
  if (eligible.length === 0) return { results: rows, listError: null };
  let listing;
  try {
    listing = await listAccessPoints();
  } catch (error) {
    return { results: rows.filter((row) => !row.design), listError: apListError(error.message) };
  }
  const { accessPoints, floorPlans } = listing;
  const floorPlanNames = new Map(floorPlans.map((p) => [p.id, p.name]));
  const matches = matchAccessPoints(eligible.map((row) => row.design), accessPoints);
  const plans = eligible.map((row, i) => plan(row, matches[i], accessPoints, floors, uploaded, floorPlanNames));
  const sends = plans.filter((p) => p.send);
  onProgress(0, sends.length);
  for (const [i, p] of sends.entries()) {
    try {
      await placeAccessPoint(p.send);
      p.result = p.done;
    } catch (error) {
      p.result = { name: p.done.name, outcome: 'failed', reason: error.message };
    }
    onProgress(i + 1, sends.length);
  }
  eligible.forEach((row, i) => { row.result = plans[i].result; });
  return { results: rows.map((row) => row.result ?? row), listError: null };
}
