/**
 * @volt/control — the UI-agnostic core that drives the `volt` CLI / bridge.
 *
 * No UI-framework code: it spawns the CLI, parses `--json` output into typed outcomes, probes bridge
 * health, collects diagnostics, and owns the desktop IPC channel names. Rendered by both frontends —
 * `volt-vscode` (VS Code views) and `volt-desktop` (the Electron shell wrapping installed opencode).
 */
export * from "./types.js" // ChangeSet, ProjectMismatch, StatusJson, changeCount
export * from "./gate.js" // isMutationInFlight, withGate
export * from "./workspace.js" // isPouFile, readStateMtime
export * from "./cli.js" // setBundledCli, cliScript, spawnVolt, spawnVoltBuffer
export * from "./health.js" // BridgeHealth, HealthState, isBridgeOnline, readBridgePort, readExtensionAccess, probeHealth, probeVendors
export * from "./display.js" // healthLabel, healthDisplay, aggregate, VoltDisplay, VoltSeverity, WorkspaceState (Node-free; also /display subpath)
export * from "./actions.js" // fetchStatus, pull, push, build, init, showFile, detect + outcome types
export * from "./events.js" // subscribeChanges (polls /refs to detect IDE edits)
export * from "./ipc.js" // registerVoltIpcHandlers (desktop main process) + IpcMainLike
export * from "./emitter.js" // Emitter, Disposable — framework-agnostic (vscode-EventEmitter-shaped)
export * from "./status-tracker.js" // VoltStatus — the reactive per-workspace IDE-changes state (extension + desktop share it)
export * from "./diagnostics.js" // collectDiagnostics — headless LSP-diagnostics collector (desktop's Diagnostics section)
