#!/bin/sh
set -eu

for tool in initdb pg_ctl createdb; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "$tool is required for local isolated verification" >&2
    exit 1
  }
done

cluster="$(mktemp -d "${TMPDIR:-/tmp}/reviewflow-pg.XXXXXX")"
socket_dir="$cluster/socket"
data_dir="$cluster/data"
mkdir -p "$socket_dir"
port="${REVIEWFLOW_TEST_PGPORT:-$(
  node -e 'const n=require("node:net").createServer();n.listen(0,"127.0.0.1",()=>{console.log(n.address().port);n.close()})'
)}"

cleanup() {
  pg_ctl -D "$data_dir" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT HUP INT TERM

initdb -D "$data_dir" --username=reviewflow_test_admin --auth-local=trust --auth-host=trust --no-instructions >/dev/null
pg_ctl -D "$data_dir" -o "-h 127.0.0.1 -p $port -k $socket_dir" -w start >/dev/null
createdb -h 127.0.0.1 -p "$port" -U reviewflow_test_admin reviewflow_test_isolated

isolated_url="postgresql://reviewflow_test_admin@127.0.0.1:$port/reviewflow_test_isolated"
export DATABASE_URL="$isolated_url"
export REVIEWFLOW_MIGRATION_DATABASE_URL="$isolated_url"
export REVIEWFLOW_MIGRATION_CONFIRM=reviewflow_test_isolated
export REVIEWFLOW_DISPOSABLE_DB=1
export REVIEWFLOW_ISOLATED_READY=1

echo "Started disposable PostgreSQL cluster (database reviewflow_test_isolated)"
"$@"