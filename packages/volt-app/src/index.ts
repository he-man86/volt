/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * Pure renderer UI (Solid). The volt CLI/bridge work lives in @opencode-ai/volt-control
 * (Node) and reaches this panel via Electron IPC (Phase 3) — never imported here directly.
 * All Volt desktop UI grows inside this package; packages/app mounts it once (one seam).
 */
export { VoltSidebar } from "./VoltSidebar"
