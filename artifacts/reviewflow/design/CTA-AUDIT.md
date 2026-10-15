# ReviewFlow v4 — Primary CTA audit

Rule: **exactly one ink-filled primary CTA per screen**. Secondary actions use outline / secondary / ghost / text.

| Screen                        | Primary CTA                                                                                               | Notes                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Overview                      | **Continue reviewing** / **Start review** → `/review`                                                     | Label depends on `metrics.proposed`. Retry on error stays ghost. |
| Tasks                         | **Run evaluation** (has tasks); **Import JSONL** (empty queue)                                            | Exactly one filled at a time. Per-row Retry is outline.          |
| Trace2Preference              | **Validate & import** / **Confirm returned decision** / **Record human preference** / **Save correction** | Context-dependent sole primary; release/kit/assist stay outline. |
| Review (default)              | **Accept · {label}**                                                                                      | Ink-filled; Escalate secondary.                                  |
| Review (label changed)        | **Correct to {label}**                                                                                    | Same primary slot.                                               |
| Review (injection ≥ 0.5)      | **Escalate…**                                                                                             | Escalate becomes the ink-filled primary; Accept demotes.         |
| Review (offline)              | **Offline · can't submit** (disabled)                                                                     | Sole primary, disabled.                                          |
| Review (409 conflict)         | **Load latest**                                                                                           | Replaces submit as the primary.                                  |
| Review (network/submit error) | **Retry**                                                                                                 | Sole primary above the actions.                                  |
| Review (no proposal)          | **Check again**                                                                                           | Sole primary.                                                    |
| Review (empty / queue clear)  | **Check for new tasks**                                                                                   | **Open Tasks** is secondary.                                     |
| Review (load error)           | **Try again**                                                                                             | **Open Tasks** is secondary.                                     |
| Audits                        | **Create audit** (list); **Submit/Resolve** (detail)                                                      | Create demotes while detail is selected.                         |
| Releases                      | **Cut release**                                                                                           | Sole filled CTA.                                                 |
| Settings                      | **Open setup documentation** (credentials missing only)                                                   | Otherwise read-only — no invented save CTA.                      |

## Undo

Shipped the success toast **without Undo**. No `POST /reviewflow/review/:taskId/revert` endpoint was added (needs product/API sign-off: same reviewer, within 10s, task unchanged, audited).
