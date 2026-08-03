export const ULID_PATTERN = '^[0-9A-HJKMNP-TV-Z]{26}$';

export const ISO_TIMESTAMP_PATTERN =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}';

export const CRITERION_ID_PATTERN = '^c[1-9][0-9]*$';

export const DECISION_REF_PATTERN = '^[0-9]{4}-[a-z0-9-]+$';

export const CRITERION_KINDS = Object.freeze(['planned', 'detour']);

export const CRITERION_TEXT_MAX_CHARS = 200;

export const THREAD_SCOPE = 'thread';

export const LEGACY_SCOPE = 'legacy';

export const SCOPE_PATTERN = '^(c[1-9][0-9]*|thread|legacy)$';

export const WRITABLE_SCOPE_PATTERN = '^(c[1-9][0-9]*|thread)$';
