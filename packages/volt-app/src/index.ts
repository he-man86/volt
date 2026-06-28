/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * Pure renderer UI (Solid). The volt CLI/bridge work lives in @opencode-ai/volt-control
 * (Node) and reaches the UI via Electron IPC (`window.volt`, see ./ipc) — never imported
 * here at runtime. opencode renders <VoltIdeHeader> above the diff list when the session
 * changes panel's "IDE" source is selected (the seam); all the UI lives here.
 */
export { VoltIdeHeader } from "./VoltIdeHeader"
export { VoltOnboard } from "./VoltOnboard"
export type { VoltBridge, IdeDiff } from "./ipc"
