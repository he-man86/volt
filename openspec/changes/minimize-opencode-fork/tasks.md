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
- [ ] Config = **installer-set persistent env vars** `OPENCODE_CONFIG_DIR` + `PATH += bin`. The single mechanism —
      **remove `serveEnv()` / per-spawn env from `volt-desktop`** (the spawned opencode inherits the global env).
- [ ] **Strip `autoupdate` from `volt-config`** (leave opencode's updater entirely alone).
- [ ] **Slim `volt.exe`** to the PLC CLI only (no opencode compiled in).
- [ ] `volt-desktop` (and `volt`) resolve `opencode` from PATH; graceful "install opencode" when absent.

## Step 4 — the two installers
- [ ] **CLI installer** (CORE): volt CLI + LSP + bridge/connector + config; sets the env vars; **no opencode**, no
      Electron. Ship first (simplest artifact).
- [ ] **Desktop installer**: electron-builder assisted NSIS wizard; CORE **+** the shell; **precheck opencode →
      abort if absent**; shared `%LOCALAPPDATA%\Programs\Volt`, **superset of CLI**, single uninstall entry.
- [ ] Connector: started **on-demand by the desktop** (no login-item for v1); **stop → replace → restart** on a Volt
      update.
- [ ] Extension: **not** in the installer — Marketplace.

## Step 5 — shrink the fork surface
- [ ] Revert the forked seams to pristine — `packages/app/*`, `packages/desktop/*`,
      `packages/opencode/src/{cli/cmd/tui.ts, installation/index.ts}` — the product no longer ships them
      (`volt-desktop` + stock opencode replace them); drop `volt-app`.
- [ ] Shrink `check-divergence` `ALLOWED_MODIFICATIONS` to the surviving `volt-*` + near-static seams; add
      self-tests that the reverted seams are now violations.
- [ ] `sync.ts` green; both installers build + run; `check-divergence` shows the shrunk surface.
