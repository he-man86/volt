## Why

opencode ships **~35 commits/day**. The fork's auto-sync runs **weekly** (`cron: "0 6 * * 1"`), so it
drifts up to ~245 commits between syncs — measured, 2 days after the last sync we were already **69
commits / 26 `packages/app` files (+2576/−547)** behind the official build (which is what "the app
looks more developed" was). A seam audit (see `design.md`) showed the integration is already
**near-optimal** — 11 of 12 seams are cold/trivial; the one hot seam (`session.tsx`, ~114 upstream
touches/4mo) is a *content-edit in a hot file* but **irreducible to additive** (opencode has no GUI
extension surface and isn't building one — its plugin-v2 is backend-only). The 69 behind didn't touch
`session.tsx` at all. So the drift is a **cadence** problem, not a conflict-surface one.

## What Changes

- **Cadence: weekly → daily** — each merge stays small (~35 commits), so conflicts are rare and tiny.
- **Auto-merge when green** — when the merge has no conflicts and `sync.ts` passes all signals,
  fast-forward it onto `dev` automatically; a human is needed **only** on a conflict or a failed signal.
- **Clean up stale `sync/*` branches** (e.g. `origin/sync/upstream-dev-2026-06-22`).
- **Record the seam audit** (near-optimal + irreducible `session.tsx`) so it isn't re-litigated.

## Capabilities

### Modified Capabilities
- `upstream-sync`: add a **cadence** requirement (daily auto-sync; auto-merge when conflict-free + `sync.ts` green).

## Impact

`.github/workflows/volt-upstream-sync.yml` (⚠ CI seam — allowlisted). No product-code change.
