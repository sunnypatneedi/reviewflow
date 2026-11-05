# Local setup

The documented path is the synthetic demo. It does not require Clerk, a hosted
authentication account, a provider key, or network access after dependencies
are installed.

The repository includes a [configuration-name template](../.env.example).
Processes do not load it automatically: copy the relevant values into each
shell, or source your own local ignored `.env` before starting them. Keep each
process's `PORT` value on its command line as shown below.

## Local prerequisites and first run

Supported native platforms are macOS and Linux. Windows users need a Linux/WSL2
installation; native Windows and Docker/Compose are not currently qualified.
Install these prerequisites using your normal trusted package manager:

- Node.js **24** and pnpm **10.26.1**
- Python **3.11+** (`python3` on `PATH`)
- PostgreSQL **16**, including `initdb`, `pg_ctl`, and `createdb` on `PATH`
- A non-root account, because PostgreSQL refuses to initialize as root

On macOS, PostgreSQL packages may not add their versioned `bin` directory to
`PATH`. For Homebrew PostgreSQL 16, use `$(brew --prefix postgresql@16)/bin`.
On Ubuntu with PostgreSQL 16 installed, the tools are normally in
`/usr/lib/postgresql/16/bin`. Add the appropriate directory to your shell's PATH.
No global PostgreSQL server needs to be running for this demo.

```bash
node scripts/doctor.mjs
pnpm install --frozen-lockfile
pnpm run local:init "$HOME/reviewflow-data"
pnpm run local:start "$HOME/reviewflow-data"
```

Choose a new directory outside the checkout; initialization refuses existing paths.
Run `local:init` once and `local:start` on later visits. Open
`http://127.0.0.1:5280` using the same browser. Data survives Ctrl-C and restart.
Read the [durable workspace guide](local-workspace.md), especially the browser
identity, upgrade and backup limitations. No automated schema upgrade or
account-recovery guarantee is implied.

## Disposable trial

For a fresh trial whose records should be discarded, run `pnpm run demo:isolated`.
Open `http://localhost:5280`. This launcher starts its own loopback database,
API, evaluation worker, web UI and proxy, and checks owned-service readiness.
It refuses occupied ports 5280–5283 and concurrent demo starts rather than
stopping an existing process. Live inference and inherited credentials are
disabled. Press Ctrl-C in its terminal to stop.

**All demo data is deleted when this command stops.** Export anything you need
before quitting. This is a disposable trial, not durable local storage. The
manual development instructions below are not the managed local workspace path.
Do not put valuable data into the disposable migration path.

If a hard crash leaves a launch-lock directory, the error prints its path.
Verify that no demo remains running before removing that lock yourself; the
launcher never guesses whether an existing process or directory is safe to kill.

## Manual development setup (advanced)

The following path requires a running PostgreSQL server and administration
access, unlike the recommended self-contained temporary demo.

## Install and create a disposable database

```bash
pnpm install --frozen-lockfile
createdb reviewflow_dev

export DATABASE_URL='postgresql://localhost/reviewflow_dev'
export REVIEWFLOW_MIGRATION_DATABASE_URL="$DATABASE_URL"
export REVIEWFLOW_MIGRATION_CONFIRM='reviewflow_dev'
export REVIEWFLOW_DISPOSABLE_DB='1'
pnpm run db:migrate
```

Adjust the local PostgreSQL URL for your local user and authentication method.
Do not commit it.

The migration command deliberately ignores `DATABASE_URL` and uses only
`REVIEWFLOW_MIGRATION_DATABASE_URL`. It also requires:

1. the explicit disposable-database acknowledgement;
2. an exact database-name confirmation; and
3. a name beginning with `reviewflow_dev`, `reviewflow_demo`,
   `reviewflow_test`, or `reviewflow_ci`.

These are guardrails, not proof that a database is empty. Create a **new,
disposable database** and inspect the target yourself. Never aim this runner at
an existing application or user database.

## Explicit additive development enablement

For an **existing development** ReviewFlow database whose original schema is
already present, an operator may review and explicitly run:

```bash
node lib/db/scripts/enable-traces.mjs --confirm-additive-trace-schema
```

