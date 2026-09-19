# ReviewFlow

ReviewFlow is an AI-assisted, human-controlled data-labeling platform for evidence-grounded response review. It imports text tasks, records typed model proposals, routes every item to a human, supports correction or escalation, and publishes immutable JSONL releases with provenance.

ReviewFlow integrates with Jev from TypeSafe.ai. Jev is a hosted product; this repository does **not** claim that Jev is open source. Original ReviewFlow code is licensed under MIT.

## Core workflow

1. Import JSON/JSONL tasks or use the isolated synthetic demo.
2. Run the deterministic Demo Simulator, or explicitly consent to a bounded live Jev batch.
3. Review a proposal. Accept it, correct it with a reason, or escalate it.
4. Resolve all required human work.
5. Create an immutable release and download its JSONL payload.

The simulator is intentionally imperfect and every simulated proposal, metric, and export is marked as such. Live failures remain visible and never fall back to simulated output.

## Provider contract

Live evaluation uses `POST https://api.typesafe.ai/v1/systemone`, bearer authentication, and the pinned request model `jev-1.13.0`. ReviewFlow preserves the returned model version. It asks:

- one `Choice` for `supported`, `contradicted`, or `insufficient_evidence`;
- one `Noul` for attempted evaluator redirection;
- one anchored `Score` for review complexity.

Evidence is sent as untrusted state. Rubric instructions are separate. Reference labels and prior reviews are not included. ReviewFlow validates typed answers and probability distributions. See [TypeSafe API docs](https://docs.typesafe.ai/api) and [model docs](https://docs.typesafe.ai/models).

## Portable setup

Requirements: Node.js 24, pnpm 10, and PostgreSQL.

```bash
pnpm install
export DATABASE_URL='postgresql://...'
export SESSION_SECRET='replace-with-a-long-random-value'
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
```

Run the API and web packages using separate processes with their required `PORT` and `BASE_PATH` variables:

```bash
PORT=5000 pnpm --filter @workspace/api-server run dev
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/reviewflow run dev
```

Authentication uses Clerk. On Replit, Clerk keys and proxy configuration are provisioned by the managed Auth integration. For a portable environment, configure equivalent Clerk server and Vite publishable-key variables. Anonymous users can use only isolated synthetic demo data.

Live Jev mode additionally requires server-only `TYPESAFE_API_KEY`. Never expose it through `VITE_*`, browser code, logs, or exports.

## Verification

```bash
pnpm run typecheck
node scripts/reviewflow-e2e.mjs
```

The end-to-end script exercises isolated bootstrap, idempotent import, conflicting reimport rejection, deterministic demo evaluation, human correction, and stale review rejection against the running preview proxy.

Live connectivity and judgment quality are not tested without a provider key.

## Documentation

- [Architecture and tradeoffs](docs/architecture.md)
- [Security and provider behavior](docs/security-and-provider.md)
- OpenAPI contract: `lib/api-spec/openapi.yaml`
