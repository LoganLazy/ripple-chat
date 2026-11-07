#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
# Optional override for the Node.js directory, e.g. RIPPLE_NODE_BIN="$HOME/.nvm/versions/node/v22.23.2/bin".
if [[ -n "${RIPPLE_NODE_BIN:-}" && -x "$RIPPLE_NODE_BIN/node" ]]; then
  export PATH="$RIPPLE_NODE_BIN:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.12 或更高版本。'; exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ "${1:-preview}" == desktop ]]; then exec npm run desktop; fi
npm run build
exec npm run preview
