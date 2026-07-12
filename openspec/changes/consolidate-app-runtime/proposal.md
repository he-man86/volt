## Why

The installed product is **one** all-inclusive bundle, but on disk and at runtime it reads like several
independent installs, which is a real maintainability risk:

- **Data is scattered across three brand roots** — opencode's XDG dirs (`~/.local/share/opencode`,
  `~/.config/opencode`, `~/.cache/opencode`, `~/.local/state/opencode`), `Volt` (`%LOCALAPPDATA%\Volt`), and
  `ai.opencode.desktop` (the Electron `appId` — `%APPDATA%\ai.opencode.desktop[.dev]`). No single tree to
  inspect, clean, or debug.
- **Two update mechanisms with two caches (~459 MB)** — the desktop electron-updater *and* opencode's
  in-sidecar self-updater, one opencode-named (`@opencode-aidesktop-updater`), one Volt-named
  (`volt-updater`) — on a single install where only one should win.
- **Stale per-channel cruft** accumulates unbounded — e.g. a 436 MB `.dev` userData, leftover
  `volt-bridge` / `volt-bridge-new` dirs, ~900 MB of opencode session DBs + snapshots with no pruning.
- **No documented runtime model** — the process topology (which process owns what, who talks to whom) is
  undocumented, so every maintainer re-derives it.

The process *boundaries* are mostly sound and are NOT the problem (see `design.md`): the product is genuinely
**two worlds** — a bun/JS agent world and a .NET PLC-bridge world — joined over HTTP, and that split is
load-bearing (bun can't host the IDE COM/reflection the bridges need). The problem is that the **Volt layer was
never unified**: its storage, update path, and lifecycle are fragmented. This change consolidates them without
reinventing opencode's reused core.

## What Changes

- **One data root.** Redirect opencode's XDG dirs + the Electron `userData` + the updater cache to live under a
  single `%LOCALAPPDATA%\Volt\{data,config,cache,state,logs,updater,desktop}` tree — for BOTH the desktop
  sidecar and the terminal CLI (via the launcher env seams that already set `OPENCODE_CONFIG_DIR` /
  `XDG_STATE_HOME`). Uninstall removes exactly one tree; no `opencode` / `ai.opencode.desktop` scatter remains.
  This also resolves the `ai.opencode.desktop` branding leak WITHOUT a risky `appId` migration.
- **One update path.** The all-inclusive install updates only via the desktop electron-updater (Volt's feed),
  which replaces the whole bundle (app + `volt.exe` + bridges + LSP + connector). Disable the redundant opencode
  in-sidecar self-updater for the installed product; a single, Volt-named updater cache under the Volt root.
- **One PLC gateway, documented.** Keep the connector as THE single shared always-on gateway (justified — it
  decouples the bridge from any one frontend). Guarantee no frontend spawns bridges independently; all attach by
  port discovery. Document the two-worlds runtime model as the maintainable reference.
- **Clean lifecycle.** Uninstall wipes all Volt-owned data (+ stale per-channel dirs); add a `volt` maintenance
  command to prune session/snapshot growth and report disk usage per store.
- **No opencode-core changes.** Everything lands through existing fork seams (the `volt` launcher, desktop
  `main/index.ts`, the updater config, the installer NSIS) — purely additive.

## Impact

- Fork seams touched (all already-seamed): desktop `main/index.ts` (userData path + XDG env), the `volt` CLI
  launcher (XDG env), the updater config (cache name + disable in-sidecar self-updater), the installer NSIS
  (uninstall wipe). No new upstream seams.
- **No process-boundary changes** — the boundaries are justified by tech constraints and stay as-is.
- **Migration** — first run after the change optionally migrates existing `~/.local/share/opencode` +
  `ai.opencode.desktop` into the Volt root (decision D5), or accepts a one-time reset.
