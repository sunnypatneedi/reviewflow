# Security policy

## Project status

ReviewFlow is an experimental local synthetic demo. It is not a production
security product, compliance control, or certified multi-tenant service.
Optional Clerk and shared-role code does not constitute a security
certification.

## Reporting a vulnerability

Please use the repository host's private security-advisory mechanism and
include affected revision, reproduction steps, impact, and any suggested
mitigation. Do not include credentials or real user data. If no private
reporting channel is enabled, contact the repository owner privately and ask
for one before sharing details. There is currently no published response-time
or supported-version SLA.

## Supported operating boundary

The safest demonstrated mode is local `APP_MODE=demo` with synthetic data, a
fresh disposable PostgreSQL database, the API and web UI behind the included
same-origin proxy, and live inference disabled.

Important controls in the implementation include:

- explicit trusted-origin and CSRF-header checks for credentialed writes;
- signed HTTP-only demo-session cookies;
- a required stable session secret in production;
- live inference disabled by default and requiring Clerk authentication,
  owner consent, and server-only provider credentials;
- persisted project roles on current shared workflows;
- lease fencing, bounded retries, stale-review rejection, and transactional
  writes; and
- a migration runner that ignores ambient `DATABASE_URL` and requires a
  disposable-database name and explicit confirmation.

The database-name guard cannot detect whether a matching database contains
valuable data. Operators must create a fresh database and verify the target.

## Known limitations

- Demo cookies isolate browser sessions but do not establish human identity.
- Shared Clerk mode has not received an independent penetration test, security
  audit, or production certification.
- Deployment hardening, TLS termination, secret rotation, backups, disaster
  recovery, rate limiting, abuse controls, retention policy, and monitoring are
  operator responsibilities and are not demonstrated by this repository.
- Live Jev connectivity and provider behavior are not claimed as tested.
- Imported text is treated as untrusted and imported links are not fetched,
  but exported source text can still contain sensitive input supplied by an
  operator.
- Dependency metadata contains unresolved license/provenance items listed in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Never expose session secrets or provider keys to browser variables, logs,
exports, screenshots, issues, or commits. Use synthetic data for evaluation
unless a separately reviewed deployment has appropriate authorization and data
governance.