This separate opt-in command uses `DATABASE_URL`, refuses production/deployment
mode and missing prerequisite schema, and adds only the trace table/index.
It validates an existing trace table rather than replacing it; incompatible
schemas fail transactionally. It does not seed, migrate existing records, or
run automatically at startup. Review the target and arrange a backup under
your normal operational process first. Do not mark a real working database
disposable to bypass the migration runner.

Regression tests for this command run in a second throwaway PostgreSQL cluster,
including idempotence, preservation of existing synthetic records, and refusal
of an incompatible table. The full verification harness never targets your
working database.

## Run the demo

Build the API once:

```bash
APP_MODE=demo pnpm --filter @workspace/api-server run build
```

Then run four long-lived processes in separate terminals. The API and worker
need the same database.

**API**

```bash
export APP_MODE=demo
export DATABASE_URL='postgresql://localhost/reviewflow_dev'
export SESSION_SECRET='replace-with-a-long-random-local-value'
export TRUSTED_ORIGINS='http://localhost:8080'
PORT=5000 pnpm --filter @workspace/api-server run start
```

**Evaluation worker**

```bash
export APP_MODE=demo
export DATABASE_URL='postgresql://localhost/reviewflow_dev'
WORKER_PORT=5001 pnpm --filter @workspace/api-server run worker
```

**Web UI**

```bash
APP_MODE=demo PORT=5173 BASE_PATH=/ \
  pnpm --filter @workspace/reviewflow run dev
```

**Same-origin proxy**

```bash
PORT=8080 \
REVIEWFLOW_API_ORIGIN='http://127.0.0.1:5000' \
REVIEWFLOW_WEB_ORIGIN='http://127.0.0.1:5173' \
pnpm run dev:proxy
```

Open `http://localhost:8080`. The proxy sends `/api` to Express and everything
else, including Vite's WebSocket, to the web process. The worker must remain
running for queued evaluations to advance.

The **Trace2Preference** navigation entry is separate from the original evidence
labeling pages. Start with its explicitly scripted synthetic sample, or import
your own authorized export using the [trace format](trace-contract.md). The API
invokes the Python package; it is a required runtime component for this workload,
not a replacement for the TypeScript application. Python uses only its standard
library. Run the API from the documented workspace/package scripts so it can
locate the included package.

Demo sessions are separated with a signed HTTP-only cookie. A stable
`SESSION_SECRET` preserves that session across API restarts. Production mode
refuses to start without an explicit secret. New anonymous projects are
database-limited globally by `DEMO_PROJECT_CAP` (default 100) and by
`DEMO_PROJECT_CREATION_WINDOW_MAX` per
`DEMO_PROJECT_CREATION_WINDOW_SECONDS` (defaults 10 per 60 seconds). Admission
is serialized in PostgreSQL, so limits apply across API processes and restarts.
Sessions whose projects already exist remain usable when either limit is hit.
These limits do not apply to authenticated Clerk projects.

## Optional integrations

`APP_MODE=clerk` requires matching Clerk configuration in the API and browser.
Live inference is additionally disabled unless the server explicitly enables
it, has server-only provider credentials, and receives authenticated owner
consent. Do not place secrets in `VITE_*` variables. These optional paths are
not the supported local-demo baseline; see [tradeoffs](tradeoffs.md) and
[security](../SECURITY.md).

## Verification commands

```bash
pnpm run typecheck
APP_MODE=demo PORT=5190 BASE_PATH=/ pnpm run build
pnpm run test
pnpm run verify:isolated
```

Run database-writing tests only against a disposable ReviewFlow database.
`verify:isolated` normally creates a temporary loopback PostgreSQL cluster,
applies committed migrations, installs from the frozen lockfile, typechecks,
builds, runs API tests, starts API and worker processes, and executes the demo
end-to-end script. It removes the temporary cluster and processes on exit.

In CI, the same script may use the explicitly acknowledged disposable
`reviewflow_ci` service instead of creating another cluster. The end-to-end
script refuses non-loopback targets. These are instructions and test scope, not
a statement that any particular revision has passed.
## Listener and operations boundaries

Local services now default to `127.0.0.1`. See [local hardening and production gates](production-readiness.md) before changing listener, identity, proxy or rate settings. `pnpm run test:ops` owns a new disposable database and rehearses crash/restart; it does not back up or restore production data.
