# Design — extract Volt to a clean, opencode-depending repo

## The shape
```
volt/  (a normal repo — NOT a fork of opencode)
├─ packages/volt-bridge · volt-git · volt-lsp-iec · volt-vscode · volt-connector · volt-control · volt-app
├─ packages/volt-desktop   thin Electron shell → spawns opencode, loads its SERVED GUI, draws Volt chrome + panel
├─ volt-config/            the OPENCODE_CONFIG_DIR bundle (LSP reg · volt tool · agent · theme · permissions)
├─ volt-scripts/           build · installer · the compat gate
├─ openspec/ · .claude/ · CLAUDE.md · docs
└─ deps:  chained opencode RUNTIME (serves backend + GUI)   +   @opencode-ai/plugin (npm)   [+ @opencode-ai/ui]
```
No opencode source in the tree. opencode is consumed two ways only: **run it** (backend + served GUI) and
**import `@opencode-ai/plugin`** (the tool/config SDK).

## What replaces the fork machinery
| Fork (today) | Clean repo |
|---|---|
| `git merge upstream/dev` + resolve | `bun update @opencode-ai/plugin` + bump pinned opencode runtime version |
| `check-divergence.ts` (guard 18 seams) | **retired** — no upstream source, nothing to diverge |
| `sync.ts` merge-signal-flow | a **compat gate**: `verify-lsp` + `verify-volt-tool` + conformance corpus vs the pinned opencode release |
| 18 seams | **zero** — branding is in the shell/config; the GUI is wrapped, not edited |

## Dependency audit (load-bearing — decides what can extract)
`volt-*` may depend ONLY on **published** opencode packages + the runtime. Current deps on opencode packages:
- `@opencode-ai/plugin` — published ✅ · `@opencode-ai/ui` — published (`publishConfig`) ✅
- `@opencode-ai/session-ui`, `@opencode-ai/console-core`, `@opencode-ai/console-resource` — **likely private**;
  used by `volt-landing` / `volt-control`. **Blockers for those packages** until resolved (publish / vendor / defer).

**Consequence — extract in two cuts:**
1. **Core product** (bridge · git · lsp-iec · vscode · connector · desktop) — depends only on `plugin`/`ui` +
   runtime → extracts cleanly first.
2. **Commercial/landing** (`volt-landing`, and any `volt-control` UI on `console-*`) — needs `console-*` resolved;
   follows later, or stays in the monorepo until then.

## Migration (a lift, sequenced AFTER the de-fork)
1. **Prereq:** `minimize-opencode-fork` landed — core/GUI pristine, panel in the connector, desktop wraps the
   served GUI, no custom binary. The fork is already minimal + proven detachable.
2. **New repo:** move `packages/volt-*` (core cut) + `packages/volt-desktop` + `volt-config` + `volt-scripts` +
   `openspec` + `.claude` + `CLAUDE.md` + docs. Fresh `package.json`/turbo/bun workspace (Volt-only).
3. **Wire deps:** `@opencode-ai/plugin` (+`ui` if needed) from npm; pin a compatible opencode runtime version;
   the shell builds standalone (no `@opencode-ai/app/vite`).
4. **Port build/installer:** build the shell + config + connector; the NSIS **chains opencode's install** +
   installs the Volt layer (the two-lane model from `minimize-opencode-fork`).
5. **Compat gate:** `sync.ts` → run `verify-lsp` + `verify-volt-tool` + the corpus against the pinned opencode.
6. **Cut over:** the clean repo becomes the product repo; the old fork is archived (or kept as a read-only
   reference during transition). Landing/commercial extract in the second cut.

## Edge cases
1. **Shell renderer rewrite.** Today `packages/desktop` bundles `@opencode-ai/app/vite` as the renderer. The
   clean shell must instead **load the served URL** in a BrowserView + host Volt chrome. Verify `opencode web`
   serves everything the desktop needs (auth handshake, session routing, deep-links). Real work, but it's the
   wrap model from `minimize-opencode-fork` §End-state.
2. **`volt://` into a served page.** The shell must forward translated deep-links to the BrowserView (URL param /
   postMessage), since it no longer owns the renderer bundle.
3. **Private-package deps** (above) — audit + resolve before including a package in a cut.
4. **opencode runtime version compat.** Pin a **range**; the chained install must land within it; the compat gate
   catches breakage. A newer opencode already present is reused (no downgrade).
5. **Shared tooling loss.** The monorepo's turbo/bun/catalog setup shrinks to a Volt-only one — re-establish
   lint/typecheck/test config standalone.
6. **History.** Decide: fresh history (clean) vs. `git filter-repo` to carry `volt-*` history into the new repo
   (preserves blame). Recommend filter-repo for the `volt-*` + `volt-scripts` + `openspec` paths.
