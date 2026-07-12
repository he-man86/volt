## Why

After `minimize-opencode-fork` lands, the "fork" holds only `volt-*` packages + a thin desktop shell + the
`OPENCODE_CONFIG_DIR` bundle, and consumes opencode purely as a **runtime** (chained install; serves backend +
GUI over HTTP via `opencode web`) plus the published **`@opencode-ai/plugin`**. At that point carrying opencode's
entire monorepo is dead weight: every `git merge upstream/dev`, the `check-divergence` guard, and the seam
machinery exist *only* to hold source Volt no longer edits.

So the natural endpoint is a **clean standalone `volt` repository** that **depends on** opencode instead of
**forking** it — tracking opencode by dependency version and a compat gate, not by re-merging its tree.

This is the *follow-on* to the de-fork, not a parallel effort: the de-fork proves every piece detaches **in
place** (pristine core/GUI, panel→connector, wrap the served GUI, no custom binary); extraction is then a lift,
not a redesign.

## What Changes

- **A new standalone repo** containing only Volt's own code: `packages/volt-*`, `packages/volt-desktop` (the thin
  shell), `volt-config/`, `volt-scripts/`, `openspec/`, `.claude/`, `CLAUDE.md`, docs.
- **opencode is a dependency, not a fork:**
  - the **runtime** — a chained/pinned opencode install that serves backend + GUI (`opencode web` → localhost);
  - the **plugin SDK** — `@opencode-ai/plugin` (npm) for the `volt` tool + config;
  - the desktop **wraps the served GUI** (BrowserView on the localhost URL) — no `@opencode-ai/app`, no vendoring.
- **Replace the fork machinery**: `git merge upstream/dev` → `bun update @opencode-ai/plugin` + bump the pinned
  opencode runtime version; **retire `check-divergence`** (nothing to diverge); `sync.ts`'s merge-signal-flow →
  a **compat gate** (test `volt-*` + config against the pinned opencode release).

## Impact

- Repo shrinks from all-of-opencode to just Volt; upstream tracking becomes dependency bumps + compat tests.
- **Requires the de-fork done first** (`minimize-opencode-fork`) — the pieces must detach in place before the lift.
- **Dependency audit is load-bearing** (design §): `volt-*` may only depend on **published** opencode packages
  (`plugin`, `ui`) + the runtime. Any dep on a **private** opencode package (`console-core`, `console-resource`,
  `session-ui` — used by `volt-landing`/`volt-control`) must be resolved (publish, vendor, or keep that piece
  out of the first cut).
- The commercial/landing packages (which lean on opencode's private `console-*`) are a **separate concern** — the
  core product (bridge · git · lsp · connector · desktop) extracts first; landing follows when `console-*` is
  resolved.
- Related: `minimize-opencode-fork` (prerequisite), `distribution` (the two-lane installer moves with it).
