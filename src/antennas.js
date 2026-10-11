const BAND_LABEL = { TWO: '2.4GHz', FIVE: '5GHz', SIX: '6GHz' };
const GENERIC_GAIN = { TWO: 3, FIVE: 4, SIX: 4 };
const PATTERN_POINTS = 72;
const PATTERN_STEP_DEGREES = 5;

const norm = (s) => String(s).trim().toLowerCase();
const isWifi = (a) => a.radioTechnology === 'IEEE802_11';
const matches = (a, vendor, model, band) =>
  a.frequencyBand === band && norm(a.apVendor) === norm(vendor) && norm(a.apModel) === norm(model);

const flatPlane = (alignmentAngle, gain) => ({
  alignmentAngle,
  gains: Array.from({ length: PATTERN_POINTS }, (_, i) => ({ angle: i * PATTERN_STEP_DEGREES, gain })),
});

// Ekahau requires every radio to reference an antenna type; a flat omni pattern is accepted for unknown models.
export function genericAntenna(vendor, model, band) {
  const gain = GENERIC_GAIN[band];
  return {
    name: `${vendor} ${model} ${BAND_LABEL[band]}`,
    directional: false,
    defaultTiltAngle: 0,
    frequencyBand: band,
    apVendor: vendor,
    apModel: model,
    maxGain: gain,
    hplane: flatPlane(180, gain),
    eplane: flatPlane(90, gain),
    radioTechnology: 'IEEE802_11',
    defaultMounting: 'CEILING',
    apCoupling: 'INTERNAL_ANTENNA',
  };
}

export function findAntenna(library, vendor, model, band) {
  return library.find((a) => isWifi(a) && matches(a, vendor, model, band)) ?? null;
}

// id/status are per-design; callers assign fresh ones when writing an .esx.
const withoutDesignFields = ({ id, status, ...rest }) => rest;

export function mergeAntennaTypes(library, antennaTypes) {
  const incoming = antennaTypes.filter(isWifi).map(withoutDesignFields);
  const kept = library.filter((old) => !incoming.some((a) => matches(old, a.apVendor, a.apModel, a.frequencyBand)));
  return [...kept, ...incoming];
}
