export function matchFloorPlan(name, plans) {
  const matches = plans.filter((plan) => plan.name === name);
  if (matches.length === 0) return { action: 'create' };
  if (matches.length > 1) return { action: 'blocked', count: matches.length };
  return { action: 'update', id: matches[0].id };
}

export function duplicatePlansMessage(name, count) {
  return `${count} floor plans named “${name}” in this network: rename one in Dashboard.`;
}
