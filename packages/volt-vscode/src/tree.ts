import { existsSync } from "node:fs"
import * as vscode from "vscode"
import { healthLabel, isBridgeOnline } from "./health.js"
import { buildVoltUri } from "./content.js"
import { changeCount, type ProjectMismatch, type StatusJson } from "./types.js"
import type { HealthState } from "./health.js"

export interface StatusSource {
  readonly status: StatusJson | undefined
  readonly healthState: HealthState
  readonly workspaceRoot: string
  readonly isRefreshing: boolean
  readonly statusError: string | undefined
}

export type TreeNode =
  | { kind: "health"; state: HealthState; sourceIdx: number }
  | { kind: "group"; label: string; group: "incoming" | "outgoing" | "merge"; sourceIdx: number; count: number }
  | { kind: "item"; label: string; uri: vscode.Uri; group: "incoming" | "outgoing" | "merge"; letter: "A" | "M" | "D"; sourceIdx: number; rel: string }
  | { kind: "empty"; label: string }
  | { kind: "loading"; label: string }
  | { kind: "status-error"; label: string; tooltip: string }
  | { kind: "project-mismatch"; label: string; tooltip: string; sourceIdx: number }

export class VoltTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event
  private listSources: () => readonly StatusSource[]

  constructor(listSources: () => readonly StatusSource[]) {
    this.listSources = listSources
  }

  refresh(): void {
    this.emitter.fire(undefined)
  }

  dispose(): void {
    this.emitter.dispose()
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "health") {
      const item = new vscode.TreeItem(healthLabel(node.state), vscode.TreeItemCollapsibleState.None)
      item.id = `health-${node.sourceIdx}`
      item.contextValue = "volt.health"
      const [iconName, colorId] = healthIcon(node.state)
      item.iconPath = colorId === undefined
        ? new vscode.ThemeIcon(iconName)
        : new vscode.ThemeIcon(iconName, new vscode.ThemeColor(colorId))
      item.tooltip = healthTooltip(node.state)
      item.command = { command: "volt.showOutput", title: "Show Volt output" }
      return item
    }
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.id = "state-empty"
      item.contextValue = "volt.empty"
      return item
    }
    if (node.kind === "loading") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.id = "state-loading"
      item.contextValue = "volt.loading"
      item.iconPath = new vscode.ThemeIcon("loading~spin")
      return item
    }
    if (node.kind === "status-error") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.id = "state-status-error"
      item.contextValue = "volt.statusError"
      item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"))
      item.tooltip = node.tooltip
      item.command = { command: "volt.showOutput", title: "Show Volt Output" }
      return item
    }
    if (node.kind === "project-mismatch") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.id = `mismatch-${node.sourceIdx}`
      item.contextValue = "volt.projectMismatch"
      item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"))
      item.tooltip = node.tooltip
      item.command = { command: "volt.acceptProjectRename", title: "Accept new project name" }
      return item
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        `${node.label} (${node.count})`,
        vscode.TreeItemCollapsibleState.Expanded,
      )
      item.id = `group-${node.sourceIdx}-${node.group}`
      item.contextValue = `volt.group.${node.group}`
      item.iconPath = new vscode.ThemeIcon(
        node.group === "incoming" ? "arrow-down"
          : node.group === "outgoing" ? "arrow-up"
          : "git-merge",
      )
      return item
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
    item.id = `item-${node.sourceIdx}-${node.group}-${node.rel}`
    item.resourceUri = node.uri
    item.contextValue = `volt.item.${node.group}`
    item.iconPath = new vscode.ThemeIcon(
      node.letter === "A" ? "diff-added"
        : node.letter === "M" ? "diff-modified"
        : "diff-removed",
    )
    item.tooltip =
      node.group === "incoming" ? "Incoming change from IDE — click to preview"
        : node.group === "outgoing" ? "Your local change — click to diff against last pull"
        : "Merge conflict — click to open merge editor, or right-click to pick a side"
    item.command = buildClickCommand(node, this.listSources)
    return item
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (node === undefined) {
      const result: TreeNode[] = []
      const sources = this.listSources()
      for (let i = 0; i < sources.length; i++) {
        result.push({ kind: "health", state: sources[i]!.healthState, sourceIdx: i })
        const mismatch = sources[i]!.status?.projectMismatch
        if (mismatch !== undefined && mismatch !== null) {
          result.push({
            kind: "project-mismatch",
            sourceIdx: i,
            label: `Project rename detected: "${mismatch.configuredAs.plcProjectName}" → "${mismatch.bridgeReports.plcProjectName}"`,
            tooltip: formatMismatchTooltip(mismatch),
          })
        }
      }
      let totalRows = 0
      let anySourceRefreshing = false
      let anySourceWithoutStatus = false
      let firstStatusError: string | undefined
      let everySourceOffline = sources.length > 0
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]!
        if (src.isRefreshing) anySourceRefreshing = true
        if (isBridgeOnline(src.healthState)) everySourceOffline = false
        const s = src.status
        if (s === undefined) {
          anySourceWithoutStatus = true
          if (firstStatusError === undefined) firstStatusError = src.statusError
          continue
        }
        const m = s.merging?.conflicts.length ?? 0
        const inc = changeCount(s.incoming)
        const out = changeCount(s.outgoing)
        if (m > 0) result.push({ kind: "group", label: "Merge Changes", group: "merge", sourceIdx: i, count: m })
        if (inc > 0) result.push({ kind: "group", label: "Incoming Changes", group: "incoming", sourceIdx: i, count: inc })
        if (out > 0) result.push({ kind: "group", label: "Changes", group: "outgoing", sourceIdx: i, count: out })
        totalRows += m + inc + out
      }
      if (totalRows === 0 && sources.length > 0) {
        if (anySourceRefreshing && anySourceWithoutStatus) {
          result.push({ kind: "loading", label: "Loading changes from IDE…" })
        } else if (firstStatusError !== undefined) {
          result.push({
            kind: "status-error",
            label: `Status failed: ${truncate(firstStatusError, 80)}`,
            tooltip: `volt status --json exited non-zero.\n\n${firstStatusError}\n\nClick to open the Volt Output channel for the full log.`,
          })
        } else if (!anySourceWithoutStatus) {
          result.push({ kind: "empty", label: "No changes — workspace and IDE in sync" })
        } else {
          result.push({ kind: "loading", label: "Waiting for first refresh…" })
        }
      }
      return result
    }
    if (node.kind === "group") return buildItemsForGroup(node, this.listSources)
    return []
  }
}

