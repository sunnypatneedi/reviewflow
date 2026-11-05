---
name: Raw SQL claim rows
description: A PostgreSQL/Drizzle behavior relevant to atomic queue claims.
---

Atomic claims implemented with `tx.execute(sql\`...\`)` return PostgreSQL column names as raw result keys. They do not automatically map snake_case columns to the schema's camelCase property names.

**Why:** Treating a raw returned row as a Drizzle-inferred row caused the worker to miss `projectId` and `taskId`, so claimed jobs were incorrectly recorded as missing tasks.

**How to apply:** When a raw SQL result is cast to a schema row, explicitly alias every snake_case field used by application code with quoted camelCase names in the `RETURNING` clause.