# Optional benign local SPEAR capture

This exercise uses the existing public
[sunnypatneedi/spear](https://github.com/sunnypatneedi/spear) project at exact
revision `ff300b3f9cfda7cf1f58fea9794d7174447202a6`. It does not modify SPEAR.
SPEAR is **AGPL-3.0-only**, copyright Sunny Patneedi; review its
[license at that revision](https://github.com/sunnypatneedi/spear/blob/ff300b3f9cfda7cf1f58fea9794d7174447202a6/LICENSE).
It is neither vendored nor a dependency of the ReviewFlow server/browser.
The original local interoperability harness is shipped as source. Installing,
combining, distributing, or serving upstream software can carry its own license
obligations; the ReviewFlow MIT license does not replace upstream terms.

## Reproduce

Use a new temporary directory, Node 24, and pnpm 10. Installation fetches
dependencies; the capture itself is local-only and explicitly denies
fetch/HTTP/TCP calls. It never starts a service or uses provider credentials.

```bash
SPEAR_DIR="$(mktemp -d /tmp/reviewflow-spear.XXXXXX)"
git clone https://github.com/sunnypatneedi/spear.git "$SPEAR_DIR"
git -C "$SPEAR_DIR" checkout --detach ff300b3f9cfda7cf1f58fea9794d7174447202a6
(cd "$SPEAR_DIR" && pnpm install --frozen-lockfile --ignore-scripts \
  --registry=https://registry.npmjs.org \
  && pnpm --filter @spear-secure/core run build)
node scripts/spear-capture.mjs "$SPEAR_DIR" > /tmp/reviewflow-spear-capture.json
PYTHONPATH=python python3 -m trace2preference validate \
  < /tmp/reviewflow-spear-capture.json > /tmp/reviewflow-spear-validated.json
```

Import the capture JSON into Trace2Preference. Do not import the validator's
output as a new fabricated run. The harness checks exact upstream HEAD and
refuses modified tracked source. It records only timestamps actually generated
by executing the local harness/middleware; repeated runs naturally differ.
Use the captured artifact and its checksum, not rerun timestamps, to reproduce
a particular dataset release.

## What the capture proves—and does not

- A local guard executes on an inert benign marker task and two actual
  deterministic responders consume one identical captured context.
- The guard also executes an inert prompt-injection-pattern check. No exploit,
  external target, shell tool, or network operation is performed.
- The two responses are **scripted**, not model-generated. Eligibility proves
  captured context equality, not response quality or useful training value.
- Middleware telemetry retains its observed source order. A separate
  telemetry-only record has no claimed model context or response and remains
  incomplete/ineligible.
- No simulated or real human preference is manufactured. Human review and
  quality/privacy checks are still required before training export.
- No production traces, independent audits, live Jev results, accuracy, or
  benchmark wins are claimed.

The presence of this harness is not proof it has been executed. Consult the
current [verification record](verification.md) for the actual run result.