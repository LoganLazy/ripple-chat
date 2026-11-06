#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  for ripple_node_dir in "$HOME/.config/nvm/versions/node/v22.23.2/bin" /tmp/node-v22.14.0-linux-x64/bin; do
    if [[ -x "$ripple_node_dir/node" ]]; then export PATH="$ripple_node_dir:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.12 或更高版本。'; exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ "${1:-preview}" == desktop ]]; then exec npm run desktop; fi
npm run build
exec npm run preview
