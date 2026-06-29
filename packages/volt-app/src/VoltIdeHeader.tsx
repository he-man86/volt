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
  const [result, setResult] = createSignal<{ text: string; tone: "ok" | "error" | "info" } | null>(null)
  const bridge = () => (typeof window !== "undefined" ? window.volt : undefined)

  const [status, { refetch: refetchStatus }] = createResource(
    () => props.workspaceRoot,
    async (dir) => await bridge()?.status(dir),
  )

  async function run(verb: "pull" | "push" | "build") {
    const b = bridge()
    if (!b || busy()) return
    setBusy(true)
    setResult({ text: `volt ${verb}…`, tone: "info" })
    try {
      if (verb === "pull") {
        const o = await b.pull(props.workspaceRoot)
        setResult(
          o.kind === "ok"
            ? { text: `Pulled ${o.synced.length} file(s)`, tone: "ok" }
            : o.kind === "conflict"
              ? { text: `${o.paths.length} conflict(s) — resolve with Git, then Pull again`, tone: "error" }
              : { text: o.kind === "refused" ? o.reason : o.message, tone: "error" },
        )
      } else if (verb === "push") {
        const o = await b.push(props.workspaceRoot)
        setResult(
          o.kind === "ok"
            ? { text: `Pushed ${o.items.length} item(s)`, tone: "ok" }
            : { text: o.kind === "rejected" ? o.reason : o.message, tone: "error" },
        )
      } else {
        const r = await b.build(props.workspaceRoot)
        setResult(r.code === 0 ? { text: "Build OK", tone: "ok" } : { text: "Build reported errors", tone: "error" })
      }
      await refetchStatus()
      props.onChanged?.() // push/pull/build changed the outgoing drift — refresh the IDE diff list
    } catch (e) {
      // an IPC rejection (main handler threw) lands here — surface it rather than swallow
      setResult({ text: `volt ${verb} failed: ${e instanceof Error ? e.message : String(e)}`, tone: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class="shrink-0 flex items-center gap-2 pl-3 pr-2 py-1.5 border-b border-border-weaker-base text-12-regular">
        <Show when={!status.loading} fallback={<span class="text-text-weak">Probing IDE…</span>}>
          <HealthDot result={status()} />
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

      {/* Result surface — the header had no room for push rejections (a bridge parse error naming the
          offending item runs long + multi-line). Full-width, wraps, preserves newlines, scrolls if long,
          dismissable; red when the action failed. */}
      <Show when={result()}>
        {(r) => (
          <div
            class="shrink-0 flex items-start gap-2 px-3 py-1.5 border-b border-border-weaker-base text-12-regular"
            style={{ background: r().tone === "error" ? "var(--surface-critical-weak)" : "var(--surface-raised-base)" }}
          >
            <span
              class="flex-1 whitespace-pre-wrap break-words max-h-24 overflow-y-auto"
              style={{ color: r().tone === "error" ? "var(--text-base)" : "var(--text-weak)" }}
            >
              {r().text}
            </span>
            <button
              type="button"
              class="shrink-0 leading-none text-text-weaker hover:text-text-base"
              aria-label="Dismiss"
              onClick={() => setResult(null)}
            >
              ✕
            </button>
          </div>
        )}
      </Show>
    </>
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
