// Works out the Floors step's rows, the upload button and the flow's fixed copy, kept pure so it can be tested.
import { matchFloorPlan, duplicatePlansMessage } from './floor-plan-match.js';

// Meraki only accepts these characters in a floor plan name, up to 25 of them.
const DISALLOWED_RUN = /[^\p{L}\p{N} _-]+/gu;
const MAX_NAME_LENGTH = 25;

export function suggestMerakiName(floorName) {
  const cleaned = floorName.replace(DISALLOWED_RUN, ' ').replace(/ +/g, ' ').trim();
  // Array.from splits by code point, so a letter outside the BMP is never cut in half.
  const suggestion = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim();
  return suggestion || 'Floor';
}

function rowFor(floor, isRepeat, existingPlans, placements, unticked) {
  const base = { name: floor.name, placed: placements.has(floor.name) };
  const blocked = (reason) => ({ ...base, action: 'blocked', reason, ticked: false });
  if (floor.problem) return blocked(floor.problem);
  // Two floors with one name would both target the same Meraki plan.
  if (isRepeat) return blocked(`Two floors in this design are named “${floor.name}”.`);
  const match = matchFloorPlan(floor.name, existingPlans);
  if (match.action === 'blocked') return blocked(duplicatePlansMessage(floor.name, match.count));
  return { ...base, action: match.action, reason: null, ticked: !unticked.has(floor.name) };
}

export function floorRows(floors, existingPlans, placements, unticked) {
  return floors.map((floor, i) =>
    rowFor(floor, floors.findIndex((f) => f.name === floor.name) < i, existingPlans, placements, unticked));
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
  if (!ticked.every((row) => row.placed)) return 'Place every ticked floor on the map first.';
  return null;
}

export function uploadButton(rows) {
  const ticked = rows.filter((row) => row.ticked);
  const hint = hintFor(ticked);
  return { enabled: hint === null, label: `Upload ${ticked.length} ${ticked.length === 1 ? 'floor' : 'floors'}`, hint };
}
