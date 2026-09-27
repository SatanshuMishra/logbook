#!/bin/bash
set -euo pipefail
bundle="$(cd "$(dirname "$0")" && pwd)/fixture.bundle"
git init --quiet --initial-branch=main .
git fetch --quiet --update-head-ok "$bundle" 'refs/heads/*:refs/heads/*' 'refs/logbook/*:refs/logbook/*'
git reset --quiet --hard main
git config user.name 'Payments Fixture'
git config user.email 'fixture@payments.test'
