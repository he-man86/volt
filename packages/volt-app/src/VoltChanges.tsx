import { createEffect, createSignal, For, Show, type JSX } from "solid-js"
import { VoltPanel } from "./VoltPanel"
import "./ipc" // window.volt augmentation

/**
 * The Git↔Volt switch for opencode's changes panel.
 *
 * This owns ALL Volt logic (mode signal, .volt detection, the toggle UI, the panel) so the
 * opencode seam stays a thin wrapper: `session-side-panel.tsx` only hands us the workspace
 * directory and a render-prop for its own Git view. Default = Volt when a `.volt` workspace
 * is present, else Git. Changing any Volt UX here touches zero opencode code.
 */
const ACCENT = "#E0651F" // brand orange

export function VoltChanges(props: { workspaceRoot: string; git: () => JSX.Element }) {
  const [volt, setVolt] = createSignal(false)
  createEffect(() => {
    const dir = props.workspaceRoot
    window.volt?.detect(dir).then((has) => has && setVolt(true))
  })

  return (
    <div class="h-full flex flex-col min-h-0">
      <div style={{ display: "flex", gap: "4px", padding: "8px 10px 0", "flex-shrink": "0" }}>
        <For each={[true, false]}>
          {(m) => (
            <button
              type="button"
              onClick={() => setVolt(m)}
              style={{
                padding: "3px 12px",
                "border-radius": "6px",
                cursor: "pointer",
                border: "1px solid transparent",
                "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
                background: volt() === m ? ACCENT : "transparent",
                color: volt() === m ? "#fff" : "inherit",
                opacity: volt() === m ? "1" : "0.7",
              }}
            >
              {m ? "Volt" : "Git"}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 min-h-0">
        <Show when={volt()} fallback={props.git()}>
          <VoltPanel workspaceRoot={props.workspaceRoot} />
        </Show>
      </div>
    </div>
  )
}
