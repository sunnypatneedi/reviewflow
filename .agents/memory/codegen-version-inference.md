---
name: Codegen version inference
description: Why Orval needs explicit consumer major versions in this workspace.
---

Keep Orval's target runtime versions explicit when the generator package does not
declare the consumer's dependencies.

**Why:** Orval's version inference can miss dependencies declared only by sibling
workspace packages. During a tooling upgrade it silently selected React Query v4
for a v5 consumer; generated code still typechecked, but its option types changed.
An earlier Zod inference mismatch had the same cause.

**How to apply:** When upgrading codegen or consumer runtimes, align their target
versions explicitly, regenerate, and validate the generated client and schemas
alongside the consuming packages.
