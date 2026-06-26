import { createResource, createSignal, For, Show, Switch, Match } from "solid-js"
import type { ChangeSet, StatusResult } from "@opencode-ai/volt-control"
import "./ipc" // pulls in the window.volt type augmentation

/**
 * Volt control panel — the volt-vscode SCM + Sync-history UX, in the opencode desktop app.
 * Lives behind the Git↔Volt toggle in the session changes panel. Pure renderer UI: every
 * action calls `window.volt.*` (Electron IPC → volt-control). No volt-control import.
 *
 * v1 scope: Status (health + incoming/outgoing/merge + pull/push/build/refresh) and History
 * (volt log snapshots). Inline diffs, merge-conflict resolution, force, drift = fast-follow.
 */
const ACCENT = "#E0651F" // brand orange
const GREEN = "#3E9B52"
const RED = "#d2603f"

type Sub = "status" | "history"

type Row = { path: string; letter: string; color: string }

function rowsOf(set: ChangeSet | undefined): Row[] {
  if (!set) return []
  return [
    ...set.added.map((path) => ({ path, letter: "A", color: GREEN })),
    ...set.modified.map((path) => ({ path, letter: "M", color: ACCENT })),
    ...set.removed.map((path) => ({ path, letter: "D", color: RED })),
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

  return (
    <div class="h-full flex flex-col text-12-regular" style={{ "font-family": "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {/* sub-tabs */}
      <div style={{ display: "flex", gap: "4px", padding: "8px 10px" }}>
        <For each={["status", "history"] as Sub[]}>
          {(t) => (
            <button
              type="button"
              onClick={() => setSub(t)}
              style={{
                padding: "3px 12px",
                "border-radius": "6px",
                "text-transform": "capitalize",
                cursor: "pointer",
                border: "1px solid transparent",
                background: sub() === t ? ACCENT : "transparent",
                color: sub() === t ? "#fff" : "inherit",
                opacity: sub() === t ? "1" : "0.7",
              }}
            >
              {t}
            </button>
          )}
        </For>
      </div>

      <Switch>
        <Match when={!bridge()}>
          <div style={{ padding: "10px", opacity: "0.6" }}>Volt is available in the desktop app.</div>
        </Match>

        {/* ── Status ── */}
        <Match when={sub() === "status"}>
          <div style={{ "border-bottom": "1px solid var(--icon-weak-base, #e2d8c8)", padding: "0 10px 8px", display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
            <For each={["pull", "push", "build", "refresh"] as const}>
              {(verb) => (
                <button
                  type="button"
                  disabled={busy()}
                  onClick={() => (verb === "refresh" ? refetchStatus() : run(verb))}
                  style={{ padding: "3px 10px", border: `1px solid ${ACCENT}`, "border-radius": "6px", background: "transparent", color: ACCENT, cursor: busy() ? "default" : "pointer", "text-transform": "capitalize", opacity: busy() ? "0.5" : "1" }}
                >
                  {verb}
                </button>
              )}
            </For>
          </div>

          <div style={{ padding: "6px 10px", opacity: "0.7" }}>
            <Switch fallback={<HealthDot result={status()} />}>
              <Match when={status.loading}>Probing IDE…</Match>
            </Switch>
          </div>

          <div style={{ "overflow-y": "auto", flex: "1", padding: "0 10px 10px" }}>
            <Show when={merging()}>
              <Section label="Merge" count={merging()!.conflicts.length}>
                <For each={merging()!.conflicts}>{(c) => <FileRow letter="C" color={RED} path={c.path} />}</For>
              </Section>
            </Show>
            <Section label="Incoming" count={incoming().length}>
              <For each={incoming()}>{(r) => <FileRow letter={r.letter} color={r.color} path={r.path} />}</For>
            </Section>
            <Section label="Changes" count={outgoing().length}>
              <For each={outgoing()}>{(r) => <FileRow letter={r.letter} color={r.color} path={r.path} />}</For>
            </Section>
            <Show when={status()?.status && !merging() && incoming().length === 0 && outgoing().length === 0}>
              <div style={{ opacity: "0.5", padding: "8px 0" }}>In sync with the IDE.</div>
            </Show>
            <Show when={msg()}>
              <div style={{ "margin-top": "8px", opacity: "0.6", "font-size": "12px" }}>{msg()}</div>
            </Show>
          </div>
        </Match>

        {/* ── History ── */}
        <Match when={sub() === "history"}>
          <div style={{ "overflow-y": "auto", flex: "1", padding: "0 10px 10px" }}>
            <Show when={!history.loading} fallback={<div style={{ opacity: "0.6", padding: "8px 0" }}>Loading…</div>}>
              <Show when={(history()?.length ?? 0) > 0} fallback={<div style={{ opacity: "0.5", padding: "8px 0" }}>No sync history yet.</div>}>
                <For each={history()}>
                  {(entry) => (
                    <details style={{ "margin-bottom": "4px" }}>
                      <summary style={{ cursor: "pointer", "list-style": "none" }}>
                        <span>{entry.date.split("T")[0]} </span>
                        <span style={{ "font-weight": "600" }}>{entry.summary}</span>
                        <span style={{ opacity: "0.5" }}> {entry.sha.slice(0, 8)}{entry.paths.length ? ` (${entry.paths.length})` : ""}</span>
                      </summary>
                      <div style={{ "padding-left": "14px", opacity: "0.8" }}>
                        <For each={entry.paths}>{(p) => <div>{p}</div>}</For>
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
    <span>
      <span style={{ color: online() ? GREEN : RED }}>⚡</span> bridge: {online() ? "connected" : (props.result?.error ?? "offline")}
    </span>
  )
}

function Section(props: { label: string; count: number; children: any }) {
  return (
    <Show when={props.count > 0}>
      <div style={{ "font-weight": "600", "margin-top": "8px", opacity: "0.8" }}>
        {props.label} ({props.count})
      </div>
      {props.children}
    </Show>
  )
}

function FileRow(props: { letter: string; color: string; path: string }) {
  return (
    <div style={{ display: "flex", gap: "6px", padding: "1px 0" }}>
      <span style={{ color: props.color, width: "12px", "text-align": "center", "font-weight": "600" }}>{props.letter}</span>
      <span style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{props.path}</span>
    </div>
  )
}
