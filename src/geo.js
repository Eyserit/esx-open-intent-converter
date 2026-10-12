// Turns a floor's centre, size and rotation into the lat/lng corners Meraki wants, using a flat local approximation.

const METRES_PER_DEGREE_LAT = 111320;

function metresPerDegreeLng(lat) {
  return METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

// Rotation is clockwise, so east/north offsets turn by x' = x cos + y sin, y' = -x sin + y cos.
function pointAt(center, rotation, eastM, northM) {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    lat: center.lat + (-eastM * sin + northM * cos) / METRES_PER_DEGREE_LAT,
    lng: center.lng + (eastM * cos + northM * sin) / metresPerDegreeLng(center.lat),
  };
}

export function cornersFor({ center, widthM, lengthM, rotation }) {
  const at = (x, y) => pointAt(center, rotation, x, y);
  const w = widthM / 2;
  const l = lengthM / 2;
  return { topLeft: at(-w, l), topRight: at(w, l), bottomRight: at(w, -l), bottomLeft: at(-w, -l) };
}

export function offsetBy(center, eastM, northM) {
  return {
    lat: center.lat + northM / METRES_PER_DEGREE_LAT,
    lng: center.lng + eastM / metresPerDegreeLng(center.lat),
  };
}

export function bearingTo(from, to) {
  const northM = (to.lat - from.lat) * METRES_PER_DEGREE_LAT;
  const eastM = (to.lng - from.lng) * metresPerDegreeLng(from.lat);
  return (Math.atan2(eastM, northM) * 180) / Math.PI;
}

// The slider runs from -180 to 180 inclusive, so values already in range are left alone.
export function wrapRotation(rotation) {
  if (rotation >= -180 && rotation <= 180) return rotation;
  return rotation - 360 * Math.ceil((rotation - 180) / 360);
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function parseCoordinates(text) {
  const parts = text.trim().split(/\s*,\s*|\s+/);
  if (parts.length !== 2 || !parts.every((part) => DECIMAL.test(part))) return null;
  const [lat, lng] = parts.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
