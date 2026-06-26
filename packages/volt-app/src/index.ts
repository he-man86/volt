/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * Pure renderer UI (Solid). The volt CLI/bridge work lives in @opencode-ai/volt-control
 * (Node) and reaches the panel via Electron IPC (`window.volt`, see ./ipc) — never imported
 * here at runtime. All Volt desktop UI grows inside this package; opencode mounts the whole
 * panel with a single <VoltSidePanel> line (so the seam carries no Volt logic).
 */
export { VoltSidePanel } from "./VoltSidePanel"
export type { VoltBridge } from "./ipc"
