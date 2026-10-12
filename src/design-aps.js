// Reads the design's access points straight from the .esx entries, in metres from each floor's top-left.
const decoder = new TextDecoder();

function readList(entries, name) {
  const bytes = entries.get(`${name}.json`);
  if (!bytes) return [];
  return JSON.parse(decoder.decode(bytes))[name] ?? [];
}

// The plan image is the floor's extent; an AP outside it would be sent off the plan.
const clamp = (value, max) => Math.min(Math.max(value, 0), max);

function bssidsByAp(entries) {
  const macs = new Map(readList(entries, 'accessPointMeasurements').map((m) => [m.id, m.mac]));
  const byAp = new Map();
  for (const radio of readList(entries, 'measuredRadios')) {
    const found = byAp.get(radio.accessPointId) ?? new Set();
    for (const id of radio.accessPointMeasurementIds ?? []) {
      if (macs.get(id)) found.add(macs.get(id).toLowerCase());
    }
    byAp.set(radio.accessPointId, found);
  }
  return byAp;
}

export function designApsFromEsx(entries) {
  const bssids = bssidsByAp(entries);
  const floors = new Map(readList(entries, 'floorPlans').map((f) => [f.id, f]));
  const aps = [];
  readList(entries, 'accessPoints').forEach((ap, i) => {
    const f = floors.get(ap.location?.floorPlanId);
    const coord = ap.location?.coord;
    if (!f || !(f.metersPerUnit > 0)) return;
    if (typeof coord?.x !== 'number' || typeof coord?.y !== 'number') return;
    const x = clamp(coord.x, f.width || f.cropMaxX);
    const y = clamp(coord.y, f.height || f.cropMaxY);
    aps.push({
      name: ap.name || `AP-${i}`,
      floorName: f.name || 'Floor',
      xM: x * f.metersPerUnit,
      yM: y * f.metersPerUnit,
      mine: ap.mine !== false,
      bssids: [...(bssids.get(ap.id) ?? [])],
    });
  });
  return aps;
}
