# Local hardening and remaining production gates

This follow-up is developed separately from the reviewed source/synthetic showcase at `f9e39b5`. The running local preview and that worktree remain unchanged. Local tests below establish bounded prototype behavior; they do not qualify a hosted multi-tenant service, real identity sessions, a provider or a production recovery plan.

## Implemented local controls

| Area | Local implementation and verification | Remaining qualification |
|---|---|---|
| Authentication | Clerk-mode review endpoints require a signed-in identity before parsing or project provisioning, with a second guard in project resolution. Authenticated accounts receive no demo cookie. Clerk authorized parties use configured origins and the configured publishable key. Synthetic signed-out/forged-header tests prove the application boundary refuses access without seeding data. | Real Clerk login, identity mapping, logout, expiry, session revocation, multiple devices/accounts and production cookie behavior. Synthetic authentication is not JWT/provider verification. |
| Production configuration | Production refuses demo mode, missing/short/known-placeholder session secrets and missing/non-HTTPS explicit trusted origins. Managed-host environment values do not expand production origins. | A real random secret and its rotation procedure; valid Clerk keys; approved region, origin and TLS/proxy topology. |
| Network exposure | API, worker, local proxy and Vite default to loopback. Non-loopback IPs require explicit `REVIEWFLOW_PUBLIC_LISTEN=true`; hostnames and ambiguous values are rejected. Vite's wildcard CLI overrides are removed. | External binding is an operator decision, not a launch approval. A real reverse proxy must validate hosts and forward WebSocket traffic securely; do not use Vite as a production server. |
| Abuse/resources | Socket-derived per-IP budgets default to 600 requests/minute, with bounded storage. Forged forwarded IPs cannot create new identities. At most 32 open HTTP responses are admitted concurrently; completion/abort releases capacity. Independently admitted work may finish after disconnect; expensive background work needs its own budgets. Health probes are cheap/coalesced and bypass request admission. Existing job, provider-call and WebSocket budgets remain. | Rate state and HTTP-response admission are per API process; this is not a complete background-work scheduler. Proxy/NAT aggregation, distributed limits, per-account quotas, edge connection/body limits, sustained attack load and alerting need deployment-specific decisions. |
| Privacy | API errors use generic JSON for parser/internal failures; no stack, SQL or input values. Requests receive server-generated correlation IDs. Logs use fixed route groups rather than raw IDs, paths, query strings, headers or bodies. API responses disable caching/sniffing/referrer disclosure. | Review actual ingress/CDN, SDK, database and third-party logging, retention, deletion, access and export policies. A finite scan does not certify private data absence. |
| Optional Clerk proxy | Off unless an explicit trusted HTTPS `CLERK_PROXY_ORIGIN` is configured. Its public URL never comes from forwarded Host/Proto. Client IP derives from the socket. Unknown-length responses have a 2 MB buffer cap and upstream timeout. Tests use a separate loopback-only fake upstream and a synthetic key. | Real Clerk proxy compatibility and uploads/assets, HTTPS edge behavior and login flows. No Clerk network request or credentials were used in this verification. |
| Readiness | `/api/healthz` is liveness. `/api/readyz` checks required tables and critical columns with bounded query/acquisition, coalesces parallel probes and caches for 500 ms. Failures/draining return generic 503. Idle database connection loss does not crash the API. | Integrate actual health checks, alarms and a deployment controller; verify schema/version compatibility and existing production data before migration. |
| Worker reliability | Database-poll failures mark worker readiness unavailable and retry with 0.5–5 s bounded backoff. Stop interrupts waiting; `/readyz` reflects recent successful queue work. No paid-provider retry policy was expanded. | Supervisor restart policy, real queue lag/terminal-failure alerts and provider behavior. Worker readiness is queue polling health, not data/model quality. |
| Recovery | An owned fresh-cluster rehearsal verifies readiness rejects a temporarily missing jobs table, crashes/restarts PostgreSQL, observes API and worker unavailable/healthy transitions, checks frozen release bytes/digest and shared notes, keeps the signed demo session over an API restart, and resumes a persisted synthetic job. API/worker shutdown is exercised. | This is local WAL/crash recovery, **not backup restoration**, point-in-time recovery, high availability or an RPO/RTO promise. Backup tooling/storage/encryption/restore targets and operators must be selected and tested. |
| Load | A bounded single-process run sends 120 reads through 12 clients and records actual local p50/p95. Separate excess traffic verifies rate rejection; health remains available. Unit tests cover concurrency rejection/abort release. | Production traffic mix, long-running edits/uploads, multiple processes/regions, resource ceilings and adversarial load. Local observations are not capacity guarantees. |

