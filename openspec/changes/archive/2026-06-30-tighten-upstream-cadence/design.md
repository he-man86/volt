## Context

The fork drifted 69 commits behind `upstream/dev` in ~2 days. Investigating "how optimally can we
insert our changes" (seam shape) vs "why are we behind" (cadence) gave a clear, data-backed answer.

## The seam audit (recorded so it isn't re-litigated)

Per-seam upstream churn (commits touching the file, last ~4 months) = the real conflict risk, since a
seam's cost is *invasiveness × churn*:

```
 churn  seam                                  verdict
 350    bun.lock                              noise — generated, `bun install` auto-resolves
 130    packages/app/package.json             noise — trivial dep-line conflict
 114    packages/app/src/pages/session.tsx    ⚠ content-edit in a hot file — the only real risk
 111    packages/desktop/package.json         noise — trivial dep-line conflict
  18    packages/desktop/src/main/index.ts    fine — small mount
   9    packages/desktop/src/preload/index.ts fine
 4·4·4·4·1·0  electron-builder / vite / tui.json / .gitignore / logo / pre-push   cold — free
```

**Finding:** 11 of 12 seams are optimal (generated/trivial/cold). The one risky seam — the desktop
"IDE" changes-source in `session.tsx` — **cannot be made additive today**: `upstream/dev` still
hardcodes `type ChangeMode = "git"|"branch"|"turn"`, there is no changes-source/diff-provider registry
anywhere in `app`/`session-ui`/`plugin`, and the plugin-v2 system opencode is building is **backend
only** (domain transforms + runtime hooks; zero UI/panel/diff/slot concepts). So a minimal mount in
`session.tsx` is the optimal achievable, and we already did it. The only marginal win left is moving
the `voltDetected`/`ideQuery` logic into `volt-app` helpers so `session.tsx` holds only ~5 thin branch
lines (smaller re-apply on conflict) — optional, low value.

## Decisions

- **Leave the seams.** They're near-optimal; the one hot seam is irreducible without opencode building
  GUI extensibility (not on their roadmap). Don't over-invest here.
- **Drift = cadence, not seams.** Weekly sync vs ~35 commits/day → up to ~245 commits of drift. Fix
  cadence, not seam shape.
- **Daily + auto-merge-when-green.** A daily job caps drift at ~35 commits (smaller, conflict-rarer
  merges); when `sync.ts` is green and the merge is clean, fast-forward onto `dev` with no human — a
  human is the exception (conflict / failed signal), not the rule.

## Risks / Trade-offs

- [Auto-merging unreviewed upstream onto `dev`] → mitigated: it only auto-merges when `check-divergence`
  + `check-volt-integration` + `verify-lsp` + `verify-volt-tool` all pass *and* there are no conflicts;
  anything else opens a PR. CI on `dev` is the backstop.
- [Daily job noise] → most days are clean fast-forwards (no PR, no notification); only conflict days surface.

## Open Questions

- Auto-merge straight to `dev`, or to a `staging` branch the desktop/CI smoke-tests first? (Start with
  `dev` + CI; add a staging gate only if a bad upstream lands.)
