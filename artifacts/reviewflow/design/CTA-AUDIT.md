# ReviewFlow v4 — Primary CTA audit (polish pass)

Rule: **exactly one ink-filled primary CTA per screen/state**. Secondary actions use outline / ghost / text.

| Screen | Primary CTA | Notes |
| --- | --- | --- |
| Overview | **Continue reviewing** / **Start review** → `/review` | Label depends on pending queue. Load error → **Retry**. |
| Tasks | **Run evaluation** (has tasks); **Import JSONL** (empty) | Exactly one filled. SearchField for filter (N of M). Narrow sticky primary. |
| Trace2Preference | **Validate & import** / **Confirm returned decision** / **Record human preference** / **Save correction** | Context-dependent. Release/reconcile behind confirm dialogs (outline triggers). |
| Review | **Accept · {label}** / **Correct to {label}** | Escalate secondary; injection ≥0.5 swaps Escalate to primary. |
| Review · offline | **Offline · can't submit** (disabled) | Sole primary slot. |
| Review · 409 | **Load latest** | Replaces submit. |
| Review · network error | **Retry** | Sole primary. |
| Review · no proposal | **Check again** | Sole primary. |
| Review · empty | **Check for new tasks** | Open Tasks secondary. |
| Review · load error | **Try again** | Open Tasks secondary. |
| Audits | **Create audit** (list); **Submit/Resolve** (detail) | Create demotes while detail selected. |
| Releases | **Cut release** | Confirm dialog before irreversible cut. |
| Settings | **Open setup documentation** (credentials missing only) | Otherwise read-only. |
| 404 | **Go to Overview** → `/` | Keeps app shell + theme. |
| Error boundary | **Try again** | Keeps app shell + theme. |

## Undo

Success toast ships **without Undo** (no revert endpoint).

## Polish layout / system

- Framed column `--frame-max: 1200px` with L/R hairlines; page hatch behind
- Sticky 56px glass header (85% paper + blur); mono one-line footer
- Shadows resolve to `none`; separation via 1px dividers / shared borders
- Type roles: sans UI/headings · serif reading · mono 11px uppercase labels (`--label-track`)
- Radii: control/button/input 6px · panel 8px · band/cell 0 · pill/circle for dots
- Motion: `rf-enter` 0.25s / 4px rise; theme 0.25s; `scroll-padding-top: 80px`; reduced-motion respected
- Theme: system until toggled, `rf.theme` persisted, FOUC script before paint
