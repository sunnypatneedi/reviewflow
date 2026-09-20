# Security and provider behavior

- `TYPESAFE_API_KEY` is server-only and is never returned by the credential-status endpoint.
- Live task content is sent only after authenticated owner consent.
- Demo mode never makes paid requests.
- Live failures never substitute deterministic demo output.
- Evaluation jobs retry only transient provider failures. `401`, other invalid requests, malformed JSON, and invalid typed responses are terminal; `429` and `529` respect `Retry-After`, while transient `5xx` and network failures use bounded backoff.
- The pinned request model is `jev-1.13.0`; the provider's actual returned model ID is preserved.
- Choice probabilities must be finite, within `[0,1]`, and sum to approximately one.
- Noul is read from `noul`, not from a confidence field.
- Score is an anchored ordered level index; it is not normalized to `[0,1]`.
- Jev returns typed judgments, not generated rationales or evidence quotations. Routing explanations are deterministic ReviewFlow policy reasons.
- Human corrections are stored for evaluation, policy calibration, and dataset export. They do not fine-tune Jev.
- Imported links are never fetched and embedded text instructions are never executed.
- Source-text export is an explicit release option and the interface warns before enabling it.
