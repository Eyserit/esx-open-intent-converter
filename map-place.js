// The map dialog: the user moves and rotates a to-scale outline of a floor on OpenStreetMap, then presses Done.
import * as L from './vendor/leaflet/leaflet-src.esm.js';
import { bearingTo, cornersFor, offsetBy, parseCoordinates, wrapRotation } from './src/geo.js';
import { SEARCH_NO_MATCH, SEARCH_UNAVAILABLE } from './src/meraki-messages.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const SEARCH_URL = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=';
const SEARCH_GAP_MS = 1000;
const SEARCH_ZOOM = 18;
const STEP_M = 0.5;
const SHIFT_STEP_M = 5;
const DONE_HINT = 'Find the building first: search, or drag the outline.';
const ARROWS = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const ROTATE_KEYS = { '[': -1, ']': 1 };
const OUTLINE_STYLE = {
  className: 'map-outline', color: '#141210', weight: 2, dashArray: '6 4', fillColor: '#141210', fillOpacity: 0.12,
};

L.Icon.Default.imagePath = 'vendor/leaflet/images/';

// Injected at import, once, so Leaflet's stylesheet has loaded by the time the dialog first opens.
const leafletCss = document.createElement('link');
leafletCss.rel = 'stylesheet';
leafletCss.href = 'vendor/leaflet/leaflet.css';
document.head.append(leafletCss);

// Nominatim allows one search per second per user, so this outlives a single opening of the dialog.
let lastSearchAt = -Infinity;

function openingView(start, near) {
  if (start) return [start.center, 19];
  if (near) return [near, SEARCH_ZOOM];
  return [{ lat: 20, lng: 0 }, 2];
}

const plain = ({ lat, lng }) => ({ lat, lng });
const toHalfDegree = (degrees) => Math.round(degrees * 2) / 2;

