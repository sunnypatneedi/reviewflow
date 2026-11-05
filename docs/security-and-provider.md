# Security and provider behavior

- `TYPESAFE_API_KEY` is server-only and is never returned by the credential-status endpoint.
- Live task content is sent only after authenticated owner consent.
- Demo mode never makes paid requests.
- Live failures never substitute deterministic demo output.
- Evaluation jobs retry only transient provider failures. `401`, other invalid requests, malformed JSON, and invalid typed responses are terminal; `429` and `529` respect `Retry-After`, while transient `5xx` and network failures use bounded backoff.
- The pinned request model is `jev-1.13.0`; the provider's actual returned model ID is preserved.
- Choice probabilities must be finite, within `[0,1]`, and sum to approximately one.
- Noul is read from `noul`, not from a confidence field.
- Native Jev Score is a probability-weighted **fractional** index, starting at zero: five rubric levels return `[0,4]`. ReviewFlow explicitly maps this to its existing complexity scale with `complexity = score + 1` (`[1,5]`), without rounding. The UI labels that scale; routing's complexity threshold of 4 means native level 3. Native score, distribution, confidence, and legend remain in the evidence proposal's raw response. Choice confidence describes distribution concentration, not measured accuracy.
- Migration `0006_fractional_complexity` widens the stored complexity to `real` and preserves historical numeric values. Older live rows cannot be reliably reinterpreted automatically because the old adapter treated native values as 1–5; consult their raw responses for historical comparisons. Demo values already used 1–5.
- Both adapters bound response bodies to 64 KB, validate complete Choice distributions, require the selected option to have maximal probability, validate confidence and returned model, and preserve the actual returned model. The evidence adapter additionally checks finite Noul, fractional Score bounds, its distribution and weighted mean. Optional token counts are nonnegative safe integers when provided.
- Contract references verified 2026-11-05: [Score](https://docs.typesafe.ai/primitives/score), [Choice](https://docs.typesafe.ai/primitives/choice), [Noul](https://docs.typesafe.ai/primitives/noul). Tests use mocked transport, not paid provider requests.
- Current evaluation deduplication is `(taskId, mode)`, not a versioned task/question/context/model/run identity. It prevents duplicate execution but is **not** a reproducible experiment registry: changing a rubric or model does not create a distinct evaluation run. That remains a design gap, not a completed capability.
- Jev returns typed judgments, not generated rationales or evidence quotations. Routing explanations are deterministic ReviewFlow policy reasons.
- Human corrections are stored for evaluation, policy calibration, and dataset export. They do not fine-tune Jev.
- Imported links are never fetched and embedded text instructions are never executed.
- Source-text export is an explicit release option and the interface warns before enabling it.
