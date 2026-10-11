// Turns a floor's centre, size and rotation into the lat/lng corners Meraki wants, using a flat local approximation.

const METRES_PER_DEGREE_LAT = 111320;

export function cornersFor({ center, widthM, lengthM, rotation }) {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180);
  // Rotation is clockwise, so east/north offsets turn by x' = x cos + y sin, y' = -x sin + y cos.
  const at = (x, y) => ({
    lat: center.lat + (-x * sin + y * cos) / METRES_PER_DEGREE_LAT,
    lng: center.lng + (x * cos + y * sin) / metresPerDegreeLng,
  });
  const w = widthM / 2;
  const l = lengthM / 2;
  return { topLeft: at(-w, l), topRight: at(w, l), bottomRight: at(w, -l), bottomLeft: at(-w, -l) };
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function parseCoordinates(text) {
  const parts = text.trim().split(/\s*,\s*|\s+/);
  if (parts.length !== 2 || !parts.every((part) => DECIMAL.test(part))) return null;
  const [lat, lng] = parts.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
