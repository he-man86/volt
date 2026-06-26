import { createSignal } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { VoltPanel } from "./VoltPanel"
import "./ipc" // window.volt augmentation

/**
 * Volt as its own side panel in the opencode session — a sibling of the git/review and
 * file-explorer panels, styled to match them (card chrome, left resize handle, header).
 *
 * Owns ALL panel logic (chrome, width, the VoltPanel content) so the opencode seam is a
 * single mount line in session.tsx. Pure renderer UI — VoltPanel talks to volt-control over
 * Electron IPC (window.volt). Width is local (no layout.tsx seam).
 */
export function VoltSidePanel(props: { workspaceRoot: string }) {
  const [width, setWidth] = createSignal(320)

  return (
    <aside
      id="volt-panel"
      aria-label="Volt"
      class="relative h-full shrink-0 flex overflow-hidden bg-background-base rounded-[10px] shadow-[var(--v2-elevation-raised)]"
      style={{ width: `${width()}px` }}
    >
      <div class="h-full flex-1 min-w-0 flex flex-col overflow-hidden">
        <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-weaker-base">
          <span class="text-text-warning leading-none">⚡</span>
          <span class="text-14-regular text-text-strong">Volt</span>
        </div>
        <div class="flex-1 min-h-0">
          <VoltPanel workspaceRoot={props.workspaceRoot} />
        </div>
      </div>
      <ResizeHandle direction="horizontal" edge="start" size={width()} min={240} max={520} onResize={setWidth} />
    </aside>
  )
}
