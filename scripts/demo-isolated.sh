#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ "${REVIEWFLOW_ISOLATED_READY:-}" != "1" ]; then
  exec sh scripts/with-isolated-postgres.sh sh scripts/demo-isolated.sh
fi

api_port=5281
worker_port=5282
web_port=5283
proxy_port=5280
trusted_origins="http://127.0.0.1:$proxy_port,http://localhost:$proxy_port"
pid_file="${REVIEWFLOW_DEMO_PID_FILE:-/tmp/reviewflow-isolated-demo.pid}"

api_pid=""
worker_pid=""
web_pid=""
proxy_pid=""
cleanup() {
  for pid in "$proxy_pid" "$web_pid" "$worker_pid" "$api_pid"; do
    [ -z "$pid" ] || kill -TERM -- "-$pid" >/dev/null 2>&1 || true
  done
  rm -f "$pid_file"
}
trap cleanup EXIT HUP INT TERM

printf '%s\n' "$$" >"$pid_file"
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-server run build

APP_MODE=demo LIVE_INFERENCE_ENABLED=false TRUSTED_ORIGINS="$trusted_origins" \
  SESSION_SECRET=isolated-preview-session-secret PORT="$api_port" \
  setsid node --enable-source-maps artifacts/api-server/dist/index.mjs &
api_pid=$!

APP_MODE=demo LIVE_INFERENCE_ENABLED=false \
  SESSION_SECRET=isolated-preview-session-secret WORKER_PORT="$worker_port" \
  setsid node --enable-source-maps artifacts/api-server/dist/worker.mjs &
worker_pid=$!

APP_MODE=demo PORT="$web_port" BASE_PATH=/ \
  setsid pnpm --filter @workspace/reviewflow run dev &
web_pid=$!

PORT="$proxy_port" REVIEWFLOW_API_ORIGIN="http://127.0.0.1:$api_port" \
  REVIEWFLOW_WEB_ORIGIN="http://127.0.0.1:$web_port" \
  setsid node scripts/same-origin-proxy.mjs &
proxy_pid=$!

node -e '
const targets = process.argv.slice(1);
const deadline = Date.now() + 30000;
for (const target of targets) {
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Isolated preview did not become ready: ${target}`);
}
' "http://127.0.0.1:$proxy_port/api/healthz" "http://127.0.0.1:$proxy_port/"

echo "Isolated ReviewFlow preview ready at http://localhost:$proxy_port"
echo "Demo controller PID: $$"
echo "Stop with: kill \$(cat $pid_file)"

wait