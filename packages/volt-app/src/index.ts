/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * Pure renderer UI (Solid). The volt CLI/bridge work lives in @opencode-ai/volt-control
 * (Node) and reaches the UI via Electron IPC (`window.volt`, see ./ipc) — never imported
 * here at runtime. opencode mounts <VoltIdePanel> once in the session view (the only seam); the
 * panel owns its detect/diff state and reuses opencode's SessionReview to render — all UI lives here.
 */
export { VoltIdePanel } from "./VoltIdePanel"
export { VoltIdeHeader } from "./VoltIdeHeader"
export { VoltOnboard } from "./VoltOnboard"
export type { VoltBridge, IdeDiff } from "./ipc"
