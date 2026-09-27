---
type: "regex"
target: {source: "file", path: "src/config.ts"}
pattern: "HTTP_TIMEOUT_MS = ([0-9]{1,3}|[12][0-9]{3}|3000)\\b"
match: "contains"
---
