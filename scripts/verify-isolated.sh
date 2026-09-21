#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ "${REVIEWFLOW_ISOLATED_READY:-}" != "1" ]; then
  exec sh scripts/with-isolated-postgres.sh sh scripts/verify-isolated.sh
fi

node scripts/assert-isolated-database.mjs
command -v python3 >/dev/null 2>&1 || {
  echo "Python 3.11+ is required for Trace2Preference validation" >&2
  exit 1
}
PYTHONPATH=python python3 -m unittest discover -s python/tests -v
pnpm install --frozen-lockfile
# The additive-operator regression deliberately creates an incompatible table.
# Run it in a second throwaway cluster, never in this harness's migration target.
REVIEWFLOW_TEST_PGPORT= sh scripts/with-isolated-postgres.sh \
  node lib/db/scripts/enable-traces.test.mjs
pnpm --filter @workspace/db run migrate

# Recreate project-reference declarations rather than accepting stale outputs.
find lib -name '*.tsbuildinfo' -delete
find lib -type d -name dist -prune -exec rm -rf {} +
pnpm run typecheck:libs
pnpm run typecheck
PORT=5190 BASE_PATH=/ pnpm run build
pnpm run test

api_port="${REVIEWFLOW_TEST_API_PORT:-5181}"
worker_port="${REVIEWFLOW_TEST_WORKER_PORT:-5182}"
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/reviewflow-services.XXXXXX")"
api_pid=""
worker_pid=""
cleanup_services() {
  [ -z "$api_pid" ] || kill "$api_pid" >/dev/null 2>&1 || true
  [ -z "$worker_pid" ] || kill "$worker_pid" >/dev/null 2>&1 || true
  rm -rf "$log_dir"
}
trap cleanup_services EXIT HUP INT TERM

APP_MODE=demo LIVE_INFERENCE_ENABLED=false TRUSTED_ORIGINS=http://localhost:8080 \
  DEMO_PROJECT_CREATION_WINDOW_MAX=100 \
  SESSION_SECRET=isolated-verification-session-secret PORT="$api_port" \
  node --enable-source-maps artifacts/api-server/dist/index.mjs >"$log_dir/api.log" 2>&1 &
api_pid=$!
APP_MODE=demo LIVE_INFERENCE_ENABLED=false \
  SESSION_SECRET=isolated-verification-session-secret WORKER_PORT="$worker_port" \
  node --enable-source-maps artifacts/api-server/dist/worker.mjs >"$log_dir/worker.log" 2>&1 &
worker_pid=$!

node -e '
const url = process.argv[1];
const end = Date.now() + 10000;
while (Date.now() < end) {
  try { const r = await fetch(url); if (r.ok) process.exit(0); } catch {}
  await new Promise(r => setTimeout(r, 100));
}
throw new Error("API did not become ready");
' "http://127.0.0.1:$api_port/api/healthz"

REVIEWFLOW_E2E_ISOLATED=1 REVIEWFLOW_E2E_ORIGIN=http://localhost:8080 \
  REVIEWFLOW_BASE_URL="http://127.0.0.1:$api_port/api" \
  node scripts/reviewflow-e2e.mjs
REVIEWFLOW_E2E_ISOLATED=1 REVIEWFLOW_E2E_ORIGIN=http://localhost:8080 \
  REVIEWFLOW_BASE_URL="http://127.0.0.1:$api_port/api" \
  node scripts/trace-e2e.mjs