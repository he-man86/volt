## 1. Cadence (the actual fix)

- [ ] 1.1 `.github/workflows/volt-upstream-sync.yml`: cron weekly → **daily** (`"0 6 * * *"`)
- [ ] 1.2 Auto-merge: when the merge is conflict-free **and** `sync.ts` passes → fast-forward onto `dev`; otherwise open a PR (current behaviour)
- [ ] 1.3 Delete the stale `origin/sync/upstream-dev-2026-06-22` branch; auto-prune merged `sync/*` branches

## 2. Record the seam audit (the "near-optimal / irreducible" finding)

- [x] 2.1 `design.md`: per-seam churn table + the conclusion (11/12 optimal; `session.tsx` irreducible; opencode has no GUI hook)
- [ ] 2.2 (optional, low value) move `voltDetected`/`ideQuery` logic into `volt-app` helpers to shrink the `session.tsx` footprint to ~5 thin branch lines

## 3. Spec

- [x] 3.1 `upstream-sync`: the daily + auto-merge-when-green requirement (delta written)

## 4. Verify

- [ ] 4.1 `workflow_dispatch` a run → a clean merge fast-forwards (no PR); a synthetic conflict opens a PR
- [ ] 4.2 After landing: re-check `git rev-list --count HEAD..upstream/dev` stays small (≤ ~one day's velocity)
