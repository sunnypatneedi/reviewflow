#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "${REVIEWFLOW_ISOLATED_READY:-}" != "1" ]; then
  exec sh scripts/with-isolated-postgres.sh sh scripts/browser-isolated.sh
fi
node scripts/assert-isolated-database.mjs
pnpm --filter @workspace/db run migrate
logs="$(mktemp -d "${TMPDIR:-/tmp}/reviewflow-browser.XXXXXX")"
REVIEWFLOW_BROWSER_SYNTHETIC=1 node --import ./artifacts/api-server/node_modules/tsx/dist/loader.mjs scripts/browser-server.mjs >"$logs/api.log" 2>&1 &
api_pid=$!
APP_MODE=demo PORT=5293 BASE_PATH=/ node artifacts/reviewflow/node_modules/vite/bin/vite.js --config artifacts/reviewflow/vite.config.ts --host 127.0.0.1 >"$logs/web.log" 2>&1 &
web_pid=$!
PORT=5290 REVIEWFLOW_API_ORIGIN=http://127.0.0.1:5291 REVIEWFLOW_WEB_ORIGIN=http://127.0.0.1:5293 node scripts/same-origin-proxy.mjs >"$logs/proxy.log" 2>&1 &
proxy_pid=$!
cleanup() { kill "$api_pid" "$web_pid" "$proxy_pid" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
# Logs intentionally stay outside source for diagnosis.
echo "Synthetic browser logs: $logs"
node scripts/browser-e2e.mjs
