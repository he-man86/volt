# @opencode-ai/volt-control

> UI-agnostic core that drives the `volt` CLI / bridge — one shared driver behind both Volt GUIs.

The shared CLI/bridge driver plus the Electron IPC layer that sits behind the two Volt GUIs. It spawns the bundled `volt` CLI, parses its `--json` output into typed outcomes, probes bridge health, and exposes the IPC contract — with **no UI-framework code**, so it can be rendered by both the desktop panel (`volt-app`) and the VS Code extension (`volt-vscode`).

## Role in Volt

volt-control is the layer **below** the GUIs. Both renderers — `volt-app` (the Solid panel in the opencode desktop app) and `volt-vscode` (VS Code tree views) — go through it; it drives the `volt` binary (`@opencode-ai/volt-git`), parses its output, and owns the channel names that define the desktop IPC contract. **One shared core, two renderers.** It is distinct from `volt-git`: that package *is* the CLI binary, while this one *spawns and parses* it.

The package is Node-bound (it spawns child processes and reads files), so the desktop main process imports the full package. The `/channels` subpath is deliberately **Node-free** (zero imports) so the **sandboxed** Electron preload can import the channel names without pulling in any CLI/Node code it can't load.

## How it works

**Actions (`actions.ts`)** — the CLI-mirror. Each function shells out to the bundled CLI and returns data or a typed outcome; the caller owns spinners and dialogs:

- `fetchStatus` — reads the bridge port from `.git/volt/config.json`, probes `/health`, then runs `volt status --json` and returns `{ status, health, error? }`.
- `pull` / `push` — run `volt pull|push [--force] --json` and parse the `PullOutcome` / `PushOutcome` union (ok / refused|rejected / conflict / error).
- `build` / `init` / `showFile` — `volt build|init|show`; raw CLI result (or buffer for `show`'s bytes).
  (`volt merge`/`log` stay CLI/agent verbs — no GUI wrapper, since history + conflict resolution delegate to the editor's Git.)
- `detect` — cheap check for an initialized workspace (does `.git/volt/config.json` carry a bridge port), no bridge probe.

Mutating actions (`pull`/`push`/`init`) take a per-workspace mutation gate (`gate.ts`: `withGate` / `isMutationInFlight`) so a concurrent health probe can skip, and release it before returning so outcome dialogs never hold the lock.

**IPC (`ipc.ts`)** — `registerVoltIpcHandlers(ipcMain, cliPath?)` is called once from the desktop main process. It calls `setBundledCli(cliPath)` then registers one handler per channel (`detect`/`status`/`pull`/`push`/`build`/`show`) as a thin pass-through to the actions; the renderer passes the workspace dir on every call. `IpcMainLike` keeps the package free of an `electron` dependency.

**Channels (`channels.ts`)** — `VOLT_CHANNELS` is the single source of truth for the channel names (`volt:detect`, `volt:status`, …) shared by the main-process handlers and the preload bridge.

**CLI spawning (`cli.ts`)** — `setBundledCli` pins the CLI shipped inside the host (so a PLC workspace needs no Node toolchain or `node_modules/.bin/volt`); `cliScript` falls back to the workspace's installed `volt-git`. `spawnVolt` / `spawnVoltBuffer` run it as a Node script via the editor's own runtime (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so it works under VS Code, Cursor, Windsurf, or Electron with no external node.

**Health & workspace (`health.ts`, `workspace.ts`)** — `probeHealth` GETs `/health` on `127.0.0.1:<port>` and maps it to a `HealthState` (connected / degraded / disconnected / unreachable); `readBridgePort` / `readExtensionAccess` read `.git/volt/config.json`; `healthLabel` renders a one-line status. `isPouFile` classifies editable source extensions and `readStateMtime` reads the IDE baseline mtime (`.git/volt/ide-refs.json`) for last-sync time.

## Commands

Run from `packages/volt-control`:

```bash
bun typecheck    # tsgo --noEmit
```

```bash
bun test         # bun test runner (gate + workspace-detection tests)
```

## Layout

| File | Role |
|---|---|
| `actions.ts` | UI-agnostic actions over the CLI (`fetchStatus`/`pull`/`push`/`build`/`init`/`showFile`/`detect`) + outcome contracts |
| `ipc.ts` | `registerVoltIpcHandlers` — wires the actions over Electron IPC; `IpcMainLike` |
| `channels.ts` | `VOLT_CHANNELS` — Node-free channel-name source of truth (the `/channels` subpath) |
| `cli.ts` | Bundled-CLI resolution + `spawnVolt` / `spawnVoltBuffer` child-process spawning |
| `health.ts` | Bridge `/health` probe, `HealthState`, port/extension-access config reads, `healthLabel` |
| `workspace.ts` | `isPouFile` source-extension test, `readStateMtime` last-sync time |
| `gate.ts` | Per-workspace mutation gate (`withGate`, `isMutationInFlight`) |
| `types.ts` | `StatusJson`, `ChangeSet`, `ProjectMismatch`, `changeCount` |
| `index.ts` | Public API barrel (full package); `/channels` subpath is separate |

## See also

- [`../volt-app/README.md`](../volt-app/README.md) — desktop panel renderer
- [`../volt-vscode/README.md`](../volt-vscode/README.md) — VS Code extension renderer
- [`../volt-git/README.md`](../volt-git/README.md) — the `volt` CLI this drives
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — D4: one shared core, two renderers
- [`../../CLAUDE.md`](../../CLAUDE.md) — fork architecture & conventions
