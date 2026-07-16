export function serializeRecord(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}
