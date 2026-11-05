# Durable local workspace

ReviewFlow can run as a single-user, local-only application with a private PostgreSQL database that survives restarts. No hosted account, Clerk setup, provider key, or paid inference is required. Evaluations use the deterministic demo provider; this is not evidence of live-model quality and does not enable hosted/team access.

## Install and start

First follow [setup](setup.md) to install the documented prerequisites and project dependencies. Run `pnpm run doctor`. The launcher never installs software or connects to an ambient `DATABASE_URL`.

Choose a **new** absolute directory under an existing, canonical parent directory you own. Do not choose an existing directory, symlink, synced folder, or shared network directory. For example, if `/Users/alex` exists:

```sh
pnpm run local:init /Users/alex/reviewflow-data
pnpm run local:start /Users/alex/reviewflow-data
```

On Linux use your own absolute home path instead. Initialization creates the directory exclusively, initializes a private PostgreSQL 16 cluster, creates a new database and applies the committed schema once. The database becomes durable only after initialization completes. Later starts never run the disposable migrator.

Open the exact URL printed after readiness: **http://127.0.0.1:5280**. Use the same browser and hostname on subsequent visits to keep the browser session. Ctrl-C stops the app, worker, proxy and database while retaining records, release snapshots and the signing secret. Run the same `local:start` command to continue. Ports 5280–5283 must be free; the launcher never kills an existing listener.

## What persists and what does not

The workspace contains `data/` (PostgreSQL), a path/cluster/schema-bound `manifest.json`, private `session-secret` and `database-password` files, and `postgres.log`. Keep the entire directory private. Credentials are generated locally, stored with owner-only permissions and never printed. PostgreSQL listens only on loopback using password authentication; application listeners are also loopback-only.

Projects, imported tasks, reviews, evaluations, audit records and release bytes are stored in PostgreSQL. The browser cookie identifies the local demo project; the persistent signing secret keeps an existing valid cookie usable across app restarts. Clearing cookies, changing browsers/hostnames, or cookie expiration can create a different project. This first local release does not include a project-account recovery UI or multi-user authentication. Export needed releases before clearing browser data. Do not treat local demo sessions as a production access-control boundary.

Metrics dashboard data backed by the database persists; in-process counters, logs and current uptime reset. API and web build outputs remain in the source checkout, not in the data directory. No live provider credentials are imported from your shell.

## Safety, upgrades and interrupted launches

- Existing directories are never initialized, reset or deleted by these commands, even when empty.
- The canonical workspace path, database identity, PostgreSQL cluster identifier and full committed migration inventory are checked. Do not move/rename a workspace or edit its manifest/secrets to bypass those checks.
- If migrations differ after updating the source, startup refuses with an upgrade-required message. Automated durable-schema upgrades are intentionally **not implemented**. Keep the matching source release and preserve an offline backup; do not run `db:migrate`, `push`, or `push-force` against a durable workspace.
- An initialization interrupted before the ready manifest is written remains incomplete and is refused on restart. Keep the directory unchanged for diagnosis/manual recovery. Initialization will not silently retry, recreate or wipe it. A fresh new directory is a separate empty workspace, not recovery of the old one.
- `running.lock` prevents duplicate launches. After an ungraceful terminal/process crash, first check whether any app/worker processes or the PostgreSQL process recorded in `data/postmaster.pid` still run. Stop only those verified workspace processes. Once all have stopped, you may manually remove the **empty `running.lock` directory only** and retry `local:start`. Never delete `data/`, the manifest, password or signing secret to clear a lock. If unsure, preserve everything and request assistance.
- A failed database shutdown retains the lock and durable data. There is no automatic stale-lock takeover or destructive reset command.

Make backups only while the workspace is fully stopped, and preserve the entire directory and permissions. Keep the original path and matching source release documented. Backup/restore, workspace relocation, schema upgrade and browser identity recovery are not yet automated; do not assume copying a running PostgreSQL directory produces a valid backup.

## Verification

```sh
node --test scripts/local-workspace.test.mjs
node scripts/local-workspace-smoke.mjs
```

The smoke requires the installed prerequisites and free ports 5280–5283. It creates only a uniquely named temporary workspace, imports synthetic data, evaluates/reviews it, generates a release, restarts the actual app and verifies the same browser cookie, task records and release bytes. It checks duplicate-launch refusal, cleanup after failure and signal shutdown. It removes only its own temporary resources, and retains them if PostgreSQL may still be running. No existing user workspace is opened.
