import { createSignal, For } from "solid-js"

/**
 * Volt control panel for the opencode desktop app — the volt-vscode UX, in-app.
 *
 * Phase 2 (this): a self-contained Solid skeleton that mounts in packages/app's layout
 * and proves the slot works (renders + reactive). Pure renderer UI — NO volt-control
 * import (that's Node code; it can't run in the browser renderer).
 *
 * Phase 3 (next): the verbs call `volt-control` via Electron IPC (`window.volt.*`),
 * and the status area renders live `fetchStatus()` output (drift list, health badge).
 */
const ACCENT = "#E0651F" // Volt brand orange

const VERBS = ["status", "pull", "push", "build"] as const

export function VoltSidebar() {
  const [last, setLast] = createSignal("")

  return (
    <aside
      data-component="volt-sidebar"
      style={{
        width: "260px",
        "flex-shrink": "0",
        "border-right": "1px solid var(--icon-weak-base, #e2d8c8)",
        display: "flex",
        "flex-direction": "column",
        padding: "12px",
        gap: "10px",
        "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
        "font-size": "13px",
      }}
    >
      <header style={{ display: "flex", "align-items": "center", gap: "8px", "font-weight": "600" }}>
        <span style={{ color: ACCENT, "font-size": "16px" }}>⚡</span>
        <span>Volt</span>
      </header>

      <div style={{ opacity: "0.7" }}>PLC control — drives the volt CLI.</div>

      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
        <For each={VERBS}>
          {(verb) => (
            <button
              type="button"
              onClick={() => setLast(`volt ${verb} — wired in Phase 3 (IPC)`)}
              style={{
                padding: "4px 10px",
                border: `1px solid ${ACCENT}`,
                "border-radius": "6px",
                background: "transparent",
                color: ACCENT,
                cursor: "pointer",
                "text-transform": "capitalize",
              }}
            >
              {verb}
            </button>
          )}
        </For>
      </div>

      <div style={{ "margin-top": "auto", opacity: "0.6", "font-size": "12px" }}>{last() || "Ready."}</div>
    </aside>
  )
}
