/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * Pure renderer UI (Solid). The volt CLI/bridge work lives in @opencode-ai/volt-control
 * (Node) and reaches the panel via Electron IPC (`window.volt`, see ./ipc) — never imported
 * here at runtime. All Volt desktop UI grows inside this package; packages/app mounts it once
 * via a thin <VoltChanges> wrapper (so the opencode seam carries no Volt logic).
 */
export { VoltChanges } from "./VoltChanges"
export type { VoltBridge } from "./ipc"
