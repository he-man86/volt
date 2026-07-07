## 1. Shared core — finish volt-control Phase 2 (display model)

- [x] 1.1 Add a **Node-free** display module to `volt-control` (zero `node:*` imports) exposing `healthDisplay(state)` → `{ online, label, tone }` and `aggregate(statuses)` → `VoltDisplay` (`{ severity, label, tooltip, action?, incoming, outgoing }`), with the worst-state-wins order (merge > mismatch > offline > no-project > degraded > drift > in-sync).
- [x] 1.2 Export it via a Node-free subpath (mirror the existing `/channels` export) so the sandboxed Solid renderer can import it; add the subpath to `package.json` `exports`.
- [x] 1.3 Unit-test `aggregate` (worst-wins ordering) and `healthDisplay` (each `HealthState.kind`) — `bun test` in `packages/volt-control`.
- [x] 1.4 Move the pure mapping out of `healthLabel`/`updateGlobalUi` logic into the new module; keep `healthLabel` as a thin re-export or remove it if unused after refactor.

## 2. VS Code — dedicated Volt activity-bar area

- [x] 2.1 `package.json`: add `viewsContainers.activitybar` (Volt icon) + `views` (IDE Sync, Diagnostics, Bridge, Reference & Agent). Remove the `scm/title` + `volt.scm.more` menu contributions; add `view/title` equivalents; rename submenu → `volt.more`; retarget `viewsWelcome` to `volt.views.sync`.
- [x] 2.2 Replace `src/views/scm.ts` (native `SourceControl`) with an IDE Sync `TreeDataProvider` (in `src/views/panel.ts`): two groups (Incoming/Outgoing), each item opening its baseline diff (`vscode.diff` over `VOLTIDE↔BRIDGE` / `VOLTIDE↔WORKSPACE`) — reuse the existing `VoltContentProvider` unchanged.
- [x] 2.3 Add a Bridge `TreeDataProvider` rendering `healthDisplay(...)` (health, project, port) with Start-Bridge / Accept-Rename actions on the relevant state.
- [x] 2.4 Add a Reference & Agent view exposing Open Agent, New Session, and the language-reference entry (moved from palette-only to view items).
- [x] 2.5 Add the diagnostics-summary view: read `vscode.languages.getDiagnostics()`, filter on the LSP's own `source` (`volt-lsp-iec`), group error/warning counts per file, and on click open the native Problems panel (no custom tree).
- [x] 2.6 Update `src/extension.ts` to construct/register the new `VoltViews` instead of `VoltScm`; status-bar item now renders the shared `aggregate()` display model.

## 3. VS Code — LSP config wiring (fix drift)

- [x] 3.1 In `src/lsp.ts`, read from the declared `volt.iec.*` namespace (not `volt.lsp.*`); remove reads of keys the manifest doesn't declare.
- [x] 3.2 Honor `volt.iec.server` in `resolveServerModule` (override → packaged `dist/lsp-server.js` → dep → dev sibling); launch the stdio-only server as a Node module with `--stdio` + vendor flag.
- [x] 3.3 Forward `volt.iec.diagnostics.*` toggles + `vendor` + `trace` into the client `initializationOptions`.

## 4. Desktop GUI — dedicated Volt area

- [x] 4.1 Keep the **single** `<VoltIdePanel/>` seam line in `packages/app/src/pages/session.tsx` unchanged (no new `packages/app` seam); `VoltIdePanel` remains the self-owned surface hung off that one seam.
- [x] 4.2 Replace the inlined `HealthDot` logic in `VoltIdeHeader.tsx` with the shared `healthDisplay` from the Node-free `/display` subpath — richer label (project name) + tone-driven color; kills the last duplicated health→label mapping.
- [x] 4.3 Reference & Agent launchers are N/A on desktop — the desktop host **is** opencode's agent (no terminal to launch), so parity here means "nothing to add." IDE Sync + bridge health are the desktop's dedicated surface.
- [x] 4.4 Confirmed: the desktop still needs only the one `session.tsx` addition — no edits to `packages/app` layout/nav.

## 5. Verification

- [x] 5.1 `bun typecheck` clean across affected packages (`volt-control`, `volt-vscode`, `volt-app`, `volt-lsp-iec`); `bun run build` (volt-vscode) bundles extension + `dist/lsp-server.js` + cli.
- [x] 5.2 `bun run volt-scripts/check-divergence.ts` — clean; only the 18 existing seams (incl. an already-seamed `session.tsx`, untouched), no new `packages/app` seam.
- [x] 5.3 Packaged + installed into Windsurf (v0.1.3); user confirmed the dedicated Volt activity-bar section. Onboarding welcome fixed to render when unbound; LSP launch hardened to the `process.execPath` + `ELECTRON_RUN_AS_NODE` stdio form.
- [x] 5.4 Desktop `VoltIdeHeader` renders the shared `healthDisplay`; single `session.tsx` seam unchanged (full desktop-app run deferred, no code path left unverified by typecheck).
- [x] 5.5 Grep confirms no per-surface health→label re-derivation remains outside `volt-control` (the `HealthDot` inline is gone; VS Code status bar + views render `aggregate`/`healthDisplay`).

## 7. Drop legacy LSP product naming (structuredText/lsp-st → iec)

- [x] 7.1 Rename the manifest's 18 `volt.structuredText.*` config keys → `volt.iec.*`; `lspServer` → `server`.
- [x] 7.2 Update the two references to the old namespace: the `volt-lsp-iec/src/detect-vendor.ts` comment and `docs/twincat-reference/12-global-init-slots.md`.
- [x] 7.3 Fix the stale `lsp-st` reference in `CLAUDE.md:125` (package is `volt-lsp-iec`).
- [x] 7.4 Confirmed via grep: no `structuredText`/`lsp-st` product naming remains; `structured-text` language id and "Structured Text" labels untouched.

## 6. Spec sync

- [x] 6.1 Synced the `editor-surface` delta into `openspec/specs/editor-surface/spec.md` (modified git-axis requirement; removed the two co-location requirements; added dedicated-area / per-view / diagnostics-summary / LSP-config requirements), then archived the change.
