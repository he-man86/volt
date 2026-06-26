import { createEffect, createSignal, Show, type JSX } from "solid-js"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { VoltPanel } from "./VoltPanel"
import "./ipc" // window.volt augmentation

/**
 * The Git↔Volt switch for opencode's changes panel.
 *
 * Owns ALL Volt logic (mode, .volt detection, the toggle, the panel) so the opencode seam
 * stays a thin additive wrapper: `session-side-panel.tsx` only hands us the workspace dir and
 * a render-prop for its own Git view. Default = Volt when a `.volt` workspace is present.
 *
 * The toggle is opencode's native `SegmentedControlV2` (the v2 component set the new layout
 * uses) — so it looks/behaves like a first-class control, not a bolt-on.
 */
type Mode = "volt" | "git"

export function VoltChanges(props: { workspaceRoot: string; git: () => JSX.Element }) {
  const [mode, setMode] = createSignal<Mode>("git")
  createEffect(() => {
    const dir = props.workspaceRoot
    window.volt?.detect(dir).then((has) => has && setMode("volt"))
  })

  return (
    <div class="h-full min-h-0 flex flex-col">
      <div class="px-3 pt-2.5 pb-1 shrink-0">
        <SegmentedControlV2 class="w-full" value={mode()} onChange={(v) => v && setMode(v as Mode)}>
          <SegmentedControlItemV2 value="volt">Volt</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="git">Git</SegmentedControlItemV2>
        </SegmentedControlV2>
      </div>
      <div class="flex-1 min-h-0">
        <Show when={mode() === "volt"} fallback={props.git()}>
          <VoltPanel workspaceRoot={props.workspaceRoot} />
        </Show>
      </div>
    </div>
  )
}
