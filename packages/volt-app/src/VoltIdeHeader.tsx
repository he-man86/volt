import { createResource, createSignal, Show, type JSX } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import type { StatusResult } from "@opencode-ai/volt-control"
import "./ipc" // window.volt augmentation

/**
 * The Pull / Push / Build + bridge-health strip shown above the diff list when the desktop changes
 * panel's "IDE" source is selected. The diff list itself is rendered by opencode's review pipeline
 * from `volt diff`; this strip is just the controls + health. Pure renderer: every action calls
 * `window.volt.*` (Electron IPC → volt-control), no volt-control runtime import (types only).
 * Merge-conflict resolution + local git history stay the editor's built-in Git.
 */
export function VoltIdeHeader(props: { workspaceRoot: string; onChanged?: () => void }) {
  const [busy, setBusy] = createSignal(false)
  const [msg, setMsg] = createSignal("")
  const bridge = () => (typeof window !== "undefined" ? window.volt : undefined)

  const [status, { refetch: refetchStatus }] = createResource(
    () => props.workspaceRoot,
    async (dir) => await bridge()?.status(dir),
  )

  async function run(verb: "pull" | "push" | "build") {
    const b = bridge()
    if (!b || busy()) return
    setBusy(true)
    setMsg(`volt ${verb}…`)
    try {
      if (verb === "pull") {
        const o = await b.pull(props.workspaceRoot)
        setMsg(
          o.kind === "ok"
            ? `Pulled ${o.synced.length} file(s)`
            : o.kind === "conflict"
              ? `${o.paths.length} conflict(s) — resolve with Git, then Pull again`
              : o.kind === "refused"
                ? o.reason
                : o.message,
        )
      } else if (verb === "push") {
        const o = await b.push(props.workspaceRoot)
        setMsg(o.kind === "ok" ? `Pushed ${o.items.length} item(s)` : o.kind === "rejected" ? o.reason : o.message)
      } else {
        const r = await b.build(props.workspaceRoot)
        setMsg(r.code === 0 ? "Build OK" : "Build reported errors")
      }
      await refetchStatus()
      props.onChanged?.() // push/pull/build changed the outgoing drift — refresh the IDE diff list
    } catch (e) {
      // an IPC rejection (main handler threw) lands here — surface it rather than swallow
      setMsg(`volt ${verb} failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="shrink-0 flex items-center gap-2 pl-3 pr-2 py-1.5 border-b border-border-weaker-base text-12-regular">
      <Show when={!status.loading} fallback={<span class="text-text-weak">Probing IDE…</span>}>
        <HealthDot result={status()} />
      </Show>
      <Show when={msg()}>
        <span class="truncate max-w-[16rem] text-text-weaker">{msg()}</span>
      </Show>
      <div class="flex-1" />
      <ActionBtn label="Pull (bridge → workspace)" disabled={busy()} onClick={() => run("pull")}>
        <Icon name="arrow-down-to-line" size="small" />
      </ActionBtn>
      <ActionBtn label="Push (workspace → bridge)" disabled={busy()} onClick={() => run("push")}>
        <Icon name="arrow-up" size="small" />
      </ActionBtn>
      <ActionBtn label="Build" disabled={busy()} onClick={() => run("build")}>
        <WrenchIcon />
      </ActionBtn>
      <ActionBtn
        label="Refresh"
        disabled={busy()}
        onClick={() => {
          void refetchStatus()
          props.onChanged?.()
        }}
      >
        <RefreshIcon />
      </ActionBtn>
    </div>
  )
}

/** A title-bar action — a small ghost icon button with a tooltip (VS Code SCM style). */
function ActionBtn(props: { label: string; disabled?: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <IconButtonV2
      type="button"
      variant="ghost"
      size="small"
      class="shrink-0"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      icon={props.children}
    />
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6c0 1-.25 1.97-.7 2.8l1.46 1.46A8 8 0 0 0 12 4Zm0 14a6 6 0 0 1-6-6c0-1 .25-1.97.7-2.8L5.24 7.74A8 8 0 0 0 12 20v3l4-4-4-4Z" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M22.7 19.1 13.6 10a6 6 0 0 0-1.5-6.9A6.4 6.4 0 0 0 4.7 1.8L9 6 6 9 1.7 4.7A6.4 6.4 0 0 0 3 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.4-.3.4-1 0-1.3Z" />
    </svg>
  )
}

function HealthDot(props: { result: StatusResult | undefined }) {
  // inline the kind check — isBridgeOnline lives in a Node module (node:http), unimportable here
  const online = () => {
    const k = props.result?.health.kind
    return k === "connected" || k === "degraded"
  }
  return (
    <span class="inline-flex items-center gap-1.5">
      <span
        class="w-1.5 h-1.5 rounded-full"
        style={{ background: online() ? "var(--icon-diff-add-base)" : "var(--text-error)" }}
      />
      <span>bridge: {online() ? "connected" : (props.result?.error ?? "offline")}</span>
    </span>
  )
}
