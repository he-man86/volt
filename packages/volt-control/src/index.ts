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
export * from "./bridge/health.js" // HealthState, BridgeHealth, isBridgeOnline, healthOf, readBridgeVendor, VENDORS, Vendor
export * from "./bridge/connector.js" // connectorStatus, detectedProjects, boundStatus, matchesBinding, isServing, connectSurface, DetectedProject, ConnectorView
export * from "./bridge/actions.js" // fetchStatus, pull, push, build, init, initFromProject, merge{Continue,Abort,Resolve}, firstLine + Pull/Push/MergeOutcome
// The connector feed — the product's ONE live-connection clock. Everything else in the session client is internal
// (actions.ts wraps it as enterWorkspace/leaveWorkspace), so only these two are public.
export { startConnectorFeed, onConnectorView } from "./bridge/session.js"

// state/ — the reactive per-workspace tracker
export * from "./state/status.js" // VoltStatus, isIdeChangeEdge, settleOutcome, connect/disconnectWorkspace
export * from "./state/emitter.js" // Emitter, Disposable (vscode-EventEmitter-shaped)
export * from "./state/files.js" // isPouFile, readStateMtime

// view/ — Node-free presentation models
export * from "./view/types.js" // StatusJson, ChangeSet, ProjectMismatch, changeCount
export * from "./view/display.js" // healthLabel, healthDisplay, aggregate, VoltDisplay, VoltSeverity, WorkspaceState
export * from "./view/workspace.js" // projectWorkspace, syncMode, onboardingMode, WorkspaceView, WorkspaceInput, DriftItem
export * from "./view/outcomes.js" // describePull, describePush, describeMerge, presentOutcome, FINISH_MERGE, ABORT_MERGE, OutcomeView, OutcomeAction, OutcomeActionTag
export * from "./view/progress.js" // formatProgress — the one frame→{pct,message} mapping both shells render
export * from "./view/diff.js" // loadDiff, lineDiff, FileDiff, DiffLine, DiffDirection — shared change-diff logic

// the shared log store (same folder + line format as the connector's own log)
export * from "./log.js" // voltLog, VOLT_LOG_DIR, LogSource

// headless LSP-diagnostics collector (desktop's Diagnostics section)
export * from "./diagnostics.js" // collectDiagnostics, countDiagnostics, describeDiagnostics
