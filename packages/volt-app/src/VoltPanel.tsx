import { createResource, createSignal, For, Show, Switch, Match, type JSX } from "solid-js"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import type { ChangeSet, StatusResult } from "@opencode-ai/volt-control"
import "./ipc" // window.volt augmentation

/**
 * Volt control panel — the volt-vscode SCM + Sync-history UX, in the opencode desktop app.
 * Behind the Git↔Volt toggle (see VoltChanges). Pure renderer UI: every action calls
 * `window.volt.*` (Electron IPC → volt-control). No volt-control import (types only).
 *
 * Built from opencode's own v2 components + design tokens so it reads as native.
 * v1 scope: Status (health + incoming/outgoing/merge + pull/push/build/refresh) and History
 * (volt log). Inline diffs, merge-conflict resolution, force, drift = fast-follow.
 */
// match opencode's file-tree: diff colors come from these CSS vars
const DIFF_COLOR = {
  A: "var(--icon-diff-add-base)",
  M: "var(--icon-diff-modified-base)",
  D: "var(--icon-diff-delete-base)",
  C: "var(--icon-diff-delete-base)",
} as const

type Sub = "status" | "history"
type Row = { path: string; letter: keyof typeof DIFF_COLOR }

function rowsOf(set: ChangeSet | undefined): Row[] {
  if (!set) return []
  return [
    ...set.added.map((path) => ({ path, letter: "A" as const })),
    ...set.modified.map((path) => ({ path, letter: "M" as const })),
    ...set.removed.map((path) => ({ path, letter: "D" as const })),
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
          <div class="px-3 pb-2 shrink-0 flex flex-wrap gap-1.5 border-b border-border-weaker-base">
            <ButtonV2 size="small" variant="neutral" disabled={busy()} onClick={() => run("pull")}>Pull</ButtonV2>
            <ButtonV2 size="small" variant="neutral" disabled={busy()} onClick={() => run("push")}>Push</ButtonV2>
            <ButtonV2 size="small" variant="ghost" disabled={busy()} onClick={() => run("build")}>Build</ButtonV2>
            <ButtonV2 size="small" variant="ghost" disabled={busy()} onClick={() => refetchStatus()}>Refresh</ButtonV2>
          </div>

          <div class="px-3 py-2 text-text-weak shrink-0">
            <Show when={!status.loading} fallback={<span>Probing IDE…</span>}>
              <HealthDot result={status()} />
            </Show>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <Show when={merging()}>
              <Section label="Merge" count={merging()!.conflicts.length}>
                <For each={merging()!.conflicts}>{(c) => <FileRow letter="C" path={c.path} />}</For>
              </Section>
            </Show>
            <Section label="Incoming" count={incoming().length}>
              <For each={incoming()}>{(r) => <FileRow letter={r.letter} path={r.path} />}</For>
            </Section>
            <Section label="Changes" count={outgoing().length}>
              <For each={outgoing()}>{(r) => <FileRow letter={r.letter} path={r.path} />}</For>
            </Section>
            <Show when={inSync()}>
              <div class="py-2 text-text-weaker">In sync with the IDE.</div>
            </Show>
            <Show when={msg()}>
              <div class="mt-2 text-text-weak">{msg()}</div>
            </Show>
          </div>
        </Match>

        {/* ── History ── */}
        <Match when={sub() === "history"}>
          <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <Show when={!history.loading} fallback={<div class="py-2 text-text-weak">Loading…</div>}>
              <Show when={(history()?.length ?? 0) > 0} fallback={<div class="py-2 text-text-weaker">No sync history yet.</div>}>
                <For each={history()}>
                  {(entry) => (
                    <details class="mb-1">
                      <summary class="cursor-pointer list-none py-0.5 hover:text-text-base">
                        <span class="text-text-weak">{entry.date.split("T")[0]} </span>
                        <span class="text-text-base">{entry.summary}</span>
                        <span class="text-text-weaker"> {entry.sha.slice(0, 8)}{entry.paths.length ? ` (${entry.paths.length})` : ""}</span>
                      </summary>
                      <div class="pl-3.5 text-text-weak">
                        <For each={entry.paths}>{(p) => <div class="truncate">{p}</div>}</For>
                      </div>
                    </details>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </Match>
      </Switch>
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

function Section(props: { label: string; count: number; children: JSX.Element }) {
  return (
    <Show when={props.count > 0}>
      <div class="mt-2 mb-0.5 text-text-weak">
        {props.label} <span class="text-text-weaker">({props.count})</span>
      </div>
      {props.children}
    </Show>
  )
}

function FileRow(props: { letter: keyof typeof DIFF_COLOR; path: string }) {
  return (
    <div class="flex items-center gap-2 py-px">
      <span class="w-3 text-center" style={{ color: DIFF_COLOR[props.letter] }}>{props.letter}</span>
      <span class="truncate text-text-weak">{props.path}</span>
    </div>
  )
}
