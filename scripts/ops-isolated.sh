#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Always own a fresh cluster, including when CI already has a disposable service.
if [ "${REVIEWFLOW_OPS_OWN_CLUSTER:-}" != "1" ]; then
  exec env REVIEWFLOW_OPS_OWN_CLUSTER=1 sh scripts/with-isolated-postgres.sh sh scripts/ops-isolated.sh
fi
node scripts/assert-isolated-database.mjs
pnpm --filter @workspace/db run migrate
node scripts/ops-smoke.mjs
