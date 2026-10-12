// Works out the Floors step's rows, the upload button and the flow's fixed copy, kept pure so it can be tested.
import { matchFloorPlan, duplicatePlansMessage } from './floor-plan-match.js';

// Meraki only accepts these characters in a floor plan name, up to 25 of them.
const DISALLOWED_RUN = /[^\p{L}\p{N} _-]+/gu;
const ALLOWED_NAME = /^[\p{L}\p{N} _-]*$/u;
const MAX_NAME_LENGTH = 25;

export function suggestMerakiName(floorName) {
  const cleaned = floorName.replace(DISALLOWED_RUN, ' ').replace(/ +/g, ' ').trim();
  // Array.from splits by code point, so a letter outside the BMP is never cut in half.
  const suggestion = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  return suggestion || 'Floor';
}

export function merakiNameProblem(name) {
  if (name.trim() === '') return 'Enter a name.';
  const length = Array.from(name).length;
  if (length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer (this one has ${length}).`;
  if (!ALLOWED_NAME.test(name)) return 'Use only letters, numbers, spaces, - and _.';
  return null;
}

function rowFor(floor, index, merakiName, isRepeat, existingPlans, placements, unticked) {
  const base = {
    name: floor.name, merakiName, nameProblem: merakiNameProblem(merakiName), placed: placements.has(index),
  };
  const blocked = (reason) => ({ ...base, action: 'blocked', reason, ticked: false });
  if (floor.problem) return blocked(floor.problem);
  // Two floors with one name would both target the same Meraki plan. An invalid name already says what to fix.
  if (isRepeat && !base.nameProblem) return blocked(`Two floors in this design are named “${merakiName}”.`);
  const match = matchFloorPlan(merakiName, existingPlans);
  if (match.action === 'blocked') return blocked(duplicatePlansMessage(merakiName, match.count));
  return { ...base, action: match.action, reason: null, ticked: !unticked.has(index) };
}

// placements, unticked and names are keyed by floor index, so floors that share a name stay separate.
// A floor missing from names gets the suggested Meraki name.
export function floorRows(floors, existingPlans, placements, unticked, names = new Map()) {
  // Trimmed so stray spaces don't stop a match or reach Meraki; the input keeps what was typed.
  const chosen = floors.map((floor, i) => (names.get(i) ?? suggestMerakiName(floor.name)).trim());
  return floors.map((floor, i) =>
    rowFor(floor, i, chosen[i], chosen.indexOf(chosen[i]) < i, existingPlans, placements, unticked));
}

// With the floors placed together as one building, every floor shares the building's placement.
export function effectivePlacements(placements, building) {
  if (!building.together) return placements;
  if (!building.placement) return new Map();
  return new Map(Array.from({ length: building.count }, (_, i) => [i, building.placement]));
}

export const ACTION_LABELS = { create: 'Create', update: 'Update existing', blocked: "Can't upload" };

export const NO_ORGANISATIONS = "This API key doesn't have access to any organisations.";
export const NO_WIRELESS = 'No wireless networks in this organisation.';
export const SEARCH_NO_MATCH = 'No match for that address.';
export const SEARCH_UNAVAILABLE = "Address search isn't available right now. You can paste coordinates instead.";
export const SERVER_STOPPED = "The local server isn't running — restart it with npm start.";
// Duplicates the server's message: the page and the server are separate layers.
export const GENERIC = 'Something went wrong talking to Meraki.';

export function finishedCard({ networkName, results }) {
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  const [created, updated, failed] = [count('created'), count('updated'), count('failed')];
  const sent = created + updated;
  return {
    title: `${sent} ${sent === 1 ? 'floor' : 'floors'} sent to ${networkName}`,
    detail: `${created} created, ${updated} updated.${failed > 0 ? ` ${failed} failed.` : ''}`,
  };
}

function hintFor(ticked) {
  if (ticked.length === 0) return 'Tick at least one floor.';
  if (ticked.some((row) => row.nameProblem)) return 'Fix the floor names first.';
  if (!ticked.every((row) => row.placed)) return 'Place every ticked floor on the map first.';
  return null;
}

export function uploadButton(rows) {
  const ticked = rows.filter((row) => row.ticked);
  const hint = hintFor(ticked);
  return { enabled: hint === null, label: `Upload ${ticked.length} ${ticked.length === 1 ? 'floor' : 'floors'}`, hint };
}
