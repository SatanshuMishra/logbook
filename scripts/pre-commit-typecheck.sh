#!/usr/bin/env bash
set -euo pipefail

if ! npm run rebuild:typecheck; then
  echo "pre-commit-typecheck: rebuild/tsconfig.json type check failed, commit blocked" >&2
  exit 1
fi
