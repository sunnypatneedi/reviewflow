# Source publication review

This repository's current Git history is private and must not be published or
rewritten. A public repository should start from the reviewed source candidate
as a new root commit after verification. The working history is preserved
locally and is deliberately excluded from the public-source archive.

## Candidate boundary

Run `node scripts/package-source.mjs` (or the package script that invokes it).
It replaces `/tmp/reviewflow-source-stage` and writes
`releases/reviewflow-source.tar.gz`. The `releases` directory is outside the
allowlist, so an archive can never package itself.

The explicit allowlist is:

- root build and package files: `.gitignore`, `.npmrc`, `package.json`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and
  `tsconfig.json`;
- project material: `.env.example`, `LICENSE`, `README.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `.github`, and `docs`;
- the original synthetic review capture `screenshots/reviewflow-review.png`;
- application source: `artifacts/api-server` and `artifacts/reviewflow`;
- shared and operational source: `lib` and `scripts`.

The copier rejects symlinks and special files. It excludes `.agents`, `.cache`,
`.config`, `.git`, `.local`, `.replit`, `.replit-artifact`, `.replitignore`,
`attached_assets`, `artifacts/mockup-sandbox`, old screenshots, `node_modules`,
`dist`, `releases`, TypeScript build metadata, logs, runtime traces, and dumps
at any depth. Account configuration, the old overview screenshot, prompt
attachments, mockup-only code, generated build output, and local runtime state
therefore cannot enter the candidate. Workspace globs may still mention the
excluded mockup package; pnpm tolerates an unmatched workspace glob.

## Final review procedure

1. Generate the candidate from the exact working tree intended for release.
   Record the archive checksum and candidate file count.
2. Compare the complete staged file list with the allowlist. Confirm expected
   application, library, migration, generated API client, test, script, package,
   lock, and build configuration files are present.
3. Scan every staged file with a pinned, checksum-verified official Gitleaks
   binary. Keep the binary and downloaded checksum data in `/tmp`; do not add
   either to this project or alter package/toolchain files. Report only finding
   counts, rule identifiers, and paths. Never paste a detected value.
4. Manually review all scanner findings and search the complete candidate for
   credentials, tokens, private keys, connection strings, personal data,
   internal hostnames, account identifiers, absolute home paths, copied prompt
   material, unclear media/code provenance, debug artifacts, and noisy generated
   runtime output. Generated API clients and lockfiles are expected source
   artifacts, but still require scanning.
5. Extract the archive into a second empty directory and compare its complete
   file list and content checksums with staging. Verify the archive contains no
   archive, Git metadata, excluded path, symlink, or special file.
6. Run install, typecheck, test, and build checks from the extracted candidate.
   A secret scan alone is not a publication approval.
7. After the parent explicitly approves the final snapshot, initialize a new
   Git repository in staging and create one sanitized root commit. Never copy
   `.git`, publish existing refs, rewrite the private repository, or add its
   remotes.

## Review record

No pass is claimed merely because this document or the packaging script exists.
For the final snapshot, record the UTC review time, source revision/working-tree
identity, archive checksum, staged file count, scanner name/version/checksum,
finding counts and reviewed paths, manual-review disposition, archive comparison
result, and build/test results. List unresolved risky source and its scope
explicitly; block publication until each item is removed or accepted by the
owner.