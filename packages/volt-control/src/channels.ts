/**
 * Volt IPC channel names — the single source of truth shared by the desktop main handlers
 * (registerVoltIpcHandlers) and the sandboxed preload bridge.
 *
 * Node-free (no imports) so the **sandboxed** Electron preload can import it via the
 * `@opencode-ai/volt-control/channels` subpath WITHOUT pulling volt-control's CLI/Node code
 * (which a sandboxed preload can't load).
 */
export const VOLT_CHANNELS = {
  detect: "volt:detect",
  status: "volt:status",
  pull: "volt:pull",
  push: "volt:push",
  build: "volt:build",
  show: "volt:show",
  diff: "volt:diff",
  probe: "volt:probe",
  init: "volt:init",
} as const
