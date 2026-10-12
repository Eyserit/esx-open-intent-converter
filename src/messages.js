// Turns page events into the card's copy, kept pure so the wording can be tested.
import { ConversionError, NotSupportedError } from './errors.js';

const DIRECTION_LABELS = {
  'esx-to-oi': 'Ekahau .esx → Open Intent .zip',
  'oi-to-esx': 'Open Intent .zip → Ekahau .esx',
};
const FORMAT_NAMES = { esx: 'an Ekahau .esx', oi: 'an Open Intent zip' };

// The format is unknown when the error came before detection (e.g. a damaged zip).
function brokenFileTitle(format, reason) {
  if (format === undefined) return `This file couldn't be converted: ${reason}.`;
  return `This looks like ${FORMAT_NAMES[format]}, but it couldn't be converted: ${reason}.`;
}

function errorTitle(error, format) {
  if (error instanceof NotSupportedError) return "This isn't an Ekahau .esx or an Open Intent zip.";
  if (error instanceof ConversionError) return brokenFileTitle(format, error.reason);
  return 'Something went wrong converting this file.';
}

// detail is left out entirely when there is nothing to show, so the page can hide the line.
function withDetail(card, detail) {
  return detail ? { ...card, detail } : card;
}

export function cardFor(event) {
  switch (event.type) {
    case 'idle':
      return { state: 'idle', title: 'Drop a file here, or choose one', detail: 'Ekahau .esx or Open Intent .zip' };
    case 'dragging':
      return { state: 'dragging', title: 'Release to convert' };
    case 'converting':
      return withDetail({ state: 'converting', title: event.fileName }, DIRECTION_LABELS[event.direction]);
    case 'done':
      return withDetail({ state: 'done', title: event.outputName }, event.notes.join(' · '));
    case 'multiple':
      return { state: 'unsupported', title: 'Drop one file at a time.' };
    case 'too-large':
      return { state: 'unsupported', title: 'This file is over 100 MB.' };
    case 'error':
      return { state: 'unsupported', title: errorTitle(event.error, event.format) };
  }
}

// The public site can only convert, so only the local server's page promises Meraki upload.
export function headlineFor({ meraki }) {
  return meraki
    ? { lead: 'Upload Wi-Fi designs or validations', quiet: 'to the Meraki Dashboard.' }
    : { lead: 'Move Wi-Fi designs', quiet: 'between Ekahau and Open Intent.' };
}
