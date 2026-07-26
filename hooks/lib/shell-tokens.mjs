const SEPARATORS = ['&&', '||', ';', '\n', '|'];
const WORD_START_REDIRECT = /^(?:\d*&?)?>{1,2}\|?/;
const MID_WORD_REDIRECT = /^>{1,2}\|?/;
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);
const EXPANSIONS = new Set(['$', '`']);
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

function readSingleQuoted(command, start) {
  const end = command.indexOf("'", start);
  const stop = end === -1 ? command.length : end;
  return { text: command.slice(start, stop), expands: false, next: end === -1 ? stop : stop + 1 };
}

function readDoubleQuoted(command, start) {
  const parts = [];
  let expands = false;
  let index = start;
  while (index < command.length && command[index] !== '"') {
    const char = command[index];
    if (char === '\\' && DOUBLE_QUOTE_ESCAPES.has(command[index + 1])) {
      parts.push(command[index + 1]);
      index += 2;
      continue;
    }
    if (EXPANSIONS.has(char)) {
      expands = true;
    }
    parts.push(char);
    index += 1;
  }
  return {
    text: parts.join(''),
    expands,
    next: index < command.length ? index + 1 : index,
  };
}

function matchRedirect(command, index, midWord) {
  const char = command[index];
  if (char !== '>' && (midWord || (char !== '&' && !DIGIT.test(char)))) {
    return null;
  }
  const pattern = midWord ? MID_WORD_REDIRECT : WORD_START_REDIRECT;
  const match = pattern.exec(command.slice(index));
  return match ? match[0] : null;
}

export function scanSegments(command) {
  if (typeof command !== 'string') {
    return [];
  }
  const segments = [];
  let tokens = [];
  let chunks = [];
  let unresolvable = false;
  let open = false;
  let index = 0;

  const closeToken = () => {
    if (!open) {
      return;
    }
    tokens = [...tokens, { kind: 'word', text: chunks.join(''), unresolvable }];
    chunks = [];
    unresolvable = false;
    open = false;
  };

  const pushOperator = (kind, text) => {
    closeToken();
    tokens = [...tokens, { kind, text, unresolvable: false }];
  };

  const closeSegment = () => {
    closeToken();
    if (tokens.length > 0) {
      segments.push(tokens);
    }
    tokens = [];
  };

  while (index < command.length) {
    const char = command[index];
    if (char === '\\' && index + 1 < command.length) {
      chunks.push(command[index + 1]);
      open = true;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quoted = char === "'"
        ? readSingleQuoted(command, index + 1)
        : readDoubleQuoted(command, index + 1);
      chunks.push(quoted.text);
      unresolvable = unresolvable || quoted.expands;
      open = true;
      index = quoted.next;
      continue;
    }
    const redirect = matchRedirect(command, index, open);
    if (redirect) {
      pushOperator('redirect', redirect);
      index += redirect.length;
      continue;
    }
    if (char === '<') {
      pushOperator('operator', char);
      index += 1;
      continue;
    }
    const separator = SEPARATORS.find((candidate) => command.startsWith(candidate, index));
    if (separator) {
      closeSegment();
      index += separator.length;
      continue;
    }
    if (WHITESPACE.test(char)) {
      closeToken();
      index += 1;
      continue;
    }
    chunks.push(char);
    open = true;
    index += 1;
  }
  closeSegment();
  return segments;
}
