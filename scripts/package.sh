#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f package-lock.json || { echo "Run npm install to generate package-lock.json before packaging." >&2; exit 1; }
rm -f app.zip
# An explicit allowlist prevents local secrets or uploads entering the deployment.
zip -r app.zip package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts src .deployment
