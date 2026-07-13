De-fork opencode: reuse core + GUI pristine, keep only a near-static branded desktop shell. Full seam-by-seam
fate table + edge cases in `design.md`. Each phase is independently verifiable: the app still runs AND
`check-divergence.ts` shrinks. No big-bang.

## Status (2026-07-13) — frontend built, old seams not yet cut over

The **new frontend is built and validated**: `volt-desktop` wraps the **installed** opencode's **served GUI**
(spawn `opencode serve` → load the URL in a `WebContentsView`) — so it needs **no `packages/app`**, no GUI
vendoring. The IDE panel (3 sections over `volt-control`) works against real upstream opencode `1.17.18`.
**Not yet done:** removing the OLD fork seams (`session.tsx` mount, `volt-app`, forked `packages/desktop`, the
`packages/app`/`opencode/src` edits) and shrinking `check-divergence`. So the surface hasn't dropped yet — the
replacement exists, the cutover + seam removal is the remaining work. **All work uncommitted.**

## 0. Confirm + verify preconditions — DONE
- [x] Confirm the fork-boundary principle as plan-of-record (design §Principle). *Refined: wrap the **installed**
      opencode's **served GUI** (`opencode serve` → URL), not `opencode web`/`packages/app`.*
- [x] Edge #6: `volt` binary carries nothing beyond seams #17/#18 (thin router → PLC verbs / opencode in-proc).
- [x] Edge #11: no `window.volt` use in pristine `packages/app` (only `volt-app` + `packages/desktop`).

## 1. IDE-changes view → the desktop FRONTEND (`volt-desktop`, sibling of the VS Code extension)
`volt-desktop` = Volt Electron shell that **wraps the installed opencode's served GUI** and hosts the IDE panel
over `@opencode-ai/volt-control` (the exact layer the extension uses). *The panel was rebuilt fresh over
volt-control (the old `VoltIdePanel` was diff-only + coupled to opencode's `SessionReview`), not relocated.*
- [x] `volt-desktop` package: frameless Volt shell; spawns installed `opencode serve`, parses its URL, loads the
      served GUI in a `WebContentsView`; Volt chrome = titlebar + a collapsible right **icon rail** (drift /
      diagnostics badges + bridge dot) that expands the panel. `main.ts` bundled via `bun build` (imports TS
      volt-control); resolve opencode via `OPENCODE_BIN`.
- [x] IDE panel = **3 sections** over volt-control mirroring the extension's `panel.ts`: **IDE Sync** (drift +
      pull/push/build/refresh header icons), **Diagnostics**, **Bridge** (health/port). Empty states + Init
      (CODESYS/TwinCAT) only.
- [x] Diagnostics: **headless LSP pull-collector** added to volt-control (`collectDiagnostics` via
      `workspace/diagnostic`); ~8.8s/complete on the corpus. See openspec note in [[design]] & memory.
- [x] Active workspace = **the project opencode's GUI is on** (sniff `x-opencode-directory` header / `?directory=`)
      — no folder picker; an `initialized` flag drives the empty states. (`VOLT_WORKSPACE` = dev override.)
- [x] **Clean separation:** bridge *lifecycle* control removed from the frontends → the **connector** owns it.
      Deleted `volt.startBridge`, `volt-vscode/connector.ts`, and the `startBridge` action from `volt-control`'s
      display model. Frontends = observe + sync (pull/push/build) only.
- [ ] Set `OPENCODE_CONFIG_DIR` when `volt-desktop` spawns `opencode serve`, so the wrapped agent gets the ST LSP
      + volt tool + agent/theme (the config-bundle half — not wired in the spike yet).
- [ ] **Cutover + remove OLD seams:** `packages/app/src/pages/session.tsx` (VoltIdePanel mount), `packages/app/
      package.json`, `packages/desktop/src/preload/index.ts` (+ `volt-control` dep) → pristine; **drop `volt-app`**;
      retire the forked `packages/desktop` in favour of `volt-desktop`.
- [ ] Verify parity with the old in-GUI panel; `check-divergence` drops those seams.

## 2. GUI-content seams → pristine — NOT STARTED
- [ ] Build channel: set `OPENCODE_CHANNEL=prod` in the desktop build env; drop `packages/app/vite.js` (edge #4).
- [ ] `volt://`: translate to `opencode://` in the shell main process; drop `packages/app/.../deep-links.ts`
      (edge #3). *(N/B under the wrap model the shell registers `volt://` and forwards to the served GUI.)*
- [ ] Drop `packages/app/index.html` (shell owns the window title).
- [ ] Decide `packages/ui/.../logo.tsx`: keep (1 static in-GUI branding seam) or drop (edge #8).

## 3. opencode-binary seams → pristine (ship stock opencode) — NOT STARTED
- [ ] Env-wrapper `volt`: set `OPENCODE_CONFIG_DIR`/PATH before exec; drop `packages/opencode/src/cli/cmd/tui.ts`;
      verify the TUI shows the LSP enabled (edge #5).
- [ ] Disable opencode self-update in the installed product; the whole bundle updates via our installer; drop
      `packages/opencode/src/installation/index.ts` (edge #7).
- [ ] Replace the compiled `volt.exe` with a pinned **stock opencode** release + the config bundle (edge #6).
      *(Proven viable: `volt-desktop` already wraps npm-installed stock opencode `1.17.18`.)*

## 3b. Two-lane lifecycle — Volt's own installer, opencode self-managed — NOT STARTED
- [ ] Volt installer **chains opencode's online install** (D-provision A); verify it runs silently/headless from
      NSIS; pin a minimum opencode version; reuse a newer one if present (no downgrade).
- [ ] Offline path: clear "needs internet once for opencode" message + retry, not a half-install.
- [ ] Volt updater (electron-updater, Volt feed) updates ONLY the Volt layer — never opencode's files. Confirm
      one updater cache; opencode's self-updater left alone.
- [ ] Uninstall: remove the Volt layer + (opt-in) data root; **offer** to remove the chained opencode (opt-in).
- [ ] Note in `distribution`: its "mirror opencode's CLI distribution machinery / bundle opencode" premise is
      SUPERSEDED — Volt installs its layer + chains opencode; opencode self-distributes.

## 4. Tighten the guard + compat gate — NOT STARTED
- [ ] Shrink `ALLOWED_MODIFICATIONS` in `check-divergence.ts` to the ~9 survivors.
- [ ] Add self-test cases: each removed seam (`session.tsx`, `app/package.json`, `app/index.html`,
      `deep-links.ts`, `app/vite.js`, `tui.ts`, `installation/index.ts`, `preload/index.ts`) is now a violation.
- [ ] Add a per-release compat gate to `sync.ts`: run `verify-lsp` + `verify-volt-tool` + the conformance corpus
      against the pinned stock opencode (edge #10).
- [ ] Full `sync.ts` green; the fresh installer builds + runs; `check-divergence` shows the shrunk surface.
