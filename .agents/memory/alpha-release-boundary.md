---
name: Alpha source release boundary
description: Why public source uses a sanitized root and tests use disposable databases.
---

Publish only a reviewed allowlisted source snapshot. The initial public release
uses a sanitized root; subsequent releases must be incremental commits atop the
latest existing public branch, never a replacement root or private-history merge.
Preserve workspace history privately rather than pushing internal history/remotes.

**Why:** The workspace includes prompt attachments, agent context, and unrelated
design scaffolding that are not part of the requested open-source alpha. Once a
public release exists, replacing its history would discard independent remote
work and obscure the workload's incremental provenance.

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

Connector OAuth is not automatically available to shell Git or GitHub CLI.

**Why:** The connector authenticated successfully while shell Git had no credential
helper and GitHub CLI had no authenticated session.

**How to apply:** Keep direct-push remotes and credential helpers confined to the
sanitized checkout. If connector writes remain unavailable, request any direct-Git
credential through Secrets, never chat, shell output, or remote URLs.