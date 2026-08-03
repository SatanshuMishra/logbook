const CRITERION_ID = /^c([1-9][0-9]*)$/;

export function nextCriterionId(criteria) {
  const source = Array.isArray(criteria) ? criteria : [];
  const highest = source.reduce((max, item) => {
    const id = item && typeof item.id === 'string' ? item.id : '';
    const match = CRITERION_ID.exec(id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `c${highest + 1}`;
}
