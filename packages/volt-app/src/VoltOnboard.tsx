import { createResource, createSignal, For, Show, onCleanup } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import type { VendorProbe } from "./ipc"
import "./ipc" // window.volt augmentation

/**
 * Desktop onboarding — mirrors the VS Code SCM welcome. When this folder isn't a bound Volt workspace
 * yet, show an Initialize button for each PLC IDE whose bridge is **live** (with its project name), or
 * nothing if no bridge is connected. On init the workspace binds and the "IDE" changes-source appears.
 * Pure renderer: probe/init go over `window.volt` (Electron IPC → volt-control), no Node import.
 */
export function VoltOnboard(props: { workspaceRoot: string; onInitialized?: () => void }) {
  const bridge = () => (typeof window !== "undefined" ? window.volt : undefined)
  const [probe, { refetch }] = createResource(async () => (await bridge()?.probe()) ?? [])
  const [busy, setBusy] = createSignal(false)

  // poll so a bridge that comes up after mount is picked up (the VS Code side polls every 10s too)
  const timer = setInterval(() => void refetch(), 8000)
  onCleanup(() => clearInterval(timer))

  const live = () => (probe() ?? []).filter((p) => p.state.kind === "connected" || p.state.kind === "degraded")

  const labelOf = (p: VendorProbe): string => {
    const h = "health" in p.state ? p.state.health : undefined
    const ide = h?.ideName ?? (p.vendor === "twincat" ? "TwinCAT" : "CODESYS")
    return `${ide} — ${h?.plcProjectName ?? h?.projectName ?? "(no project)"}`
  }

  async function init(port: number) {
    const b = bridge()
    if (!b || busy()) return
    setBusy(true)
    try {
      await b.init(props.workspaceRoot, port)
      props.onInitialized?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={live().length > 0}>
      <div class="shrink-0 flex flex-col gap-2 px-4 py-3 border-b border-border-weaker-base text-12-regular">
        <div class="text-text-weak">Sync a live PLC project with Volt:</div>
        <For each={live()}>
          {(p) => (
            <Button size="small" disabled={busy()} onClick={() => void init(p.port)}>
              {busy() ? "Initializing…" : `Initialize — ${labelOf(p)}`}
            </Button>
          )}
        </For>
      </div>
    </Show>
  )
}
