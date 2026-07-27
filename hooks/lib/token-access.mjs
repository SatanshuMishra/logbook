export function tokenList(tokens) {
  return Array.isArray(tokens) ? tokens : [];
}

export function tokenText(token) {
  return token && typeof token.text === 'string' ? token.text : '';
}
