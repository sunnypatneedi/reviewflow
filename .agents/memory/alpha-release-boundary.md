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

Do not infer connector write authorization from successful GitHub login or
repository metadata reporting `permissions.push`.

**Why:** Those reads succeeded while the first contents upload was rejected with
`403 Resource not accessible by integration`; user rights and integration rights
are distinct.

**How to apply:** Treat write rejection as an unresolved repository/integration
permission boundary, preserve the verified candidate, and do not claim publication.