#!/usr/bin/env bash
set -euo pipefail

if ! npm run typecheck; then
  echo "pre-commit-typecheck: tsconfig.json type check failed, commit blocked" >&2
  exit 1
fi
