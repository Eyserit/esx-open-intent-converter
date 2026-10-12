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

const dimensionIn = (floor, unit) => floor.dimensions?.find((d) => d.unit === unit);
const coordinateIn = (ap, unit) => ap.coordinates?.map((c) => c.coordinate_xyz).find((c) => c?.unit === unit);

function positionOnFloor(ap, floor) {
  const metres = floor && dimensionIn(floor, 'meters');
  if (!metres) return null;
  const inMetres = coordinateIn(ap, 'meters');
  if (inMetres) return { xM: inMetres.x, yM: metres.length - inMetres.y };
  const pixels = dimensionIn(floor, 'pixels');
  const inPixels = coordinateIn(ap, 'pixels');
  if (!pixels || !inPixels) return null;
  const scale = metres.width / pixels.width;
  return { xM: inPixels.x * scale, yM: metres.length - inPixels.y * scale };
}

export function designApsFromOpenIntent(design) {
  const floors = new Map((design.floorplans ?? []).map((f) => [f.name, f]));
  return (design.accesspoints ?? []).flatMap((ap) => {
    const position = positionOnFloor(ap, floors.get(ap.floorplan_name));
    if (!position) return [];
    return [{ name: typeof ap.name === 'string' ? ap.name : '', floorName: ap.floorplan_name, ...position, mine: true, bssids: [] }];
  });
}
