/** @jsxImportSource @opentui/solid */
/**
 * Volt agent home-screen logo — replaces opencode's via the additive `home_logo` slot (rendered with
 * mode="replace" in tui `home.tsx`). Additive: no upstream edit. `fg` accepts a hex string
 * (`Color = RGBA | string`); colors track the Volt theme accent (`themes/volt.json`).
 *
 * opencode's plugin auto-scan only matches `{plugin,plugins}/*.{ts,js}` (no `.tsx`), so this is loaded by
 * an explicit `plugin` entry in `tui.json` instead. Scope: brands the agent's HOME SCREEN; the yargs
 * `scriptName` in help/usage stays "opencode" (opencode source — non-additive), deferred.
 */
import { TextAttributes } from "@opentui/core"

// Minimal local shapes for opencode's TUI plugin surface — Volt depends on the opencode BINARY at runtime (which
// injects `api` and provides @opentui), not on the @opencode-ai/plugin npm package. We only use slots.register.
type TuiPluginApi = { slots: { register(input: { slots: Record<string, () => unknown> }): void } }
type TuiPluginModule = { tui(api: TuiPluginApi): void }

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
