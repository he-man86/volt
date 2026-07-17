/**
 * @volt/control — the UI-agnostic core between the volt CLI/bridge and the two frontends
 * (`volt-vscode`, `volt-desktop`). No UI-framework code. Three layers:
 *   bridge/ — the CLI + health surface (the only Node/process/HTTP code)
 *   state/  — the reactive per-workspace tracker (framework-agnostic)
 *   view/   — Node-free presentation models both shells render
 */

// bridge/ — talking to the volt CLI + the bridge's /health
export * from "./bridge/cli.js" // setBundledCli, cliScript, runVolt, ProgressUpdate, RunOpts
export * from "./bridge/gate.js" // isMutationInFlight, withGate
export * from "./bridge/health.js" // HealthState, BridgeHealth, isBridgeOnline, readBridgePort, readExtensionAccess, probeHealth, probeVendors, BRIDGE_PORT, vendorPort, vendorForPort
export * from "./bridge/actions.js" // fetchStatus, pull, push, build, init + PullOutcome/PushOutcome

// state/ — the reactive per-workspace tracker
export * from "./state/status.js" // VoltStatus, isIdeChangeEdge
export * from "./state/emitter.js" // Emitter, Disposable (vscode-EventEmitter-shaped)
export * from "./state/files.js" // isPouFile, readStateMtime

// view/ — Node-free presentation models
export * from "./view/types.js" // StatusJson, ChangeSet, ProjectMismatch, changeCount
export * from "./view/display.js" // healthLabel, healthDisplay, aggregate, VoltDisplay, VoltSeverity, WorkspaceState
export * from "./view/workspace.js" // projectWorkspace, WorkspaceView, WorkspaceInput, DriftItem
export * from "./view/outcomes.js" // describePull, describePush, presentOutcome, OutcomePresenter, OutcomeView, OutcomeAction, OutcomeActionTag
export * from "./view/progress.js" // formatProgress — the one frame→{pct,message} mapping both shells render

// headless LSP-diagnostics collector (desktop's Diagnostics section)
export * from "./diagnostics.js" // collectDiagnostics, countDiagnostics
