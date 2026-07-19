import { createAsync, query } from "@solidjs/router"
import { For, Show, ErrorBoundary } from "solid-js"
import { overview } from "~/lib/overview"

// VOLT: fleet overview — rendered above opencode's lookup form on the index page. Reads the DB directly
// (SUM/COUNT across all workspaces); see ~/lib/overview.ts for the scale rationale.
const getOverview = query(async () => {
  "use server"
  return overview()
}, "support.overview")

export function Overview() {
  const data = createAsync(() => getOverview())

  return (
    <section data-component="overview" style="margin-bottom:28px">
      <h1>Overview</h1>
      <ErrorBoundary fallback={(err) => <div data-component="error">{(err as Error).message}</div>}>
        <Show when={data()} fallback={<div data-empty>Loading overview…</div>}>
          {(d) => (
            <>
              <div data-slot="stats" style="display:flex;flex-wrap:wrap;gap:14px;margin:8px 0 20px">
                <For each={d().stats}>
                  {(s) => (
                    <div style="border:1px solid currentColor;border-radius:8px;padding:8px 14px;min-width:104px;opacity:.85">
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.7">{s.label}</div>
                      <div style="font-size:20px;font-weight:600;font-variant-numeric:tabular-nums">{s.value}</div>
                    </div>
                  )}
                </For>
              </div>

              <h2>Workspaces ({d().workspaces.length})</h2>
              <Table rows={d().workspaces} />
            </>
          )}
        </Show>
      </ErrorBoundary>
    </section>
  )
}

function Table(props: { rows: Record<string, unknown>[] }) {
  const columns = () => {
    const cols = new Set<string>()
    for (const row of props.rows) for (const k of Object.keys(row)) cols.add(k)
    return [...cols]
  }
  return (
    <Show when={props.rows.length > 0} fallback={<div data-empty>(no workspaces)</div>}>
      <table>
        <thead>
          <tr>
            <For each={columns()}>{(c) => <th>{c}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <For each={columns()}>{(c) => <td>{cell(row[c])}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  )
}

function cell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "object" && value !== null && "__link" in value) {
    const v = value as { __link: string; label: string }
    return <a href={v.__link}>{v.label}</a>
  }
  return String(value)
}
