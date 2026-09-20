# Local setup

The documented path is the synthetic demo. It does not require Clerk, a hosted
authentication account, a provider key, or network access after dependencies
are installed.

The repository includes a [configuration-name template](../.env.example).
Processes do not load it automatically: copy the relevant values into each
shell, or source your own local ignored `.env` before starting them. Keep each
process's `PORT` value on its command line as shown below.

## Requirements

- Node.js 24
- pnpm 10
- PostgreSQL 16 (the SQL may work on nearby versions, but they are not the
  repository's configured baseline)
- `createdb` or equivalent PostgreSQL administration access
- `initdb` and `pg_ctl` on `PATH` if running the local isolated verification
  harness

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