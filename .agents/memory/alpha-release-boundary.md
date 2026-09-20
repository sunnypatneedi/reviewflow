---
name: Alpha source release boundary
description: Why public source uses a sanitized root and tests use disposable databases.
---

Publish only a reviewed allowlisted source snapshot as a new public root commit;
preserve workspace history privately rather than pushing internal history/remotes.

**Why:** The workspace includes prompt attachments, agent context, and unrelated
design scaffolding that are not part of the requested open-source alpha.

**How to apply:** Rebuild and scan the exact candidate after changes. Verify from
that candidate on a separately initialized disposable PostgreSQL cluster, never
the existing user database. Public-alpha claims cover the local synthetic demo;
mocked provider tests must not become claims of live model quality.