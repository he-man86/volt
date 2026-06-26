import { createSignal } from "solid-js"

/**
 * Shared open-state for the Volt side panel. Lives here (not opencode's layout.tsx) so the
 * toggle button (session header) and the panel (session.tsx) stay in sync WITHOUT an extra
 * upstream seam — a module-level signal is a single shared instance.
 */
const [voltOpen, setVoltOpen] = createSignal(true)

export { voltOpen }

export function toggleVolt(): void {
  setVoltOpen((v) => !v)
}