export function placeFloor({ floor, start, near }) {
  const returnFocus = document.activeElement;
  const dialog = document.getElementById('map-dialog');
  const searchBox = document.getElementById('map-search');
  const searchStatus = document.getElementById('map-search-status');
  const slider = document.getElementById('map-rotation');
  const readout = document.getElementById('map-rotation-value');
  const done = document.getElementById('map-done');
  const doneHint = document.getElementById('map-done-hint');
  document.getElementById('map-floor').textContent = floor.name;
  searchBox.value = '';
  searchStatus.textContent = '';
  dialog.showModal();

  const map = L.map(document.getElementById('map')).setView(...openingView(start, near));
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  map.invalidateSize();

  let center = start ? plain(start.center) : plain(map.getCenter());
  let rotation = start ? start.rotation : 0;
  // With nowhere to start, the outline sits wherever the world map centres, so Done waits for a real choice.
  let chosen = Boolean(start || near);
  // The rotate handle sits a little beyond the top edge, scaled to the floor so it stays clear of it.
  const handleGapM = floor.lengthM / 2 + Math.max(3, floor.lengthM * 0.2);

  const outline = L.polygon([], OUTLINE_STYLE).addTo(map);
  const centreMarker = L.marker(center, {
    draggable: true,
    icon: L.divIcon({ className: 'map-centre', iconSize: [14, 14] }),
  }).addTo(map);
  const rotateHandle = L.marker(center, {
    draggable: true,
    keyboard: false,
    icon: L.divIcon({ className: 'map-rotate', iconSize: [18, 18] }),
  }).addTo(map);
  centreMarker.getElement().setAttribute('aria-label', `Outline of ${floor.name}`);

  function handlePosition() {
    const theta = (rotation * Math.PI) / 180;
    return offsetBy(center, handleGapM * Math.sin(theta), handleGapM * Math.cos(theta));
  }

  // The handle being dragged keeps its pointer position, so it is only snapped back once the drag ends.
  function redraw({ moveHandle = true } = {}) {
    const c = cornersFor({ center, widthM: floor.widthM, lengthM: floor.lengthM, rotation });
    outline.setLatLngs([c.topLeft, c.topRight, c.bottomRight, c.bottomLeft]);
    centreMarker.setLatLng(center);
    if (moveHandle) rotateHandle.setLatLng(handlePosition());
    slider.value = String(rotation);
    readout.textContent = `${Number(rotation.toFixed(1))}°`;
  }

  function showDone() {
    // aria-disabled rather than disabled keeps Done focusable, so the hint is still read out.
    done.setAttribute('aria-disabled', String(!chosen));
    doneHint.textContent = chosen ? '' : DONE_HINT;
  }

  // Only the user's own moves come through here, so each one counts as choosing a place.
  function setCenter(latLng) {
    center = plain(latLng);
    chosen = true;
    redraw();
    showDone();
  }

  function setRotation(degrees, options) {
    rotation = wrapRotation(degrees);
    chosen = true;
    redraw(options);
    showDone();
  }

  centreMarker.on('drag', () => setCenter(centreMarker.getLatLng()));
  rotateHandle.on('drag', () => setRotation(toHalfDegree(bearingTo(center, rotateHandle.getLatLng())), { moveHandle: false }));
  rotateHandle.on('dragend', () => redraw());

  function onOutlineKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key in ARROWS) {
      const [east, north] = ARROWS[event.key];
      const step = event.shiftKey ? SHIFT_STEP_M : STEP_M;
      setCenter(offsetBy(center, east * step, north * step));
    } else if (event.key in ROTATE_KEYS) {
      setRotation(rotation + ROTATE_KEYS[event.key]);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // Leaflet can't drag a polygon, so the outline's body is dragged with pointer events, which also cover touch.
  function dragOutline(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const path = event.currentTarget;
    const from = map.mouseEventToLatLng(event);
    const startCenter = center;
    const drag = new AbortController();
    map.dragging.disable();
    path.setPointerCapture(event.pointerId);
    path.addEventListener('pointermove', (move) => {
      const to = map.mouseEventToLatLng(move);
      setCenter({ lat: startCenter.lat + to.lat - from.lat, lng: startCenter.lng + to.lng - from.lng });
    }, { signal: drag.signal });
    const end = () => {
      drag.abort();
      map.dragging.enable();
    };
    path.addEventListener('pointerup', end, { signal: drag.signal });
    path.addEventListener('pointercancel', end, { signal: drag.signal });
  }

  const flyTo = (latLng) => {
    map.flyTo(latLng, SEARCH_ZOOM);
    setCenter(latLng);
  };

  async function search(query, signal) {
    const coordinates = parseCoordinates(query);
    if (coordinates) {
      searchStatus.textContent = '';
      return flyTo(coordinates);
    }
    // A repeated Enter inside the gap is ignored, and leaves the last search's message in place.
    if (Date.now() - lastSearchAt < SEARCH_GAP_MS) return;
    lastSearchAt = Date.now();
    searchStatus.textContent = '';
    let results;
    try {
      const response = await fetch(SEARCH_URL + encodeURIComponent(query), { signal });
      if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
      results = await response.json();
    } catch {
      if (!signal.aborted) searchStatus.textContent = SEARCH_UNAVAILABLE;
      return;
    }
    if (results.length === 0) {
      searchStatus.textContent = SEARCH_NO_MATCH;
      return;
    }
    flyTo({ lat: Number(results[0].lat), lng: Number(results[0].lon) });
  }

  redraw();
  showDone();
  const opened = new AbortController();
  const { signal } = opened;
  centreMarker.getElement().addEventListener('keydown', onOutlineKey);
  outline.getElement().addEventListener('pointerdown', dragOutline);
  slider.addEventListener('input', () => setRotation(Number(slider.value)), { signal });
  searchBox.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    const query = searchBox.value.trim();
    if (query) search(query, signal);
  }, { signal });
  document.getElementById('map-move-here').addEventListener('click', () => setCenter(map.getCenter()), { signal });

  return new Promise((resolve) => {
    function finish(result) {
      opened.abort();
      map.remove();
      dialog.close();
      returnFocus?.focus?.();
      resolve(result);
    }
    done.addEventListener('click', () => {
      if (chosen) finish({ center, rotation });
    }, { signal });
    document.getElementById('map-close').addEventListener('click', () => finish(null), { signal });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    }, { signal });
  });
}