function buildClickCommand(
  node: TreeNode & { kind: "item" },
  listSources: () => readonly StatusSource[],
): vscode.Command | undefined {
  if (node.letter === "D" && node.group === "outgoing") return undefined
  const workspaceRoot = listSources()[node.sourceIdx]!.workspaceRoot
  if (node.group === "merge") {
    return {
      command: "volt.merge.openEditor",
      title: "Open Merge Editor",
      arguments: [node.uri],
    }
  }
  const leftRef = node.group === "incoming" ? "BRIDGE" : "HEAD"
  const title =
    node.group === "incoming"
      ? `${node.rel} (Volt: incoming from IDE)`
      : `${node.rel} (Volt: workspace vs HEAD)`
  const workspaceFsPath = node.uri.fsPath
  const rightUri = existsSync(workspaceFsPath)
    ? node.uri
    : buildVoltUri(workspaceRoot, "WORKSPACE", node.rel)
  return {
    command: "vscode.diff",
    title: "Open Diff",
    arguments: [buildVoltUri(workspaceRoot, leftRef, node.rel), rightUri, title],
  }
}

function buildItemsForGroup(
  group: TreeNode & { kind: "group" },
  listSources: () => readonly StatusSource[],
): TreeNode[] {
  const source = listSources()[group.sourceIdx]
  if (source === undefined) return []
  const status = source.status
  if (status === undefined) return []
  const root = source.workspaceRoot
  const out: TreeNode[] = []
  if (group.group === "merge") {
    for (const c of status.merging?.conflicts ?? []) {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), c.path)
      out.push({
        kind: "item", label: c.path, uri, group: "merge",
        letter: "M", sourceIdx: group.sourceIdx, rel: c.path,
      })
    }
    return out
  }
  const change = group.group === "incoming" ? status.incoming : status.outgoing
  const triples: Array<[string[], "A" | "M" | "D"]> = [
    [change.added, "A"], [change.modified, "M"], [change.removed, "D"],
  ]
  for (const [names, letter] of triples) {
    for (const name of names) {
      const rel = status.pathByName[name]
      if (rel === undefined) continue
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel)
      out.push({
        kind: "item", label: rel, uri, group: group.group,
        letter, sourceIdx: group.sourceIdx, rel,
      })
    }
  }
  return out
}

function healthIcon(state: HealthState): [string, string | undefined] {
  switch (state.kind) {
    case "connected": return ["circle-filled", "charts.green"]
    case "degraded": return ["circle-filled", "charts.yellow"]
    case "disconnected": return ["circle-filled", "charts.red"]
    case "unreachable": return ["plug", "charts.red"]
    case "unknown": return ["loading~spin", undefined]
  }
}

function healthTooltip(state: HealthState): string {
  switch (state.kind) {
    case "connected": {
      const h = state.health
      return [
        "Bridge connected.",
        `IDE: ${h.ideName ?? "?"} ${h.ideVersion ?? ""}`.trim(),
        `Project: ${h.projectName ?? "(none)"} / ${h.plcProjectName ?? "(none)"}`,
        h.projectDirty === true ? "Project has unsaved IDE edits." : "",
      ].filter((s) => s.length > 0).join("\n")
    }
    case "degraded":
      return `Bridge degraded — previous call failed.\nReason: ${state.health.degradedReason ?? "(unknown)"}`
    case "disconnected":
      return "Bridge is up but no IDE is attached.\nOpen the PLC IDE with a project loaded."
    case "unreachable":
      return `Cannot reach the bridge.\n${state.reason}\nIs the bridge process running? (it starts with your IDE)`
    case "unknown":
      return "Probing the bridge…"
  }
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

function formatMismatchTooltip(m: ProjectMismatch): string {
  const lines = [
    "The bridge is reporting a different project identity than .volt/config.json recorded.",
    "",
  ]
  for (const f of m.diffFields) {
    lines.push(`  ${f}:  "${m.configuredAs[f]}"  →  "${m.bridgeReports[f]}"`)
  }
  lines.push("")
  lines.push("Click to accept the new name (runs `volt init --force`).")
  lines.push("Snapshot history is preserved.")
  return lines.join("\n")
}
