/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * Pure renderer UI (Solid). The volt CLI/bridge work lives in @opencode-ai/volt-control
 * (Node) and reaches the panel via Electron IPC (`window.volt`, see ./ipc) — never imported
 * here at runtime. All Volt desktop UI grows inside this package; opencode mounts the panel
 * (<VoltSidePanel>) and its header toggle (<VoltToggleButton>) with one line each.
 */
export { VoltSidePanel } from "./VoltSidePanel"
export { VoltToggleButton } from "./VoltToggleButton"
export type { VoltBridge } from "./ipc"
