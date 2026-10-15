# ReviewFlow v4 — Primary CTA audit

Rule for v4: **exactly one ink-filled primary CTA per screen**. Secondary actions use outline/ghost/text. This audit records what each page currently exposes and what the v4 primary should be. Pages are not rewritten yet.

| Screen | Primary CTA | Notes |
| --- | --- | --- |
| Overview (`pages/home.tsx`) | **Continue reviewing** → `/review` | **Current:** no CTA — metrics-only dashboard. **v4:** one ink-filled primary that routes to the review queue (or “Start review” when `pending`/`proposed` > 0). Error state can keep a text “Retry” / reload, not a second filled button. |
| Tasks (`pages/tasks.tsx`) | **Run evaluation** | **Current:** two default (filled) buttons — “Import JSONL” and “Run Evaluation”. **v4:** keep **Run evaluation** as the sole ink-filled primary; demote Import to outline. Empty queue: still prefer Import as outline until selection exists, or swap primary only when zero tasks and import is the only meaningful action — avoid two filled buttons at once. Per-row Retry stays outline/sm. |
| Trace2Preference (`pages/traces.tsx`) | **Validate & import** (queue empty / import focus); **Record human preference** / **Save correction** (comparison selected) | **Current:** multiple filled defaults — import, create release, save preference, confirm Label Studio, plus several outline downloads. **v4:** one primary in the active context: import when no comparison is open; preference save when reviewing; demote Create release, kit downloads, reconcile, reveal/proposal, and quality record to outline/ghost. |
| Review (`pages/review.tsx`) | **Accept** / **Correct to …** (from `primaryActionForSelection`) | **Current:** already closest to v4 — filled primary for accept/correct; Escalate is outline. **v4:** keep that single ink-filled primary; escalate stays secondary. |
| Review — empty (`!item`) | **Go to Tasks** | **Current:** text link “Go to Tasks”. **v4:** make that the single ink-filled primary on the empty state (“Queue clear”). |
| Review — load/submit error | **Reload queue** | **Current:** text “Reload queue” under the alert. **v4:** one ink-filled primary on the error surface (Reload queue); do not also fill the Accept/Correct button while the alert owns the CTA. |
| Review — no proposal | *(none / disabled wait)* | **Current:** filled-looking but dashed “Waiting for a proposal”. **v4:** treat as non-action (disabled secondary styling); no ink fill until a real submit is available. |
| Audits (`pages/audits.tsx`) | **Create audit** (list); **Submit blind decision** / **Resolve disagreement** (detail) | **Current:** Create audit is default filled; item-level Submit / Resolve are also filled. **v4:** list view → Create audit only; when an audit is selected, shift the single primary to the active work item action and demote Create to outline (or hide it in the detail chrome). |
| Releases (`pages/releases.tsx`) | **Cut release** | **Current:** “Cut Release” is already the sole filled button; download is ghost icon. **v4:** keep Cut release as the ink-filled primary. |
| Settings (`pages/settings.tsx`) | *(none — read-only)* | **Current:** no buttons. **v4:** remain CTA-free unless credentials are missing, in which case a single **Configure live credentials** (external/docs) ink fill is enough — no inventing save forms. |

## Summary gaps before rewrite

1. Overview and Settings lack a purposeful primary today.
2. Tasks and Traces over-use default filled buttons — need demotion to outline/ghost.
3. Review is largely compliant; empty and error states need a real ink-filled recovery CTA.
4. Audits needs a list-vs-detail primary handoff so Create and Submit are never both ink-filled at once.
