export function isoNow(now) {
  if (typeof now === 'function') {
    const value = now();
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError('isoNow: now() must return a non-empty ISO string');
    }
    return value;
  }
  if (typeof now === 'string' && now.length > 0) {
    return now;
  }
  return new Date().toISOString();
}
