const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

function skipSingleQuoted(command, start) {
  const end = command.indexOf("'", start);
  return end === -1 ? command.length : end + 1;
}

function skipDoubleQuoted(command, start) {
  let index = start;
  while (index < command.length && command[index] !== '"') {
    if (command[index] === '\\' && DOUBLE_QUOTE_ESCAPES.has(command[index + 1])) {
      index += 2;
      continue;
    }
    index += 1;
  }
  return index < command.length ? index + 1 : index;
}

export function hasUnquotedAmpersand(command) {
  if (typeof command !== 'string') {
    return false;
  }
  let index = 0;
  while (index < command.length) {
    const char = command[index];
    if (char === '\\' && index + 1 < command.length) {
      index += 2;
      continue;
    }
    if (char === "'") {
      index = skipSingleQuoted(command, index + 1);
      continue;
    }
    if (char === '"') {
      index = skipDoubleQuoted(command, index + 1);
      continue;
    }
    if (char === '&') {
      return true;
    }
    index += 1;
  }
  return false;
}
