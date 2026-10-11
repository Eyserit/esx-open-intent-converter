// DOM wiring only: the copy comes from cardFor() and the work from convert().
import { convert } from './src/convert.js';
import { cardFor } from './src/messages.js';
import { browserImageTools } from './src/browser-images.js';
import { ConversionError, NotSupportedError } from './src/errors.js';

const card = document.getElementById('card');
const title = document.getElementById('card-title');
const detail = document.getElementById('card-detail');
const progress = document.getElementById('progress');
const status = document.getElementById('status');
const fileInput = document.getElementById('file');
const buttons = {
  choose: document.getElementById('choose'),
  download: document.getElementById('download'),
  another: document.getElementById('another'),
  retry: document.getElementById('retry'),
};

// Which actions each card state offers.
const ACTIONS = {
  idle: ['choose'],
  dragging: [],
  converting: [],
  done: ['download', 'another'],
  unsupported: ['retry'],
};
const STAGE_PERCENT = { reading: 12, converting: 38, images: 66, writing: 90 };
const FORMAT_BY_DIRECTION = { 'esx-to-oi': 'esx', 'oi-to-esx': 'oi' };

// Fetched once at load so no request happens while converting. Only Open Intent -> .esx
// awaits it, so a failed load surfaces there; this handler stops it being an unhandled
// rejection at load and leaves .esx -> Open Intent working.
const libraryReady = fetch('src/antenna-library.json').then((response) => {
  if (!response.ok) throw new Error(`antenna library: HTTP ${response.status}`);
  return response.json();
});
libraryReady.catch(() => {});

let currentEvent = { type: 'idle' };
let downloadUrl = null;
let busy = false;
let dragDepth = 0;

function render(event) {
  const { state, title: text, detail: more } = cardFor(event);
  const focusWasInCard = card.contains(document.activeElement);

  card.dataset.state = state;
  title.textContent = text;
  detail.textContent = more ?? '';
  detail.hidden = more === undefined;
  progress.hidden = state !== 'converting';
  for (const [name, button] of Object.entries(buttons)) button.hidden = !ACTIONS[state].includes(name);

  const announcement = more ? `${text} ${more}` : text;
  if (status.textContent !== announcement) status.textContent = announcement;

  // A hidden button drops focus to <body>; keep keyboard users on the card.
  if (focusWasInCard) (card.querySelector('.actions > :not([hidden])') ?? card).focus();
}

function show(event) {
  currentEvent = event;
  render(event);
}

function setProgress(stage) {
  const percent = STAGE_PERCENT[stage];
  progress.setAttribute('aria-valuenow', String(percent));
  progress.firstElementChild.style.width = `${percent}%`;
}

function clearDownload() {
  if (downloadUrl === null) return;
  URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  buttons.download.removeAttribute('download');
  buttons.download.href = '#';
}

function offerDownload({ outputName, bytes }) {
  downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  buttons.download.href = downloadUrl;
  buttons.download.download = outputName;
}

async function convertFile(file) {
  clearDownload();
  busy = true;
  let direction;
  show({ type: 'converting', fileName: file.name });
  setProgress('reading');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const onProgress = (event) => {
      direction = event.direction ?? direction;
      show({ type: 'converting', fileName: file.name, direction });
      setProgress(event.stage);
    };
    const result = await convert(bytes, file.name, { imageTools: browserImageTools, library: libraryReady, onProgress });
    offerDownload(result);
    show({ type: 'done', outputName: result.outputName, notes: result.notes });
  } catch (error) {
    if (!(error instanceof NotSupportedError || error instanceof ConversionError)) console.error(error);
    show({ type: 'error', error, format: FORMAT_BY_DIRECTION[direction] });
  } finally {
    busy = false;
  }
}

function handleFiles(files) {
  if (busy) return;
  if (files.length === 0) return render(currentEvent);
  if (files.length > 1) return show({ type: 'multiple' });
  convertFile(files[0]);
}

function openPicker() {
  if (!busy) fileInput.click();
}

// --- The whole page is the drop target ---

const isFileDrag = (event) => event.dataTransfer?.types.includes('Files');

document.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event) || busy) return;
  event.preventDefault();
  dragDepth += 1;
  if (dragDepth === 1) render({ type: 'dragging' });
});

document.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
});

document.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event) || busy) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) render(currentEvent);
});

document.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  handleFiles(event.dataTransfer.files);
});

// --- Picker, card and buttons ---

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileInput.value = ''; // so choosing the same file again still fires change
  handleFiles(files);
});

const cardOpensPicker = () => ['idle', 'unsupported'].includes(card.dataset.state);

card.addEventListener('click', (event) => {
  if (event.target.closest('button, a') || !cardOpensPicker()) return;
  openPicker();
});

card.addEventListener('keydown', (event) => {
  if (event.target !== card || !(event.key === 'Enter' || event.key === ' ')) return;
  event.preventDefault(); // Space would otherwise scroll the page
  if (cardOpensPicker()) openPicker();
});

buttons.choose.addEventListener('click', openPicker);
buttons.retry.addEventListener('click', openPicker);
buttons.another.addEventListener('click', () => {
  clearDownload();
  show({ type: 'idle' });
});

render(currentEvent);
