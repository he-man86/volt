# @volt/control

> UI-agnostic core between the `volt` CLI / connector and the two Volt GUIs — one shared driver, two renderers.

Both frontends — `volt-desktop` (the standalone Electron app) and `volt-vscode` (tree views) — go through this package. It spawns the `volt` CLI and parses its `--json` output into typed outcomes, holds the connector session that decides what the bridges serve, tracks per-workspace state, and shapes the presentation models both shells render. **No UI-framework code**: nothing here imports `electron` or `vscode`.

Where a behaviour is shared, it lives here — not in one shell with the other copying it. The two have drifted before (differently-worded outcomes, a connect flow that settled differently), which is why flows like `connectWorkspace` and wordings like `describePull` are exported as whole decisions rather than parts to reassemble.

## Layers

```
bridge/   the only Node/process/HTTP code — the CLI, the connector, the session
state/    the reactive per-workspace tracker (framework-agnostic)
view/     Node-free presentation models both shells render
```

| File | Role |
|---|---|
| `bridge/cli.ts` | resolve the bundled `volt.exe` (`setBundledCli`) and run it (`runVolt`) — text or binary stdout, optional streamed progress |
| `bridge/actions.ts` | the CLI mirror: `fetchStatus`, `pull`/`push`/`build`, `init`/`initFromProject`, `rebind`, `merge{Continue,Abort,Resolve}` + the `enterWorkspace`/`leaveWorkspace` lifecycle |
| `bridge/connector.ts` | the connector `:8550` client + connection predicates (`isServing`, `matchesBinding`, `connectSurface`, `boundStatus`) |
| `bridge/session.ts` | the connector SESSION: declared interests, the one poll, and `onConnectorView` (below) |
| `bridge/gate.ts` | per-workspace mutation gate (`withGate`, `isMutationInFlight`) so a probe can skip our own writes |
| `bridge/health.ts` | `HealthState`/`BridgeHealth` + `readBridgeVendor`/`readBoundProject` (the binding in `.git/volt/config.json`) |
| `state/status.ts` | `VoltStatus` — reactive per-workspace health + drift; plus the shared `settleOutcome` / `connectWorkspace` / `disconnectWorkspace` flows |
| `state/emitter.ts` | tiny `vscode.EventEmitter`-shaped emitter (`.event` / `.fire`), so one tracker serves both shells |
| `state/files.ts` | `isPouFile` source-extension test, `readStateMtime` last-sync time |
| `view/workspace.ts` | `projectWorkspace` — the whole panel view-model (sync mode, drift lists, onboarding) |
| `view/outcomes.ts` | every action's endings, worded ONCE (`describePull`/`Push`/`Merge`/`Connect`/`Disconnect`) + `presentOutcome` |
| `view/display.ts` | health/aggregate → user-facing text (`healthLabel`, `aggregate`) |
| `view/progress.ts` | `formatProgress` — the one progress-frame → `{pct, message}` mapping |
| `view/diff.ts` | `loadDiff`/`lineDiff` — the shared change-diff logic behind both shells' diff views |
| `diagnostics.ts` | headless LSP-diagnostics collector — drives `volt-lsp-iec` directly, filtered to `source: "volt-lsp-iec"` |

## Connection: one clock

The connector is the single aggregator of live IDE state, and `bridge/session.ts` is the single client of it. A frontend declares the projects it is *using* (its interests); the connector reconciles the bridges to match, and a project serves iff some live session wants it. There is no imperative connect/disconnect below this line.

That client owns **the only poll in the product** (~4s: declare + renew + read, in one `POST /session/{id}/sync`), and publishes `onConnectorView` when the view actually **changed**:

- `VoltStatus` derives health (and the IDE-edit hint) from that event — it owns no timer for it.
- Each shell's detected-project list rides the same event — no timer there either.
- While the feed runs, `connectorStatus()` returns its view and issues no request of its own.

Three timers used to read that one value on unsynchronized schedules, so the UI rendered state the client already knew was stale — a connect/disconnect took up to ~8s to show, the project list up to ~14s. **Add a second clock and you get that back.**

Two rules the feed keeps: a sync that fails publishes **no view** (a connector that died must not keep rendering as running, with its last projects still listed and clickable), and a declare answers **once** — no retry loop waiting for the answer to turn favourable. A bridge that isn't ready reports not-connected; the user connects again when it is.

## Cost, and what it buys

`volt status` walks the whole project over the bridge on the IDE's single thread — measured ~9s on a 10 MB CODESYS project, ~1.1s with `--local` (drift only, no IDE walk). So the split matters: connection changes settle through `refreshHealth()` (a projection of the feed's view — no CLI, no IDE traffic), and only genuine content questions pay for `refresh()`. An IDE-side edit raises the `ideChanged` HINT rather than auto-running the walk.

## Commands

Run from `packages/volt-control`:

```bash
bun typecheck    # tsgo --noEmit
bun test         # bun test runner
```

## See also

- [`../volt-desktop/README.md`](../volt-desktop/README.md) — desktop shell renderer
- [`../volt-vscode/README.md`](../volt-vscode/README.md) — VS Code extension renderer
- [`../volt-cli/README.md`](../volt-cli/README.md) — the `volt` CLI + connector this drives
- [`../../CLAUDE.md`](../../CLAUDE.md) — architecture & conventions
