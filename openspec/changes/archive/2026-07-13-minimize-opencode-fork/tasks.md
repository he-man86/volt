Minimize the opencode fork: ship `volt-*` + a config bundle over **stock, user-provided** opencode, configured by
one env var; two lean installers; the forked GUI/binary seams revert to pristine. Full rationale + architecture in
`design.md`.

## Done
- [x] `volt-desktop`: serves stock `opencode serve`'s GUI in a `WebContentsView`; Volt chrome (frameless titlebar +
      collapsible icon rail); IDE panel (IDE Sync / Diagnostics / Bridge) over `volt-control`. Validated against
      upstream opencode 1.17.18.
- [x] Active workspace follows opencode's open project via the `x-opencode-directory` header — no folder picker.
- [x] Diagnostics: headless pull collector in `volt-control` (`collectDiagnostics` via `workspace/diagnostic`).
- [x] Bridge lifecycle control removed from the frontends (connector owns it); dropped `volt.startBridge`,
      `volt-vscode/connector.ts`, and `volt.setup`.
- [x] Proven: opencode loads the Volt LSP + `volt` tool from `OPENCODE_CONFIG_DIR` (verify-lsp / verify-volt-tool +
      a bare-exe live check, all green). `OPENCODE_CONFIG_DIR` is additive; auth is in the data dir (untouched).

## Step 3 — opencode as prerequisite, config via one env var
- [x] Config = **installer-set persistent env vars** `OPENCODE_CONFIG_DIR` + `PATH += bin`, the single mechanism —
      `volt-desktop` spawns `opencode serve` with no per-spawn env (inherits the global env); no `serveEnv`.
- [x] **Stripped `autoupdate` from `volt-config`** — opencode's updater is left entirely alone.
- [x] **Slimmed `volt.exe`** to the PLC CLI only — deleted `src/volt.ts` (the opencode-embedding router) +
      `volt-scripts/build.ts` (mirrored opencode's build); `dist.ts` now compiles `bin.ts` directly. Dropped the
      `opencode` / `@opentui/solid` / `opentui-spinner` deps + the TUI-spinner tree-shake guard.
- [x] `volt-desktop` (and `volt`) resolve `opencode` from PATH (`OPENCODE_BIN` default); graceful "Install opencode"
      panel when absent.

## Step 4 — the two installers
- [ ] **CLI installer** (CORE): volt CLI + LSP + bridge/connector + config; sets the env vars; **no opencode**, no
      Electron. Ship first (simplest artifact).
- [ ] **Desktop installer**: electron-builder assisted NSIS wizard; CORE **+** the shell; **precheck opencode →
      abort if absent**; shared `%LOCALAPPDATA%\Programs\Volt`, **superset of CLI**, single uninstall entry.
- [ ] Connector: started **on-demand by the desktop** (no login-item for v1); **stop → replace → restart** on a Volt
      update.
- [ ] Extension: **not** in the installer — Marketplace.

## Step 5 — shrink the fork surface
- [x] Reverted all 14 forked seams to pristine — `packages/{app,ui,desktop}/*` +
      `packages/opencode/src/{cli/cmd/tui.ts, installation/index.ts}`; dropped `volt-app` (its IDE panel lives
      in `volt-desktop` over `volt-control`); preserved its brand assets into `volt-desktop/assets`.
- [x] Shrank `check-divergence` `ALLOWED_MODIFICATIONS` 18 → 4 near-static seams; flipped the self-tests so the
      reverted GUI/binary edits are violations again. Removed the obsolete `check-volt-integration` guards
      (vite.js channel `define`, tui.ts worker-env seam).
- [x] `check-divergence` clean at 4 seams; compat verifiers green. (Installers = the `distribution` change.)

> Superseded: this change's Step 4 (installers) folded into `extract-clean-repo` + `distribution`. The de-fork
> is proven done — `extract-clean-repo` then removed the opencode source in place. This change is effectively
> complete; the remaining installer work lives in those follow-ons.
