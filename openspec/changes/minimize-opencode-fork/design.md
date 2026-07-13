# Design — minimize the opencode fork

> The IDE-panel visual is **`mockup.html`** (open in a browser).

## Principle

Volt is **purely additive** over opencode. The product is the `volt-*` packages + a config bundle; **opencode is a
user-provided runtime**, made Volt-aware by one env var. Nothing of opencode's GUI or binary is forked into the
product — the forked `packages/app` / `packages/desktop` / `packages/opencode/src` become pristine and drop out of
what we ship.

## Architecture

```
opencode (user prerequisite, unmodified)
  ├─ serves the agent GUI (`opencode serve` → localhost) and the terminal agent
  └─ made Volt-aware by ONE env var → OPENCODE_CONFIG_DIR
        (LSP registration + volt tool + agent + theme + permissions — merged additively)

Volt layer (installed):
  ├─ volt-desktop   Electron shell: serves opencode's GUI in a WebContentsView + Volt chrome + IDE panel
  ├─ volt CLI       (volt-git) PLC sync: init/pull/push/status/build — no opencode
  ├─ volt-lsp-iec   Structured-Text LSP
  ├─ volt-control   shared UI-agnostic core (status/pull/push/health/diagnostics) — powers both frontends
  ├─ volt-vscode    editor frontend (VS Code Marketplace)
  └─ connector + bridges   the live-IDE wire; owns bridge lifecycle
```

## opencode integration — one env var, additive, safe

- The installer sets two **persistent user env vars**: `OPENCODE_CONFIG_DIR` = `<install>\resources\volt\volt-config`,
  and `PATH += <install>\resources\volt\bin` (so the config's bare-name `volt-lsp-iec` / `volt` resolve). **This is
  the single mechanism** — `volt-desktop` sets nothing per-spawn; the spawned opencode inherits the env.
- **Additive & safe** (verified in `packages/opencode/src/config/config.ts`): opencode always merges the user's own
  global config, and `OPENCODE_CONFIG_DIR` is just an *extra* merged directory. **Auth lives in the data dir**
  (`Global.Path.data/auth.json`), untouched. So the user's settings + provider keys are preserved; Volt's config
  merges on top.
- The config bundle carries LSP registration + volt tool + agent + theme + permissions, and **no `autoupdate`** —
  opencode's update behavior is left entirely to opencode.
- Result: the user's terminal `opencode` **and** the desktop's `opencode serve` are both Volt-flavored with **zero
  manual setup**; uninstall removes the env vars → opencode reverts to vanilla.

## opencode = prerequisite (not bundled, not downloaded)

- The user installs opencode themselves (opencode.ai). Volt never bundles, downloads, updates, or uninstalls it.
- The **Desktop** installer prechecks opencode (`Get-Command opencode`) → **aborts if absent** (no partial install).
  The **CLI** installer does not require it — the PLC tooling works without opencode, and the agent lights up
  automatically if/when opencode is present.
- Future optional convenience (additive, no rework): auto-provision opencode via a direct binary download.

## Two frontends, one core

- `volt-vscode` (native tree views) and `volt-desktop` (Solid/DOM) render the same `volt-control` logic in
  host-native UI — **share the logic, not the pixels**.
- **Bridge lifecycle control is the connector's job**; frontends only observe + sync (pull/push/build). No
  `startBridge` in any frontend.
- **Diagnostics**: `volt-control` drives `volt-lsp-iec` headlessly via `workspace/diagnostic` (one pull → all files) —
  the same diagnostics the extension shows, no editor needed.
- The active workspace **follows opencode's open project** (the desktop reads the GUI's `x-opencode-directory`
  header) — VS Code open-folder semantics, no folder picker.

## Installers — two assisted NSIS wizards, shared home

| | CLI (CORE) | Desktop |
|---|---|---|
| Installs | volt CLI + LSP + bridge/connector + config + env vars | CORE **+** the Electron shell |
| opencode | not required | **required** (precheck → abort) |
| Electron | none | yes |

- Both target `%LOCALAPPDATA%\Programs\Volt`; **Desktop is a strict superset of CLI**; a single uninstall entry
  (installing one detects/supersedes the other; PATH + env changes are idempotent).
- Assisted wizard (`oneClick:false`) — a real Windows installer (welcome / dir / finish + uninstaller), **not**
  opencode's `curl|bash` script.
- The **VS Code extension is Marketplace-distributed** — never sideloaded by the installer (ext ↔ connector
  compatibility rides the `protocolVersion` gate).

## Update / uninstall

- **Volt layer** → electron-updater (Volt feed), one shot; the connector is **stopped → replaced → restarted**
  (a running exe is file-locked).
- **opencode** → its own updater — Volt never touches it.
- **Uninstall** → remove the Volt layer + PATH/env vars + connector; opencode + extension untouched.

## Shrinking the fork

Because the product ships `volt-desktop` over **stock** opencode (not a forked GUI/binary), the seams in
`packages/app`, `packages/desktop`, and `packages/opencode/src` are **no longer used** → revert them to pristine and
shrink `check-divergence` to the `volt-*` surface. End state: the clean standalone `volt` repo (see
`extract-clean-repo`).
