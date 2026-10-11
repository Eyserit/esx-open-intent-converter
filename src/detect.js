const parseDesign = (bytes) => {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null; // an unparseable file just isn't an Open Intent match
  }
  const isPlainObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  return isPlainObject && 'openintent_version' in parsed ? parsed : null;
};

// Other tools name the file differently, so any top-level .json can be the design.
export function findOpenIntentDesign(entries) {
  for (const [name, bytes] of entries) {
    if (name.includes('/') || !name.endsWith('.json')) continue;
    const design = parseDesign(bytes);
    if (design) return design;
  }
  return null;
}

export function detectFormat(entries) {
  const esx = entries.has('floorPlans.json') && entries.has('project.json');
  const oi = findOpenIntentDesign(entries) !== null;
  if (esx === oi) return null; // neither, or ambiguous
  return esx ? 'esx' : 'oi';
}
