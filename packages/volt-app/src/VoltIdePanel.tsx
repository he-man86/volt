import { createResource, createSignal, Show } from "solid-js"
import { SessionReview } from "@opencode-ai/session-ui/session-review"
import { VoltIdeHeader } from "./VoltIdeHeader"
import { VoltOnboard } from "./VoltOnboard"
import "./ipc" // window.volt augmentation

/**
 * Self-owned "IDE changes" panel for the desktop app — the live drift between the workspace and the
 * PLC IDE, from `volt diff` over window.volt. Self-contained: owns its detect/diff state and reuses
 * opencode's published `SessionReview` to render the diffs, so the only opencode-side seam is ONE
 * mount line in session.tsx (no interleaving into opencode's changes-source pipeline).
 * Shows the Pull/Push/Build strip + diff list when a Volt workspace is bound; the onboard otherwise.
 */
export function VoltIdePanel(props: {
  workspaceRoot: string
  // ponytail: boundary — matches SessionReview's readFile (path -> FileContent|undefined); `any` dodges the sdk type import
  readFile: (path: string) => Promise<any>
}) {
  const bridge = () => (typeof window !== "undefined" ? window.volt : undefined)
  const [detected, { refetch: refetchDetect }] = createResource(
    () => props.workspaceRoot,
    async (dir) => (await bridge()?.detect(dir)) ?? false,
  )
  const [diffs, { refetch: refetchDiffs }] = createResource(
    () => props.workspaceRoot,
    async (dir) => (await bridge()?.diff(dir)) ?? [],
  )
  const [style, setStyle] = createSignal<"unified" | "split">("unified")

  return (
    <Show
      when={detected()}
      fallback={
        <VoltOnboard
          workspaceRoot={props.workspaceRoot}
          onInitialized={() => {
            void refetchDetect()
            void refetchDiffs()
          }}
        />
      }
    >
      <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <VoltIdeHeader workspaceRoot={props.workspaceRoot} onChanged={() => void refetchDiffs()} />
        <div class="relative flex-1 min-h-0 overflow-hidden">
          <SessionReview
            diffs={(diffs() ?? []) as any} // ponytail: IdeDiff satisfies the runtime diff guard; cast past the sdk diff union
            diffStyle={style()}
            onDiffStyleChange={setStyle}
            readFile={props.readFile}
            empty={
              <div class="h-full flex items-center justify-center text-center text-14-regular text-text-weak">
                In sync with the IDE — no changes to push.
              </div>
            }
          />
        </div>
      </div>
    </Show>
  )
}
