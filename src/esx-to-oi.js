import { ConversionError } from './errors.js';

// Python's f"{x:.1f}" rounds the exact binary value and breaks exact ties to even;
// toFixed agrees except on ties, which it breaks away from zero. A value is an exact
// tie at one decimal only when x*4 is an odd integer (x ends in .25 or .75).
export function round1(x) {
  const quarters = x * 4;
  if (!Number.isInteger(quarters) || quarters % 2 === 0) return Number(x.toFixed(1));
  const lower = Math.floor(x * 10);
  const even = lower % 2 === 0 ? lower : lower + 1;
  return even / 10;
}

export function sanitizeFilename(s) {
  const ascii = s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  const cleaned = ascii.replace(/[^\w.-]+/g, '_').replace(/^[._]+|[._]+$/g, '');
  return cleaned || 'Floor';
}

function attenuationFromProps(propsByBand) {
  for (const band of ['FIVE', 'TWO', 'SIX']) {
    if (propsByBand[band] && propsByBand[band].attenuationFactor != null) {
      return Number(propsByBand[band].attenuationFactor);
    }
  }
  return 0;
}

// Only the wall types segments actually use, matching esx2oi.py's default.
export function buildWallMaterials(wallTypes, wallSegments, prefix) {
  const usedIds = new Set(
    wallSegments.map((seg) => seg.wallTypeId).filter((id) => Object.hasOwn(wallTypes, id)),
  );
  const materials = [];
  const id2name = {};
  const seen = new Set();
  for (const wtId of usedIds) {
    const wt = wallTypes[wtId];
    const base = wt.name || wt.key || 'Wall';
    let name = `${prefix}${base}`;
    if (seen.has(name)) name = `${name} (${wtId})`;
    seen.add(name);
    const color = wt.color || '#888888';
    const thickness = Number(wt.thickness || 0.1);
    const propsByBand = Object.fromEntries((wt.propagationProperties ?? []).map((p) => [p.band, p]));
    const attPerM = attenuationFromProps(propsByBand);
    materials.push({
      name,
      itu_material_type: 'ITU_R_UNKNOWN',
      rf_properties: {
        attenuation_flat: round1(attPerM * thickness),
        attenuation_per_m: round1(attPerM),
      },
      thickness_m: thickness,
      display_color: color,
    });
    id2name[wtId] = name;
  }
  return { materials, id2name };
}

// Ekahau's y axis points down from the image top; Open Intent's points up.
export function buildWallsForFloor(floorId, imgH, wallSegments, wallPoints, id2name) {
  const segs = [];
  for (const seg of wallSegments) {
    const pts = seg.wallPoints ?? [];
    if (pts.length !== 2) continue;
    const p1 = wallPoints[pts[0]];
    const p2 = wallPoints[pts[1]];
    if (!p1 || !p2) continue;
    const loc1 = p1.location ?? {};
    const loc2 = p2.location ?? {};
    if (loc1.floorPlanId !== floorId || loc2.floorPlanId !== floorId) continue;
    const c1 = loc1.coord || {};
    const c2 = loc2.coord || {};
    if ([c1.x, c1.y, c2.x, c2.y].some((v) => v == null)) continue;
    const wallType = Object.hasOwn(id2name, seg.wallTypeId) ? id2name[seg.wallTypeId] : '[Imported] Wall';
    segs.push({
      wall_type: wallType,
      start_point: { x: Number(c1.x), y: Number(imgH) - Number(c1.y) },
      end_point: { x: Number(c2.x), y: Number(imgH) - Number(c2.y) },
    });
  }
  return segs;
}

const IMAGE_ENTRY = /(?:^|\/)(image-)/i;

// Like esx2oi.py, every image- entry is a candidate for every floor; the closest
// size wins (either orientation), and undecodable candidates are skipped.
export async function chooseBestImage(entries, targetW, targetH, imageTools) {
  let best = null;
  let bestScore = 1e18;
  let size = [0, 0];
  for (const [name, bytes] of entries) {
    if (!IMAGE_ENTRY.test(name)) continue;
    let w, h;
    try {
      ({ width: w, height: h } = await imageTools.size(bytes));
    } catch {
      continue;
    }
    const sc = Math.min(Math.abs(w - targetW) + Math.abs(h - targetH), Math.abs(h - targetW) + Math.abs(w - targetH));
    if (sc < bestScore) {
      best = name;
      bestScore = sc;
      size = [w, h];
    }
  }
  if (best === null) throw new ConversionError('has no floor image');
  return { size, png: await imageTools.toPng(entries.get(best)) };
}

// Python's round() sends exact halves to the even integer; Math.round sends them up.
function roundHalfEven(x) {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export async function buildFloorObjects(
  entries, floors, wallSegments, wallPoints, id2name, projPrefix, metersPerUnit, projectName, imageTools,
) {
  const floorsOut = [];
  const images = new Map();
  const floorImgH = {};
  for (const f of floors) {
    const name = f.name || 'Floor';
    const targetW = roundHalfEven(f.width || f.cropMaxX || 0);
    const targetH = roundHalfEven(f.height || f.cropMaxY || 0);
    const { size: [w, h], png } = await chooseBestImage(entries, targetW, targetH, imageTools);
    const imageRel = `images/${projPrefix}_${sanitizeFilename(name)}.png`;

    const dims = [{ width: w, length: h, unit: 'pixels', height: h }];
    const mpu = Number((metersPerUnit ?? {})[f.id] || 0);
    if (mpu > 0) {
      dims.push({ width: w * mpu, length: h * mpu, unit: 'meters', height: 2.5 });
      dims.push({ width: w * mpu * 3.28084, length: h * mpu * 3.28084, unit: 'feet', height: 8.202 });
      // Open Intent reads the pixel dimension's height as the ceiling height in pixels
      dims[0].height = 2.5 / mpu;
    }

    floorsOut.push({
      name,
      map_uri: `file://${imageRel}`,
      dimensions: dims,
      coverage_areas: [],
      wall_segments: buildWallsForFloor(f.id, h, wallSegments, wallPoints, id2name),
      project_name: projectName,
      rotation: 0,
      reference_markers: [],
      floor_id: f.id,
    });
    images.set(imageRel, png);
    floorImgH[f.id] = h;
  }
  return { floorsOut, images, floorImgH };
}
