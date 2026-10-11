const OPEN_INTENT_NAMES = ['openintent.json', 'design.json'];

const hasOpenIntentVersion = (bytes) => {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return false; // an unparseable file just isn't an Open Intent match
  }
  const isPlainObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  return isPlainObject && 'openintent_version' in parsed;
};

const isOpenIntent = (entries) =>
  OPEN_INTENT_NAMES.some((name) => entries.has(name) && hasOpenIntentVersion(entries.get(name)));

export function detectFormat(entries) {
  const esx = entries.has('floorPlans.json') && entries.has('project.json');
  const oi = isOpenIntent(entries);
  if (esx === oi) return null; // neither, or ambiguous
  return esx ? 'esx' : 'oi';
}
