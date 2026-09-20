# Third-party notices and provenance

Original ReviewFlow code is licensed under the repository's
[MIT License](LICENSE). That license does not replace dependency or incorporated
source licenses.

## Dependency metadata audit

The following table was generated from the installed dependency graph with
`pnpm licenses list --prod --json` and `pnpm licenses list --dev --json`. The
values are package entries reported by pnpm, not inferred licenses.

| SPDX/license value reported by package metadata | Production entries | Development entries |
|---|---:|---:|
| MIT | 119 | 339 |
| Apache-2.0 | 2 | 7 |
| ISC | 7 | 28 |
| BSD-2-Clause | 1 | 3 |
| BSD-3-Clause | 1 | 5 |
| 0BSD | 1 | 1 |
| Unlicense | 1 | 1 |
| Python-2.0 | 0 | 1 |
| CC-BY-4.0 | 0 | 1 |
| MPL-2.0 | 0 | 1 |
| BlueOak-1.0.0 | 0 | 1 |
| MIT AND ISC | 0 | 1 |

Neither command reported an `Unknown` license entry in the regenerated,
installed graph. The earlier unknown-license Replit SDK and optional Vite
plugins are absent from the current manifests and lockfile.

Examples verified directly from installed package metadata include React,
Express, Clerk SDK packages, Radix UI packages, and Tailwind CSS as MIT;
Lucide React as ISC; Drizzle ORM and Drizzle Zod as Apache-2.0;
`caniuse-lite` as CC-BY-4.0; and `lightningcss` as MPL-2.0. The lockfile and
package distributions are authoritative for the complete versioned graph.
This inventory is not legal advice.

## shadcn/ui-derived component wrappers

The `components.json` files identify the official shadcn/ui schema, and the
committed `components/ui` source follows shadcn/ui's generated-wrapper pattern
over Radix UI. The exact generator revision was not recorded, which limits
revision-level reproducibility but does not leave the upstream license
unidentified. The official upstream MIT notice is retained verbatim below from
`shadcn-ui/ui`'s `LICENSE.md`:

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The installed Radix packages report MIT in package metadata. Their primitives
are dependencies rather than copied source in this repository.

## Lucide icon notice

Icons are imported from `lucide-react`; no copied Lucide SVG files were found.
The license shipped with installed `lucide-react` version 0.545.0 is retained
verbatim:

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts, samples, and repository assets

The web artifacts use system UI, serif, and monospace stacks. They do not
download Google Fonts or vendor font files, so there is no font binary or
font-service license notice to carry.

The records in `artifacts/reviewflow/public/sample-tasks.jsonl` and the API's
built-in sample array are code-generated, agent-created synthetic fixtures,
not customer data. They use invented product-policy examples. The demo
evaluator derives its repeatable synthetic proposal values from a SHA-256 seed
of each fixture's external ID; it deliberately changes some labels so
reviewers can exercise correction and escalation.

`screenshots/reviewflow-review.png` is an original capture of ReviewFlow created
during this candidate-freeze task. It displays only the built-in synthetic demo
fixtures. Older workspace captures are excluded from the source package.

The workspace's `attached_assets` review input is not runtime content and is
explicitly excluded by the allowlist-based source packager. It is not part of
the candidate package or this notice inventory.

No other application image, audio, video, copied SVG, or vendored font assets
were found in the inspected source paths.