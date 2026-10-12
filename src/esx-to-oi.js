// Copyright 2025 oiconvert
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// This file is a modified JavaScript port of esx2oi.py.

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

// Like esx2oi.py, every image- entry is a candidate for every floor and undecodable
// candidates are skipped; each is decoded once per conversion rather than once per floor.
export async function measureImages(entries, imageTools) {
  const sizes = new Map();
  for (const [name, bytes] of entries) {
    if (!IMAGE_ENTRY.test(name)) continue;
    try {
      const { width, height } = await imageTools.size(bytes);
      sizes.set(name, [width, height]);
    } catch {
      continue;
    }
  }
  return sizes;
}

// The closest size wins (either orientation); the first wins a tie, as in esx2oi.py.
function closestInSize(sizes, targetW, targetH) {
  let best = null;
  let bestScore = 1e18;
  for (const [name, [w, h]] of sizes) {
    const sc = Math.min(Math.abs(w - targetW) + Math.abs(h - targetH), Math.abs(h - targetW) + Math.abs(w - targetH));
    if (sc < bestScore) {
      best = name;
      bestScore = sc;
    }
  }
  return best;
}

// Unlike esx2oi.py, a floor's own image-<imageId> comes first when it decodes, so
// same-size floors don't all get the first image; otherwise esx2oi's heuristic applies.
export async function chooseBestImage(entries, sizes, targetW, targetH, imageTools, imageId) {
  const ownImage = `image-${imageId}`;
  const best = imageId != null && sizes.has(ownImage) ? ownImage : closestInSize(sizes, targetW, targetH);
  if (best === null) throw new ConversionError('the design has no readable floor image');
  return { size: sizes.get(best), png: await imageTools.toPng(entries.get(best)) };
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
  const sizes = await measureImages(entries, imageTools);
  for (const f of floors) {
    const name = f.name || 'Floor';
    const targetW = roundHalfEven(f.width || f.cropMaxX || 0);
    const targetH = roundHalfEven(f.height || f.cropMaxY || 0);
    const { size: [w, h], png } = await chooseBestImage(entries, sizes, targetW, targetH, imageTools, f.imageId);
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

// Mirrors Python's max(lo, min(hi, v)) for numeric v.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildApCoordinates(ap, floorId, floorName, floorImgHById, metersPerUnit, floorDimsByName) {
  const coord = (ap.location ?? {}).coord ?? {};
  let xPx = coord.x;
  let yPx = coord.y;
  if (typeof xPx !== 'number' || typeof yPx !== 'number') return [];
  const imgH = Number(floorImgHById[floorId] || 0);
  yPx = imgH ? imgH - yPx : yPx;
  if (floorDimsByName && Object.hasOwn(floorDimsByName, floorName)) {
    const [width, length] = floorDimsByName[floorName];
    xPx = clamp(xPx, 0, width);
    yPx = clamp(yPx, 0, length);
  }
  const mpu = Number(metersPerUnit[floorId] || 0);
  if (!(mpu > 0)) return [{ coordinate_xyz: { x: xPx, y: yPx, z: 0, unit: 'pixels' } }];
  const xM = xPx * mpu;
  const yM = yPx * mpu;
  return [
    { coordinate_xyz: { x: xPx, y: yPx, z: 2.5 / mpu, unit: 'pixels' } },
    { coordinate_xyz: { x: xM, y: yM, z: 2.5, unit: 'meters' } },
    { coordinate_xyz: { x: xM * 3.28084, y: yM * 3.28084, z: 8.202, unit: 'feet' } },
  ];
}

// Every AP gets the fallback vendor/model so the importer shows it; the originals are kept.
export function buildAps(
  aps, floorNameById, floorImgHById, metersPerUnit, floorDimsByName, fallbackVendor, fallbackModel,
) {
  const vendor = (fallbackVendor || 'ubiquiti').toLowerCase();
  const model = (fallbackModel || 'uap-ac-pro').toLowerCase();
  return (aps ?? []).map((ap, i) => {
    const loc = ap.location ?? {};
    const floorId = loc.floorPlanId || ap.floorPlanId || ap.floorId;
    const floorName = floorNameById[floorId] || 'Floor';
    return {
      name: ap.name || `AP-${i}`,
      floorplan_name: floorName,
      manufacturer: vendor,
      model,
      dot11_radios: [
        { id: 0, radio_function: 'CLIENT_ACCESS', band: 'FREQ_2.4GHZ', channel: 11, channel_width: '20_MHz', transmit_power: 6, mimo_chains: 2 },
        { id: 1, radio_function: 'CLIENT_ACCESS', band: 'FREQ_5GHZ', channel: 36, channel_width: '80_MHz', transmit_power: 6, mimo_chains: 2 },
      ],
      antennas: [{ vendor, model, bands: [{ band: 'FREQ_2.4GHZ' }, { band: 'FREQ_5GHZ' }] }],
      coordinates: buildApCoordinates(ap, floorId, floorName, floorImgHById, metersPerUnit, floorDimsByName),
      orientation: { rotation: 0, tilt: 0 },
      display_color: '#4687f0',
      manufacturer_original: (ap.vendor || ap.manufacturer || '').trim(),
      model_original: (ap.model || '').trim(),
    };
  });
}

const decoder = new TextDecoder();

function parseJsonKey(entries, fileName, key) {
  try {
    return JSON.parse(decoder.decode(entries.get(fileName)))[key];
  } catch {
    throw new ConversionError(`${fileName} is unreadable`);
  }
}

function readRequiredList(entries, fileName, key) {
  if (!entries.has(fileName)) throw new ConversionError(`missing ${fileName}`);
  const list = parseJsonKey(entries, fileName, key);
  if (!Array.isArray(list)) throw new ConversionError(`${fileName} is unreadable`);
  return list;
}

function readOptionalList(entries, fileName, key) {
  return entries.has(fileName) ? readRequiredList(entries, fileName, key) : [];
}

// esx2oi.py falls back to "Project" on any project.json problem; this mirrors it.
function readProjectTitle(entries) {
  try {
    const project = parseJsonKey(entries, 'project.json', 'project');
    return project.title || project.name || 'Project';
  } catch {
    return 'Project';
  }
}

const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

export async function esxToOi(
  entries, imageTools,
  { prefix = '[Imported] ', fallbackVendor = 'ubiquiti', fallbackModel = 'uap-ac-pro', onProgress = () => {} } = {},
) {
  const floors = readRequiredList(entries, 'floorPlans.json', 'floorPlans');
  // esx2oi.py requires the wall files, but Ekahau leaves them out when no walls are drawn.
  const wallSegments = readOptionalList(entries, 'wallSegments.json', 'wallSegments');
  const wallPoints = byId(readOptionalList(entries, 'wallPoints.json', 'wallPoints'));
  const wallTypes = byId(readOptionalList(entries, 'wallTypes.json', 'wallTypes'));
  const esxAps = readOptionalList(entries, 'accessPoints.json', 'accessPoints');
  const metersPerUnit = Object.fromEntries(floors.map((f) => [f.id, Number(f.metersPerUnit || 0)]));
  const projectTitle = readProjectTitle(entries);

  const { materials, id2name } = buildWallMaterials(wallTypes, wallSegments, prefix);
  onProgress({ stage: 'images' });
  const { floorsOut, images, floorImgH } = await buildFloorObjects(
    entries, floors, wallSegments, wallPoints, id2name, sanitizeFilename(projectTitle), metersPerUnit, projectTitle, imageTools,
  );
  const floorNameById = Object.fromEntries(floors.map((f) => [f.id, f.name || 'Floor']));
  const floorDimsByName = Object.fromEntries(
    floorsOut.map((f) => [f.name, [f.dimensions[0].width, f.dimensions[0].length]]),
  );
  const accesspoints = buildAps(esxAps, floorNameById, floorImgH, metersPerUnit, floorDimsByName, fallbackVendor, fallbackModel);

  return {
    openintent: {
      openintent_version: '2.0.0',
      floorplans: floorsOut,
      wall_materials: materials,
      accesspoints,
      switches: [],
    },
    images,
  };
}
