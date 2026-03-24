#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[neptune-inspector-h5] installing dependencies"
npm ci

echo "[neptune-inspector-h5] building desktop assets"
rm -rf dist
npm run build -- --base ./

if [[ ! -f dist/index.html ]]; then
  echo "[neptune-inspector-h5] expected dist/index.html after build" >&2
  exit 1
fi

echo "[neptune-inspector-h5] desktop asset bundle ready at $ROOT_DIR/dist"
