/** @jsxImportSource @opentui/solid */
/**
 * Volt agent home-screen logo — replaces opencode's via the additive `home_logo` slot (rendered with
 * mode="replace" in tui `home.tsx`). Additive: no upstream edit. `fg` accepts a hex string
 * (`Color = RGBA | string`); colors track the Volt theme accent (`.opencode/themes/volt.json`).
 *
 * Scope: this brands the agent's HOME SCREEN. The yargs `scriptName` in help/usage stays "opencode"
 * (that's opencode source — non-additive); branding that would need a documented seam, deferred.
 */
import { TextAttributes } from "@opentui/core"
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const ACCENT = "#E0651F" // Volt orange (theme `accent`)
const MUTED = "#6E665B" // theme `muted`

const ART = [
  "█    █  ▄▀▀▄  █     ▀▛▀",
  "▝▖  ▗▘  █  █  █      █ ",
  " ▝▙▟▘   ▝▄▄▘  █▄▄▄   █ ",
]

function tui(api: TuiPluginApi) {
  api.slots.register({
    slots: {
      home_logo() {
        return (
          <box flexDirection="column">
            {ART.map((line) => (
              <text fg={ACCENT} attributes={TextAttributes.BOLD} selectable={false}>
                {line}
              </text>
            ))}
            <text fg={MUTED} selectable={false}>
              PLC coding agent · CODESYS · TwinCAT
            </text>
          </box>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id: "volt", tui }
export default plugin
