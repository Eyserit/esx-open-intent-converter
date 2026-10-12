// The Send to Meraki steps inside the card. Loaded only after the pill is clicked, so GitHub Pages never fetches it.
import { listFloors } from './src/floors.js';
import { cornersFor } from './src/geo.js';
import { REGIONS } from './src/meraki-regions.js';
import {
  ACTION_LABELS, GENERIC, NO_ORGANISATIONS, NO_WIRELESS, SERVER_STOPPED, buildingReferenceIndex, effectivePlacements,
  finishedCard, floorRows, uploadButton,
} from './src/meraki-messages.js';
import { placeFloor } from './map-place.js';

const STEPS = ['Connect', 'Network', 'Floors'];
const UPLOAD_LABELS = { created: 'Created', updated: 'Updated' };

// The key's only home in the page: never stored, put in a URL or left in the DOM.
let apiKey = null;
let region = 'global';

async function api(path, body) {
  let response;
  try {
    // body can carry its own region and apiKey: Connect sends the typed key before it is kept.
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, apiKey, ...body }),
    });
  } catch {
    throw new Error(SERVER_STOPPED);
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(GENERIC);
  }
  if (!response.ok) throw new Error(json?.error ?? GENERIC);
  return json;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const mono = (text) => el('span', { className: 'mono', textContent: text });
const heading = (...content) => el('h2', { className: 'card-title meraki-heading', tabIndex: -1 }, ...content);
const detail = (text) => el('p', { className: 'card-detail', textContent: text });
const actions = (...buttons) => el('div', { className: 'actions' }, ...buttons);
const option = (value, text, selected) => el('option', { value, textContent: text, selected });

function pill(text, onClick) {
  const button = el('button', { className: 'pill', type: 'button', textContent: text });
  button.addEventListener('click', onClick);
  return button;
}

const submit = (text) => el('button', { className: 'pill pill-primary', type: 'submit', textContent: text });

function field(id, labelText, control, ...after) {
  control.id = id;
  return el('div', { className: 'field' }, el('label', { htmlFor: id, textContent: labelText }), control, ...after);
}

// Starts empty; role="alert" announces whatever is written into it later.
function errorLine(id, describes) {
  const line = el('p', { className: 'field-error', id });
  line.setAttribute('role', 'alert');
  describes.setAttribute('aria-describedby', id);
  return line;
}

function stepper(index) {
  return el('ol', { className: 'stepper' }, ...STEPS.map((name, i) => {
    const dot = el('span', { className: 'dot', textContent: String(i + 1) });
    dot.setAttribute('aria-hidden', 'true');
    const item = el('li', { className: i === index ? 'now' : '' }, dot, name);
    if (i === index) item.setAttribute('aria-current', 'step');
    return item;
  }));
}

// The URL comes from Meraki via the relay, so only an https link is trusted as an href.
function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function doneGlyph() {
  const glyph = el('div', { className: 'glyph' }, document.querySelector('.glyph-done').cloneNode(true));
  glyph.setAttribute('aria-hidden', 'true');
  return glyph;
}

