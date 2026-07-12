De-fork opencode: reuse core + GUI pristine, keep only a near-static branded desktop shell. Full seam-by-seam
fate table + edge cases in `design.md`. Each phase is independently verifiable: the app still runs AND
`check-divergence.ts` shrinks. No big-bang.

## 0. Confirm + verify preconditions
- [ ] Confirm the fork-boundary principle as plan-of-record (design §Principle).
- [ ] Edge #6: verify the `volt` binary carries NOTHING beyond seams #17/#18 (the "PLC dispatcher" is config,
      not compiled code) — if it does, log the extra scope before proceeding.
- [ ] Edge #11: grep the pristine app for any `window.volt` use beyond the IDE panel.

## 1. IDE panel → the connector
- [ ] **1.0 Workspace registry (foundation, edge #1)** — `volt-git` writes a machine-local reverse index
      `%LocalAppData%\Volt\workspaces.json` (`port/project → workspaceRoot`) on every bridge-touching command;
      validated + pruned. A reader the connector uses to resolve the workspace for its live IDE. *(In progress.)*
- [ ] Build the connector's IDE-changes view (reuse the `VoltIdePanel` component in a WebView2, or native): files
      changed in the IDE vs git, merge-safety warning, empty states (edge #2).
- [ ] Connector runs pull/push via a bundled `volt-git` against the workspace bound in `.git/volt` (edge #1).
- [ ] Access: tray entry now; optional shell titlebar button later (edge #9). No VS Code dependency.
- [ ] Remove seams: `packages/app/src/pages/session.tsx`, `packages/app/package.json`,
      `packages/desktop/src/preload/index.ts` (+ `volt-control` dep in `desktop/package.json`) → pristine.
- [ ] Verify parity with the old in-GUI panel; `check-divergence` drops those seams.

## 2. GUI-content seams → pristine
- [ ] Build channel: set `OPENCODE_CHANNEL=prod` in the desktop build env; drop `packages/app/vite.js` (edge #4).
- [ ] `volt://`: translate to `opencode://` in the shell main process; drop `packages/app/.../deep-links.ts`
      (edge #3).
- [ ] Drop `packages/app/index.html` (shell owns the window title).
- [ ] Decide `packages/ui/.../logo.tsx`: keep (1 static in-GUI branding seam) or drop (edge #8).

## 3. opencode-binary seams → pristine (ship stock opencode)
- [ ] Env-wrapper `volt`: set `OPENCODE_CONFIG_DIR`/PATH before exec; drop `packages/opencode/src/cli/cmd/tui.ts`;
      verify the TUI shows the LSP enabled (edge #5).
- [ ] Disable opencode self-update in the installed product; the whole bundle updates via our installer; drop
      `packages/opencode/src/installation/index.ts` (edge #7).
- [ ] Replace the compiled `volt.exe` with a pinned **stock opencode** release + the config bundle (edge #6).

## 3b. Two-lane lifecycle — Volt's own installer, opencode self-managed (design §Target lifecycle)
- [ ] Volt installer **chains opencode's online install** (D-provision A); verify it runs silently/headless from
      NSIS; pin a minimum opencode version; reuse a newer one if present (no downgrade).
- [ ] Offline path: clear "needs internet once for opencode" message + retry, not a half-install.
- [ ] Volt updater (electron-updater, Volt feed) updates ONLY the Volt layer — never opencode's files. Confirm
      one updater cache; opencode's self-updater left alone.
- [ ] Uninstall: remove the Volt layer + (opt-in) data root; **offer** to remove the chained opencode (opt-in).
- [ ] Note in `distribution`: its "mirror opencode's CLI distribution machinery / bundle opencode" premise is
      SUPERSEDED — Volt installs its layer + chains opencode; opencode self-distributes.

## 4. Tighten the guard + compat gate
- [ ] Shrink `ALLOWED_MODIFICATIONS` in `check-divergence.ts` to the ~9 survivors.
- [ ] Add self-test cases: each removed seam (`session.tsx`, `app/package.json`, `app/index.html`,
      `deep-links.ts`, `app/vite.js`, `tui.ts`, `installation/index.ts`, `preload/index.ts`) is now a violation.
- [ ] Add a per-release compat gate to `sync.ts`: run `verify-lsp` + `verify-volt-tool` + the conformance corpus
      against the pinned stock opencode (edge #10).
- [ ] Full `sync.ts` green; the fresh installer builds + runs; `check-divergence` shows the shrunk surface.
