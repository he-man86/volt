## Why

Volt has to be **installable on Windows** — one install that covers both the desktop app and terminal use —
over the user's own opencode, with **auto-update built in**. Today only hand-compiled binaries exist: no clean
install, no env-var wiring, no uninstall, no update path. This blocks shipping Volt. (VOLT-PLAN phase **B**.)

> **This is the single home for installer work.** It supersedes the abandoned "bundle *our own* opencode build"
> model *and* the interim two-NSIS-lane model, and folds in the still-live installer items from
> `minimize-opencode-fork` (Step 4) and `extract-clean-repo` (§3) — both archived. Current truth, matching the
> code: opencode is a **user-provided, optional** runtime (never bundled/downloaded/updated by Volt), and Volt
> ships **one Velopack installer** whose **always-running C# connector drives auto-update**.

## What Changes

**ONE Windows installer for all Volt apps** (desktop GUI + `volt` CLI on PATH + `volt-lsp-iec` LSP + the tray
connector + `volt-config`) — **not** the VS Code extension (Marketplace-only). Per-user, `%LocalAppData%\Volt`.

- **Auto-update is driven by the always-running C# connector** (the one process alive in every configuration —
  the Electron window may never be opened), using **Velopack** (the standard .NET installer+updater). The
  connector checks `he-man86/volt`, downloads deltas, and stages them for its next restart. `vpk pack` produces
  the one installer; **no hand-rolled update logic, no electron-updater** (which only checks when the GUI is
  open).
- **opencode is optional** — no install-time gate; if absent the desktop shows an "install opencode for the
  agent" panel and the PLC tools work regardless. Volt **never** touches opencode's own updater.

The env wiring (`OPENCODE_CONFIG_DIR` + PATH) moves into the connector's Velopack install hooks (C#), retiring
the NSIS/PowerShell installer entirely.

## Capabilities

### Modified Capabilities
- (none — packaging / release infra; no spec-level requirement change.)

## Impact

Additive. The payload is already produced by `bun run dist` → `dist/volt/`
(`bin/` · `connector/` · `volt-config/` · `docs/`). The installers just wrap that folder + wire env/lifecycle.
No opencode source, no fork seams. Inputs still needed for later: a Windows code-signing cert (shipping
**unsigned for now**), Marketplace publisher token.
