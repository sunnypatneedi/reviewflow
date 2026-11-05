# ReviewFlow

AI-assisted evidence-grounded data labeling with typed proposals, human review, escalation, and immutable JSONL releases.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/reviewflow run dev` — run the ReviewFlow web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional server-only env: `TYPESAFE_API_KEY` — enables explicitly consented live Jev evaluation

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/reviewflow` — React interface
- `artifacts/api-server/src/routes/reviewflow.ts` — core API and Jev adapter
- `lib/api-spec/openapi.yaml` — source-of-truth contract
- `lib/db/src/schema/reviewflow.ts` — persistence schema
- `docs/` — architecture and security notes

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Validated JSON/JSONL import, synthetic demo data, deterministic simulator, live Jev mode
- Human accept/correct/escalate loop with optimistic concurrency
- Immutable proposals, reviews, events, and release exports

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