Clerk's documented middleware provides auth state; route protection still requires an explicit check. See the [Clerk Express middleware reference](https://clerk.com/docs/reference/express/clerk-middleware). Express also warns that forwarded headers require an explicitly trusted proxy topology; this prototype does not infer client IP from those headers. See [Express behind proxies](https://expressjs.com/en/5x/guide/behind-proxies/).

## Safe local reproduction

With the documented Node 24/pnpm/Python/PostgreSQL tools:

```sh
pnpm install --frozen-lockfile
pnpm run verify:isolated
pnpm run test:browser
```

The full harness now includes the operations rehearsal. To repeat only that rehearsal after building the API:

```sh
pnpm --filter @workspace/api-server run build
pnpm run test:ops
```

`test:ops` always creates another fresh loopback cluster, including in CI. The script requires the disposable/owned-cluster acknowledgements and validates the temporary data directory, postmaster port, socket and loopback database URL before invoking `pg_ctl`. The child API and worker confirm listener ownership over local IPC before HTTP mutations. Synthetic provider-disabled environments are used. Children are stopped and the owned cluster is removed on completion; do not repoint this harness at valuable data. Logs live outside source under a temporary `reviewflow-ops-*` directory. Test labels and timing inputs are scripted.

For the eventual deployment, `REVIEWFLOW_HOST` defaults to `127.0.0.1`; `REVIEWFLOW_PUBLIC_LISTEN` defaults false. The explicit public flag does not configure TLS, identity or network policy. `API_REQUESTS_PER_MINUTE` defaults 600 and should be chosen with the real proxy/NAT layout. Database acquisition has a 2-second timeout and readiness query reads have a 500 ms timeout; pool behavior and scheduling affect the observed end-to-end response time. An authentication outage must not be interpreted as permission to run in demo mode. Do not put server secrets into frontend variables.

The optional Clerk proxy requires a trusted canonical HTTPS origin and explicit configuration. The normal direct Clerk integration remains a separate path. Neither is live-qualified by a loopback fixture.

## Decisions and external prerequisites

- **Credentials/accounts:** operator-provided Clerk development/staging configuration and separate real accounts are needed to test valid/expired/revoked sessions. This work did not create accounts or persistent credentials.
- **Paid calls:** a separately authorized, bounded Jev study with reviewed outbound synthetic text, a frozen independent reference set and a real currency/call budget is needed before speed or quality claims. No model calls were made here.
- **User/operator decisions:** choose permitted data and regions, retention/deletion behavior, backup encryption/storage, recovery objectives, operational owner, alert destinations, acceptable abuse quotas and response policy. No real data deletion or invitations were performed.
- **Deployment-specific checks:** after separate authorization, test a private staging target's TLS, host/origin handling, cookie/session behavior, WebSocket upgrades, monitoring, restore/rollback and actual resource use. Public deployment is not required to begin staging qualification and has not been authorized or performed here.

The available temporary PostgreSQL runtime has no `pg_dump`/`pg_restore`; no logical backup/restore pass is claimed. Installing suitable tools and choosing a fresh restore target can support a later synthetic rehearsal. No production data was accessed. Separate independent review of the exact new revision is required before promotion; the existing reviewed preview remains on `f9e39b5`.
