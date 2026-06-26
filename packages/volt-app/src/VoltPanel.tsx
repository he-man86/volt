import { createResource, createSignal, For, Show, Switch, Match } from "solid-js"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Accordion } from "@opencode-ai/ui/accordion"
import { Icon } from "@opencode-ai/ui/icon"
import type { ChangeSet, StatusResult } from "@opencode-ai/volt-control"
import "./ipc" // window.volt augmentation

/**
 * Volt control panel — the volt-vscode SCM + Sync-history UX, in the opencode desktop app.
 * Rendered inside VoltSidePanel (Volt's own session column). Pure renderer UI: every action
 * calls `window.volt.*` (Electron IPC → volt-control). No volt-control import (types only).
 *
 * Visually mirrors opencode's review panel (session-review): FileIcon + dim-directory /
 * strong-filename + a colored change label, history as an Accordion. Same `--icon-diff-*`
 * colors and v2 tokens.
 * v1 scope: Status + History. Inline diffs, merge resolution, force, drift = fast-follow.
 */
const CHANGE = {
  added: { label: "Added", color: "var(--icon-diff-add-base)" },
  modified: { label: "Modified", color: "var(--icon-diff-modified-base)" },
  removed: { label: "Removed", color: "var(--icon-diff-delete-base)" },
  conflict: { label: "Conflict", color: "var(--icon-diff-delete-base)" },
} as const

type Kind = keyof typeof CHANGE
type Sub = "status" | "history"
type Row = { path: string; kind: Kind }

function rowsOf(set: ChangeSet | undefined): Row[] {
  if (!set) return []
  return [
    ...set.added.map((path) => ({ path, kind: "added" as const })),
    ...set.modified.map((path) => ({ path, kind: "modified" as const })),
    ...set.removed.map((path) => ({ path, kind: "removed" as const })),
  ]
}

