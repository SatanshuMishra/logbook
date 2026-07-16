export function branchSlug(branch) {
  if (typeof branch !== 'string' || branch.trim().length === 0) {
    throw new TypeError('branchSlug: branch must be a non-empty string');
  }
  return branch.trim().replace(/\//g, '-');
}