export function startMerakiFlow({ container, openintent, onExit }) {
  const status = document.getElementById('status');
  const floors = listFloors(openintent.design, openintent.images);
  const placements = new Map();
  const unticked = new Set();
  // Names typed for Meraki, by floor index; kept so Back to floors shows them again.
  const names = new Map();
  // Floors of one building share a single placement; kept so Back to floors shows it again.
  const building = { together: false, placement: null };
  let lastPlacedCenter = null;
  let organizations = [];
  let organizationId = null;
  let networks = [];
  let network = null;
  let plans = [];

  // Each step change or request takes a ticket, so a late reply can't draw over something newer.
  let latest = 0;
  function ticket() {
    const mine = (latest += 1);
    return () => mine !== latest;
  }

  function showStep(...nodes) {
    ticket();
    container.replaceChildren(...nodes);
    container.querySelector('.meraki-heading').focus();
  }

  const announce = (text) => {
    status.textContent = text;
  };

  const currentPlacements = () => effectivePlacements(placements, { ...building, count: floors.length });
  const currentRows = () => floorRows(floors, plans, currentPlacements(), unticked, names);

  function exit() {
    apiKey = null;
    ticket();
    container.replaceChildren();
    onExit();
  }

  function convertAnother() {
    exit();
    // The Done card is back, so its own Convert another button does the reset.
    document.getElementById('another').click();
  }

  function connectStep() {
    apiKey = null;
    const regionSelect = el('select', {}, ...Object.entries(REGIONS).map(([value, { label, host }]) =>
      option(value, `${label} · ${host}`, value === region)));
    // A masked text field, not a password field, so browsers don't offer to save the key as a login.
    const keyInput = el('input', {
      type: 'text', name: 'meraki-connect', className: 'masked', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: false, required: true,
    });
    const error = errorLine('meraki-key-error', keyInput);
    const form = el('form', { className: 'meraki-form' },
      field('meraki-region', 'Region', regionSelect),
      field('meraki-key', 'API key', keyInput, error),
      actions(pill('Back', exit), submit('Connect')));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const stale = ticket();
      error.textContent = '';
      try {
        const found = await api('api/organizations', { region: regionSelect.value, apiKey: keyInput.value });
        if (stale()) return;
        if (found.length === 0) {
          error.textContent = NO_ORGANISATIONS;
          return;
        }
        region = regionSelect.value;
        apiKey = keyInput.value;
        keyInput.value = '';
        organizations = found;
        organizationId = found[0].id;
        networkStep();
      } catch (failure) {
        if (!stale()) error.textContent = failure.message;
      }
    });

    showStep(
      stepper(0),
      heading('Connect to Meraki Dashboard'),
      detail('Your key stays on this computer and is forgotten when you close the tab.'),
      form,
    );
  }

  function networkStep() {
    const orgSelect = el('select', { className: 'mono' },
      ...organizations.map(({ id, name }) => option(id, name, id === organizationId)));
    const networkSelect = el('select', { className: 'mono', disabled: true });
    const error = errorLine('meraki-network-error', networkSelect);
    const form = el('form', { className: 'meraki-form' },
      field('meraki-organisation', 'Organisation', orgSelect),
      field('meraki-network', 'Network', networkSelect, error),
      actions(pill('Back', connectStep), pill('Disconnect', exit), submit('Next')));

    async function loadNetworks() {
      const stale = ticket();
      organizationId = orgSelect.value;
      networkSelect.disabled = true;
      networkSelect.replaceChildren();
      error.textContent = '';
      try {
        const found = await api('api/networks', { organizationId });
        if (stale()) return;
        networks = found;
        if (found.length === 0) {
          error.textContent = NO_WIRELESS;
          return;
        }
        networkSelect.append(...found.map(({ id, name }) => option(id, name, id === network?.id)));
        networkSelect.disabled = false;
      } catch (failure) {
        if (!stale()) error.textContent = failure.message;
      }
    }

    orgSelect.addEventListener('change', loadNetworks);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (networkSelect.disabled) return;
      const stale = ticket();
      network = networks.find(({ id }) => id === networkSelect.value);
      error.textContent = '';
      try {
        const found = await api('api/floor-plans', { networkId: network.id });
        if (stale()) return;
        plans = found;
        floorsStep();
      } catch (failure) {
        if (!stale()) error.textContent = failure.message;
      }
    });

    showStep(stepper(1), heading('Choose a network'), detail('Only networks with wireless are listed.'), form);
    loadNetworks();
  }

  // Built once and then updated in place, so typing a name never moves focus out of its input.
  function floorItem(row, index, refresh) {
    const box = el('input', { type: 'checkbox', id: `meraki-floor-${index}` });
    const what = el('small');
    // The hidden comma keeps the name and the action apart when the label is read as one string.
    const separator = el('span', { className: 'visually-hidden', textContent: ', ' });
    const label = el('label', { className: 'floor-name', htmlFor: box.id }, mono(row.name), separator, what);
    const tag = el('span', { className: 'tag' });
    const place = el('button', { className: 'pill pill-small', type: 'button' });
    const nameInput = el('input', {
      type: 'text', className: 'mono', value: row.merakiName, autocomplete: 'off', spellcheck: false,
    });
    const nameProblem = el('p', { className: 'field-error', id: `meraki-floor-name-${index}-problem` });
    nameInput.setAttribute('aria-describedby', nameProblem.id);
    const nameField = field(`meraki-floor-name-${index}`, 'Name in Meraki', nameInput, nameProblem);
    // A floor that can't be uploaded at all has nothing to name.
    nameField.hidden = Boolean(floors[index].problem);
    const item = el('li', { className: 'floor-row' }, box, label, tag, place, nameField);

    nameInput.addEventListener('input', () => {
      names.set(index, nameInput.value);
      refresh();
    });
    box.addEventListener('change', () => {
      if (box.checked) unticked.delete(index);
      else unticked.add(index);
      refresh();
    });
    place.addEventListener('click', async () => {
      const floor = floors[index];
      const placed = await placeFloor({ floor, start: placements.get(index) ?? null, near: lastPlacedCenter });
      if (!placed) return;
      placements.set(index, placed);
      lastPlacedCenter = placed.center;
      refresh();
    });

    function update({ action, reason, ticked, placed, nameProblem: problem }) {
      const blocked = action === 'blocked';
      box.checked = ticked;
      box.disabled = blocked;
      what.textContent = reason ? `${ACTION_LABELS[action]} · ${reason}` : ACTION_LABELS[action];
      // Placed together, the building's own button and tag stand in for every row's.
      tag.hidden = blocked || building.together;
      place.hidden = blocked || building.together;
      nameProblem.textContent = problem ?? '';
      nameInput.setAttribute('aria-invalid', String(problem !== null));
      tag.textContent = placed ? 'Placed' : 'Not placed yet';
      tag.classList.toggle('tag-placed', placed);
      place.textContent = placed ? 'Edit' : 'Place on map';
      // Every row has the same button text, so the name tells them apart for screen readers.
      place.setAttribute('aria-label', `${place.textContent}, ${row.name}`);
    }
    return { item, update };
  }

  // Built once and then updated in place, like the floor rows.
  function buildingControls(refresh) {
    const toggle = el('input', { type: 'checkbox', id: 'meraki-together', checked: building.together });
    const together = el('div', { className: 'meraki-together' },
      toggle, el('label', { htmlFor: toggle.id, textContent: 'These floors are one building: place them together' }));
    const tag = el('span', { className: 'tag' });
    const place = el('button', { className: 'pill pill-small', type: 'button' });
    const placeRow = el('div', { className: 'meraki-building' }, place, tag);

    toggle.addEventListener('change', () => {
      building.together = toggle.checked;
      // Unticking leaves every floor where the building was, ready to adjust one by one.
      if (!building.together && building.placement) floors.forEach((_, i) => placements.set(i, building.placement));
      refresh();
    });
    place.addEventListener('click', async () => {
      const reference = buildingReferenceIndex(floors, currentRows());
      if (reference === null) return;
      const { name, widthM, lengthM } = floors[reference];
      const placed = await placeFloor({ floor: { name, widthM, lengthM }, start: building.placement, near: lastPlacedCenter });
      if (!placed) return;
      building.placement = placed;
      lastPlacedCenter = placed.center;
      refresh();
    });

    function update(rows) {
      placeRow.hidden = !building.together || buildingReferenceIndex(floors, rows) === null;
      const placed = building.placement !== null;
      tag.textContent = placed ? 'Placed' : 'Not placed yet';
      tag.classList.toggle('tag-placed', placed);
      place.textContent = placed ? 'Edit building placement' : 'Place building on map';
    }
    return { nodes: [together, placeRow], update };
  }

  function floorsStep() {
    const hint = el('p', { className: 'meraki-hint', id: 'meraki-upload-hint' });
    const upload = el('button', { className: 'pill pill-primary', type: 'button' });
    upload.setAttribute('aria-describedby', hint.id);

    function refresh() {
      const rows = currentRows();
      rows.forEach((row, i) => items[i].update(row));
      controls?.update(rows);
      const button = uploadButton(rows, { together: building.together });
      upload.textContent = button.label;
      // aria-disabled rather than disabled keeps the button focusable, so the hint is still read out.
      upload.setAttribute('aria-disabled', String(!button.enabled));
      hint.textContent = button.hint ?? '';
      return { rows, enabled: button.enabled };
    }

    const items = currentRows().map((row, i) => floorItem(row, i, refresh));
    // Only a design with several floors can be placed as one building.
    const controls = floors.length >= 2 ? buildingControls(refresh) : null;
    upload.addEventListener('click', () => {
      const { rows, enabled } = refresh();
      if (enabled) uploadStep(rows);
    });
    refresh();

    showStep(
      stepper(2),
      heading('Choose floors to upload'),
      detail('Place each ticked floor on the map before uploading.'),
      ...(controls?.nodes ?? []),
      el('ul', { className: 'floor-list' }, ...items.map(({ item }) => item)),
      actions(pill('Back', networkStep), pill('Disconnect', exit), upload),
      hint,
    );
  }

  async function uploadFloor({ floor, index, merakiName, placement }) {
    const { center, rotation } = placement;
    const { topLeft, topRight } = cornersFor({ center, widthM: floor.widthM, lengthM: floor.lengthM, rotation });
    try {
      const { action } = await api('api/floor-plans/upload', {
        networkId: network.id,
        name: merakiName,
        imageContents: floor.image.bytes.toBase64(),
        topLeftCorner: topLeft,
        topRightCorner: topRight,
      });
      return { index, outcome: action, label: UPLOAD_LABELS[action] };
    } catch (failure) {
      return { index, outcome: 'failed', label: `Failed: ${failure.message}` };
    }
  }

  async function uploadStep(rows) {
    // Each upload keeps its floor's index, which is what placements and unticked are keyed by.
    const placed = currentPlacements();
    const chosen = floors.flatMap((floor, index) => (rows[index].ticked
      ? [{ floor, index, merakiName: rows[index].merakiName, placement: placed.get(index) }]
      : []));
    const progress = detail('');
    const tags = chosen.map(() => el('span', { className: 'tag', textContent: 'Waiting' }));
    const list = el('ul', { className: 'floor-list' }, ...chosen.map(({ merakiName }, i) =>
      el('li', { className: 'floor-row' }, el('span', { className: 'floor-name' }, mono(merakiName)), tags[i])));
    showStep(heading('Uploading to ', mono(network.name)), progress, list);

    const results = [];
    for (const [i, upload] of chosen.entries()) {
      const { merakiName } = upload;
      progress.textContent = `${i} of ${chosen.length} floors done`;
      tags[i].textContent = 'Uploading…';
      announce(`Uploading ${merakiName}, ${i + 1} of ${chosen.length}.`);
      const result = await uploadFloor(upload);
      tags[i].textContent = result.label;
      tags[i].classList.toggle('tag-placed', result.outcome !== 'failed');
      tags[i].classList.toggle('tag-failed', result.outcome === 'failed');
      announce(`${merakiName}: ${result.label}`);
      results.push(result);
    }
    finishedStep(results, list);
  }

  function finishedStep(results, list) {
    const { title, detail: counts } = finishedCard({ networkName: network.name, results });
    const failed = results.some(({ outcome }) => outcome === 'failed');
    const dashboard = isHttps(network.url)
      ? [el('a', {
        className: 'pill pill-primary', href: network.url, target: '_blank', rel: 'noopener', textContent: 'Open in Dashboard',
      })]
      : [];
    const backToFloors = pill('Back to floors', async () => {
      const stale = ticket();
      error.textContent = '';
      try {
        const found = await api('api/floor-plans', { networkId: network.id });
        if (stale()) return;
        plans = found;
        // Floors that went up are left unticked, so only the failed ones are sent again.
        for (const { index, outcome } of results) if (outcome !== 'failed') unticked.add(index);
        floorsStep();
      } catch (failure) {
        if (!stale()) error.textContent = failure.message;
      }
    });
    const error = errorLine('meraki-finished-error', backToFloors);

    showStep(
      doneGlyph(),
      heading(title),
      detail(counts),
      ...(failed ? [list] : []),
      actions(
        ...dashboard,
        ...(failed ? [backToFloors] : []),
        pill('Disconnect', exit),
        pill('Convert another', convertAnother),
      ),
      error,
    );
    announce(`${title}. ${counts}`);
  }

  connectStep();
}
