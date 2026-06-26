/**
 * @opencode-ai/volt-control — UI-agnostic core that drives the `volt` CLI / bridge.
 *
 * Extracted from `packages/volt-vscode` (Phase 1). No UI-framework code — rendered by
 * `volt-vscode` (VS Code views) and `volt-app` (Solid panel in the opencode desktop app).
 *
 * Phase 1 (done): the pure primitives below. Phase 2 (next): split the UI-agnostic
 * status/command *logic* out of volt-vscode's `state/status.ts` + `commands.ts`.
 */
export * from "./types.js" // ChangeSet, ProjectMismatch, StatusJson, changeCount
export * from "./gate.js" // isMutationInFlight, withGate
export * from "./workspace.js" // isPouFile, readStateMtime
export * from "./cli.js" // setBundledCli, cliScript, spawnVolt, spawnVoltBuffer
export * from "./health.js" // BridgeHealth, HealthState, isBridgeOnline, readBridgePort, readExtensionAccess, probeHealth, healthLabel
export * from "./actions.js" // fetchStatus, pull, push, build, init, mergeCmd, showFile, log, detect + outcome types
export * from "./ipc.js" // registerVoltIpcHandlers (desktop main process) + IpcMainLike
