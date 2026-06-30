> **Execution rule (every step):** add the override → `check-divergence` names the new drift → build the installer → verify 100% functional → commit. Never advance on a red step.
>
> The current `dev` already has all of Step 0-5 baked in (the full fork). To genuinely build *up*, work on an `integration-buildup` branch: reduce to the Step-1 baseline (revert the behavioral overrides 3-5), confirm it, then re-add 3 → 4 → 5 one at a time.

## Step 0 — Additive product, ZERO opencode drift (the floor)
- [ ] Confirm the `volt` binary + LSP + connector + vscode + `.opencode/` work with **0 modified opencode files** (`check-divergence` clean for this set)
- [ ] **Plugin → vendored:** ship `@opencode-ai/plugin` in the install resources + copy into `.opencode/node_modules` at `volt init` — drop the runtime `bun/npm install` (offline / no-PM safe)
  - [ ] `dist.ts`: vendor `@opencode-ai/plugin` (+ runtime deps) into `dist/volt/plugin/`
  - [ ] `electron-builder.config.ts`: ship it in resources
  - [ ] `opencode-config.ts`: copy it in at init (drop `.opencode/package.json` + the PM shell-out)
  - [ ] Test: `volt init` in a temp dir with NO bun/npm on PATH → the volt tool loads + chat works
- [ ] **Spinner:** keep the `volt.ts` value-reference + the `dist.ts` `registerSpinner` guard (audited sound — only tree-shake-vulnerable registration; static-entry root fix infeasible)

## Step 1 — One-installer bundling (structural override — the FIRST release)
- [ ] Keep ONLY the structural seams: `electron-builder.config.ts` (extraFiles + `Programs\Volt` + updater feed), `desktop/package.json` deps, the NSIS scripts (`connector.nsh` — PATH, vscode sideload, connector lifecycle)
- [ ] Build the installer; confirm **stock opencode GUI + the full bundled volt product** is 100% functional (agent + PLC + LSP + vscode + connector)
- [ ] `check-divergence` shows ONLY the structural drift (no behavioral)

## Step 2 — Stable UI channel (V1) — DONE (Task 1)
- [x] `app/vite.js` + `electron.vite.config.ts` channel default → prod (in-code, not `.env`)
- [x] 16th seam allowlisted; `.env` channel removed; footgun proven fixed (bypass build → prod)

## Step 3 — Branding
- [ ] `logo.tsx`, app name (`main/index.ts`), window titles (`*/index.html`), brand theme (`.opencode/tui.json`)
- [ ] Build installer; confirm Volt branding + still 100% functional

## Step 4 — Desktop GUI integration (the hot seam)
- [ ] `window.volt` IPC (`preload` + `main` + `electron.vite` volt input) + the "IDE" changes panel (`session.tsx` + `app/package.json` volt-app dep)
- [ ] Build installer; confirm the in-GUI Volt panel works
- [ ] Document `session.tsx` as the irreducible hot seam (315 commits/6mo, 8 interleaves); draft an upstream `registerChangeSource()` proposal (collapses 8 conflict sites → 1)

## Step 5 — Deep-link scheme
- [ ] `deep-links.ts` (`volt://`) + the `setAsDefaultProtocolClient` registration
- [ ] Build installer; confirm volt:// opens Volt (coexists with stock opencode://)

## Docs / cleanup (ride the steps)
- [x] CLAUDE.md seam count 12→16; deep-links "replacement" not "coexist" (Task 1)
- [ ] `.husky/pre-push`: delete the dead commented `# bun typecheck` line
