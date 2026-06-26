import { Show } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { voltOpen, hasVolt, toggleVolt } from "./state"

// Volt bolt (same mark as the brand logo). v2 has no bolt icon, so we pass the SVG directly.
const BOLT =
  "M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z"

/** Toggle the Volt side panel — sits in the session header next to the git review toggle. */
export function VoltToggleButton() {
  return (
    <Show when={hasVolt()}>
      <IconButtonV2
        type="button"
        variant="ghost-muted"
        size="large"
        class="!w-9 shrink-0"
        state={voltOpen() ? "pressed" : undefined}
        onClick={toggleVolt}
        aria-label="Toggle Volt"
        aria-expanded={voltOpen()}
        aria-controls="volt-panel"
        icon={
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d={BOLT} />
          </svg>
        }
      />
    </Show>
  )
}
