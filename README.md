# ReviewFlow

ReviewFlow is an **experimental local synthetic demo** of a human-in-the-loop
review workflow: import evidence-grounding tasks, queue deterministic proposals,
accept/correct/escalate them, and export versioned
JSONL releases.

Model proposals are suggestions, not ground truth. Human corrections retain the
reviewer's decision, reason, and provenance; exports preserve those judgments
rather than silently replacing them with a later model result.

![ReviewFlow review queue](screenshots/reviewflow-review.png)

## What is implemented

- TypeScript throughout: React/Vite web UI, Express API and worker
- PostgreSQL persistence through Drizzle ORM
- OpenAPI-derived React Query client and Zod schemas
- A deterministic, intentionally imperfect synthetic evaluator
- Separate leased-job worker and a local same-origin development proxy
- Optional Clerk mode with persisted project roles
- An optional Jev adapter behind explicit server configuration and owner consent

The supported first-run path is `APP_MODE=demo`. It needs neither hosted
authentication nor Jev credentials. See **[local setup](docs/setup.md)**.

## Quick start

With Node 24, pnpm 10.26.1, and PostgreSQL 16 tools (`initdb`, `pg_ctl`,
`createdb`) on your path:

```bash
pnpm install --frozen-lockfile
pnpm run demo:isolated
```

Open `http://localhost:5280`. Select tasks, run **Demo (Simulated)** evaluation,
correct a proposal in **Review**, then create and download a **Release**.
This command uses a temporary database; stopping it discards that demo only.
For a persistent local demo, follow the setup guide.

## Scope

This is a portfolio-quality prototype, not a production service or a claim of
model quality. Clerk/shared-role code is optional and is not a production
security certification. Jev connectivity has not been live-tested for this
release. Trace2Preference and SPEAR are not implemented.

## Documentation

- [Setup and verification commands](docs/setup.md)
- [Configuration variable template](.env.example)
- [Architecture, tradeoffs, and limitations](docs/tradeoffs.md)
- [Executed verification and release status](docs/verification.md)
- [Security policy and operating boundaries](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices and provenance](THIRD_PARTY_NOTICES.md)
- [OpenAPI contract](lib/api-spec/openapi.yaml)

Original ReviewFlow code is available under the [MIT License](LICENSE).