export function VoltPanel(props: { workspaceRoot: string }) {
  const [sub, setSub] = createSignal<Sub>("status")
  const [busy, setBusy] = createSignal(false)
  const [msg, setMsg] = createSignal("")

  const bridge = () => (typeof window !== "undefined" ? window.volt : undefined)

  const [status, { refetch: refetchStatus }] = createResource(
    () => props.workspaceRoot,
    async (dir) => await bridge()?.status(dir),
  )
  const [history] = createResource(
    () => (sub() === "history" ? props.workspaceRoot : undefined),
    async (dir) => (await bridge()?.log(dir, { limit: 50 })) ?? [],
  )

  async function run(verb: "pull" | "push" | "build") {
    const b = bridge()
    if (!b || busy()) return
    setBusy(true)
    setMsg(`volt ${verb}…`)
    try {
      if (verb === "pull") {
        const o = await b.pull(props.workspaceRoot)
        setMsg(o.kind === "ok" ? `Pulled ${o.synced.length} file(s)` : o.kind === "conflict" ? `${o.paths.length} conflict(s) — resolve in the IDE` : o.kind === "refused" ? o.reason : o.message)
      } else if (verb === "push") {
        const o = await b.push(props.workspaceRoot)
        setMsg(o.kind === "ok" ? `Pushed ${o.items.length} item(s)` : o.kind === "rejected" ? o.reason : o.message)
      } else {
        const r = await b.build(props.workspaceRoot)
        setMsg(r.code === 0 ? "Build OK" : "Build reported errors")
      }
      await refetchStatus()
    } finally {
      setBusy(false)
    }
  }

  const merging = () => status()?.status?.merging ?? null
  const incoming = () => rowsOf(status()?.status?.incoming)
  const outgoing = () => rowsOf(status()?.status?.outgoing)
  const inSync = () => !!status()?.status && !merging() && incoming().length === 0 && outgoing().length === 0

  return (
    <div class="h-full min-h-0 flex flex-col text-12-regular">
      <div class="px-3 pb-2 shrink-0">
        <SegmentedControlV2 class="w-full" value={sub()} onChange={(v) => v && setSub(v as Sub)}>
          <SegmentedControlItemV2 value="status">Status</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="history">History</SegmentedControlItemV2>
        </SegmentedControlV2>
      </div>

      <Switch>
        <Match when={!bridge()}>
          <div class="px-3 py-2 text-text-weak">Volt is available in the desktop app.</div>
        </Match>

        {/* ── Status ── */}
        <Match when={sub() === "status"}>
          <div class="px-3 pb-2 shrink-0 flex flex-wrap gap-1.5">
            <ButtonV2 size="small" variant="neutral" disabled={busy()} onClick={() => run("pull")}>Pull</ButtonV2>
            <ButtonV2 size="small" variant="neutral" disabled={busy()} onClick={() => run("push")}>Push</ButtonV2>
            <ButtonV2 size="small" variant="ghost" disabled={busy()} onClick={() => run("build")}>Build</ButtonV2>
            <ButtonV2 size="small" variant="ghost" disabled={busy()} onClick={() => refetchStatus()}>Refresh</ButtonV2>
          </div>

          <div class="px-3 py-1.5 text-text-weak shrink-0 border-b border-border-weaker-base">
            <Show when={!status.loading} fallback={<span>Probing IDE…</span>}>
              <HealthDot result={status()} />
            </Show>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show when={merging()}>
              <GroupHeader label="Merge" count={merging()!.conflicts.length} />
              <For each={merging()!.conflicts}>{(c) => <FileRow path={c.path} kind="conflict" />}</For>
            </Show>
            <Show when={incoming().length > 0}>
              <GroupHeader label="Incoming" count={incoming().length} />
              <For each={incoming()}>{(r) => <FileRow path={r.path} kind={r.kind} />}</For>
            </Show>
            <Show when={outgoing().length > 0}>
              <GroupHeader label="Changes" count={outgoing().length} />
              <For each={outgoing()}>{(r) => <FileRow path={r.path} kind={r.kind} />}</For>
            </Show>
            <Show when={inSync()}>
              <div class="px-3 py-3 text-text-weaker">In sync with the IDE.</div>
            </Show>
            <Show when={msg()}>
              <div class="px-3 py-2 text-text-weak">{msg()}</div>
            </Show>
          </div>
        </Match>

        {/* ── History ── */}
        <Match when={sub() === "history"}>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show when={!history.loading} fallback={<div class="px-3 py-3 text-text-weak">Loading…</div>}>
              <Show when={(history()?.length ?? 0) > 0} fallback={<div class="px-3 py-3 text-text-weaker">No sync history yet.</div>}>
                <Accordion multiple>
                  <For each={history()}>
                    {(entry) => (
                      <Accordion.Item value={entry.sha}>
                        <Accordion.Header>
                          <Accordion.Trigger class="group/row w-full flex items-center gap-2 h-8 px-3 text-left hover:bg-[var(--v2-overlay-simple-overlay-hover)]">
                            <Icon name="chevron-down" size="small" class="shrink-0 text-text-weak -rotate-90 group-data-[expanded]/row:rotate-0 transition-transform" />
                            <span class="shrink-0 text-text-weak">{entry.date.split("T")[0]}</span>
                            <span class="flex-1 min-w-0 truncate text-text-strong">{entry.summary}</span>
                            <span class="shrink-0 text-text-weaker">{entry.sha.slice(0, 7)}</span>
                          </Accordion.Trigger>
                        </Accordion.Header>
                        <Accordion.Content>
                          <For each={entry.paths}>{(p) => <FileRow path={p} indent />}</For>
                        </Accordion.Content>
                      </Accordion.Item>
                    )}
                  </For>
                </Accordion>
              </Show>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  )
}

function GroupHeader(props: { label: string; count: number }) {
  return (
    <div class="px-3 pt-2.5 pb-1 text-text-weak">
      {props.label} <span class="text-text-weaker">{props.count}</span>
    </div>
  )
}

/** A changed-file row mirroring session-review: icon + dim directory / strong filename + label. */
function FileRow(props: { path: string; kind?: Kind; indent?: boolean }) {
  const cut = () => {
    const i = props.path.replace(/\\/g, "/").lastIndexOf("/")
    return i >= 0 ? { dir: props.path.slice(0, i + 1), base: props.path.slice(i + 1) } : { dir: "", base: props.path }
  }
  return (
    <div
      class="flex items-center gap-2.5 h-8 px-3 hover:bg-[var(--v2-overlay-simple-overlay-hover)]"
      classList={{ "pl-8": props.indent }}
    >
      <FileIcon node={{ path: props.path, type: "file" }} class="w-4 h-4 shrink-0" />
      <div class="flex-1 min-w-0 flex">
        <Show when={cut().dir}>
          <span class="truncate text-text-base">{cut().dir}</span>
        </Show>
        <span class="shrink-0 text-text-strong">{cut().base}</span>
      </div>
      <Show when={props.kind}>
        <span class="shrink-0" style={{ color: CHANGE[props.kind!].color }}>{CHANGE[props.kind!].label}</span>
      </Show>
    </div>
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
      <span class="w-1.5 h-1.5 rounded-full" style={{ background: online() ? "var(--icon-diff-add-base)" : "var(--text-error)" }} />
      <span>bridge: {online() ? "connected" : (props.result?.error ?? "offline")}</span>
    </span>
  )
}
