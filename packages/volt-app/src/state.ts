import { createSignal } from "solid-js"

/**
 * Shared state for the Volt side panel. Lives here (not opencode's layout.tsx) so the toggle
 * button (session header) and the panel (session.tsx) stay in sync WITHOUT an extra upstream
 * seam — a module-level signal is a single shared instance.
 *
 * - voltOpen: the user's show/hide toggle.
 * - hasVolt: whether the open project is a `.volt` workspace (set by VoltSidePanel's detect).
 *   Both the panel and the header button hide entirely when false (non-PLC projects).
 */
const [voltOpen, setVoltOpen] = createSignal(true)
const [hasVolt, setHasVolt] = createSignal(false)

export { voltOpen, hasVolt, setHasVolt }

export function toggleVolt(): void {
  setVoltOpen((v) => !v)
}
