# ReviewFlow v4 — Primary CTA audit

Rule for v4: **exactly one ink-filled primary CTA per screen**. Secondary actions use outline/ghost/text. Status below reflects what shipped on the app-wide CTA pass (Review screen owned by a concurrent rewrite).

| Screen                                        | Primary CTA                                                                                                                                                              | Notes                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview (`pages/home.tsx`)                   | **Continue reviewing** / **Start review** → `/review`                                                                                                                    | Ink-filled link uses default button styles. Label is **Continue reviewing** when `pending > 0`, otherwise **Start review**. Error state keeps a text/ghost **Retry** only (not filled).                                             |
| Tasks (`pages/tasks.tsx`)                     | **Run evaluation** (when tasks exist); **Import JSONL** (empty queue)                                                                                                    | Exactly one filled at a time: Import is outline when the table has tasks; Run evaluation is outline when the queue is empty. Per-row Retry stays outline/sm.                                                                        |
| Trace2Preference (`pages/traces.tsx`)         | **Validate & import** (no comparison selected); **Confirm returned decision** (staged Label Studio); **Record human preference** / **Save correction** (comparison open) | Create release, kit downloads, reconcile, reveal/proposal, and quality record are outline/ghost. Import demotes to outline while a comparison is open. Preference save demotes to outline while a staged annotation awaits confirm. |
| Review (`pages/review.tsx` / `pages/review/`) | **Accept** / **Correct to …** (from `primaryActionForSelection`)                                                                                                         | Owned by concurrent Review v4 rewrite — not edited in this pass. Expected: single ink-filled primary; Escalate secondary; empty → Go to Tasks; error → Reload queue.                                                                |
| Audits (`pages/audits.tsx`)                   | **Create audit** (list / no selection); **Submit blind decision** / **Resolve disagreement** (detail)                                                                    | Create demotes to outline while an audit is selected so Create and Submit are never both filled.                                                                                                                                    |
| Releases (`pages/releases.tsx`)               | **Cut release**                                                                                                                                                          | Sole ink-filled primary; row download remains ghost icon.                                                                                                                                                                           |
| Settings (`pages/settings.tsx`)               | **Open setup documentation** (credentials missing only)                                                                                                                  | Read-only when live credentials are configured — no invented save CTA. When `liveCredentialConfigured === false`, one ink-filled link to `docs/setup.md` on GitHub.                                                                 |

## Layout / shared UI (this pass)

- Sidebar: `bg-fill-subtle`, `border-line-hairline`
- Desktop top bar: ThemeToggle + Commands (`/`) + help (`?`)
- Narrow viewports: root uses `min-[861px]:h-screen min-[861px]:overflow-hidden` so the document scrolls under 861px
- UI overlays: `bg-surface-scrim` + `z-scrim` / `z-dialog` / `z-popover` (no `bg-black/80` / `z-50` in primitives)

## Intentionally deferred

- `pages/review.tsx` banned-token cleanup (`text-ink-2`, `bg-mark`, `accent-wash`, `hsl(var(--…))`) — concurrent Review rewrite owns that file.
- Vendored `components/interior/*` still uses stone/hex demo styling; left untouched to avoid scope bleed.
