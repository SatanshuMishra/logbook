#!/bin/bash
set -euo pipefail

git init --quiet --initial-branch=main .
git config user.name 'Logbook Eval Fixture'
git config user.email 'eval@logbook.test'
printf 'a repository for the preflight seam eval\n' > README.md
git add README.md
git commit --quiet -m 'fixture: initial commit'
