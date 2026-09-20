# Contributing

ReviewFlow is an experimental prototype. Contributions should preserve its safe
demo defaults and keep documentation narrower than the evidence.

## Development

1. Read [the local setup](docs/setup.md).
2. Create a new database whose name matches the disposable ReviewFlow guard.
3. Keep `APP_MODE=demo` unless the change specifically concerns an optional
   integration.
4. Make focused changes and update the OpenAPI contract/generated clients when
   an API shape changes.
5. Run the relevant typecheck, build, and test commands. Report exactly what
   you ran; do not describe skipped, provider-dependent, or unavailable checks
   as passing.

Never run migrations or database-writing tests against an existing application
database. Never commit credentials, database URLs, session secrets, cookies,
provider responses containing user data, or `.env` files.

## Pull requests

Include:

- the user-visible behavior and why it changed;
- migration and compatibility impact;
- security/privacy implications;
- commands actually run and their results;
- limitations or untested paths; and
- provenance and license details for every added asset, copied snippet, font,
  generated component, or dependency.

Keep demo data synthetic. New model/provider behavior must fail explicitly;
never silently replace a live failure with synthetic output.

## Code and generated files

Follow the existing TypeScript style and package boundaries. Prefer
transactional domain changes, immutable history, explicit authorization, and
runtime validation at external boundaries. Generated API artifacts should be
regenerated from `lib/api-spec/openapi.yaml`, not hand-edited.

Do not add vendored UI or media with uncertain provenance. If origin or license
cannot be established, identify the blocker in the pull request rather than
guessing.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow
[SECURITY.md](SECURITY.md).