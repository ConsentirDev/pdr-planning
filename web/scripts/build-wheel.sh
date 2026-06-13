#!/usr/bin/env bash
# Rebuild the pure-Python `pdr` wheel that Pyodide loads in the browser.
# Run this after changing anything in ../pdr/. The wheel is committed so the
# static site works on a fresh clone without a Python build step.
set -euo pipefail
cd "$(dirname "$0")/../.."          # repo root
rm -f web/public/wheels/*.whl
pip wheel . --no-deps -w web/public/wheels/
echo "wheel rebuilt:"
ls -1 web/public/wheels/*.whl
