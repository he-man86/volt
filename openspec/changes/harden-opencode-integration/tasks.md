> **Execution rule (every step):** add the override → `check-divergence` names the new drift → build the installer → verify 100% functional → commit. Never advance on a red step.
>
> **No revert / rebuild needed.** The audit showed the integration is already mostly clean — every seam is cheap *except* `session.tsx`. So this is **targeted in-place hardening**, not a from-zero rebuild. Only three changes earn their keep: **Step 4** (the `VoltIdePanel` — kills the one chronic seam), **Step 0** (vendor the plugin — offline-safe `volt init`), and the doc cleanup. Steps 1/2/3/5 already ship cheap + verified — leave them.

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

## Step 4 — Desktop IDE-changes panel (self-owned, ~1 seam)
- [ ] Move ALL the IDE-changes logic into a self-contained `VoltIdePanel` in `volt-app`: its own toggle, `ideQuery` over the `window.volt` IPC, diff rows via `@opencode-ai/ui` (additive — no opencode edit)
- [ ] Mount it with ONE line in `session.tsx` (~:1859) — `<Show when={voltDetected()}><VoltIdePanel/></Show>` beside `<SessionSidePanel/>`
- [ ] DELETE the 8 native interleaves (`ChangeMode "ide"`, `changesOptions.push("ide")`, `ideQuery`, the `reviewDiffs`/`reviewReady`/`label`/`reviewEmptyText` branches, the `<VoltIdeHeader/>` render)
- [ ] Keep the `window.volt` IPC seam (`preload` + `main`) — the panel needs it
- [ ] Build installer; confirm the IDE-changes panel works (a Volt panel parallel to opencode's changes panel)
- [ ] `check-divergence`: `session.tsx` drops from 8 touch points → 1 mount line

## Step 5 — Deep-link scheme
- [ ] `deep-links.ts` (`volt://`) + the `setAsDefaultProtocolClient` registration
- [ ] Build installer; confirm volt:// opens Volt (coexists with stock opencode://)

## Docs / cleanup (ride the steps)
- [x] CLAUDE.md seam count 12→16; deep-links "replacement" not "coexist" (Task 1)
- [ ] `.husky/pre-push`: delete the dead commented `# bun typecheck` line
