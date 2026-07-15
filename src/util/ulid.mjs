import { ulid } from 'ulid';

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function newUlid() {
  return ulid();
}

export function isUlid(value) {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}
