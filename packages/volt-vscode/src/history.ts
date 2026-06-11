import * as vscode from "vscode"
import { spawnCapture } from "./cli.js"
import { buildVoltUri } from "./content.js"

interface CommitEntry {
  sha: string
  shaShort: string
  timestampSec: number
  subject: string
  paths: string[]
}

interface LogJson {
  commits: CommitEntry[]
}

export type HistoryNode =
  | { kind: "commit"; sourceIdx: number; entry: CommitEntry }
  | { kind: "file"; sourceIdx: number; entry: CommitEntry; path: string }
  | { kind: "empty"; label: string }

export class VoltHistoryProvider implements vscode.TreeDataProvider<HistoryNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<HistoryNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event
  private listRoots: () => readonly string[]
  private limit: number
  private logCache = new Map<string, CommitEntry[]>()
  private disposables: vscode.Disposable[] = []

  constructor(listRoots: () => readonly string[], limit = 50) {
    this.listRoots = listRoots
    this.limit = limit
  }

  refresh(): void {
    this.logCache.clear()
    this.emitter.fire(undefined)
  }

  dispose(): void {
    this.emitter.dispose()
    for (const d of this.disposables) d.dispose()
  }

  getTreeItem(node: HistoryNode): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.iconPath = new vscode.ThemeIcon("history")
      return item
    }
    if (node.kind === "commit") {
      const date = new Date(node.entry.timestampSec * 1000)
      const item = new vscode.TreeItem(
        formatTimestamp(date),
        node.entry.paths.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      )
      item.description = `${node.entry.shaShort}  ${node.entry.subject}`
      item.tooltip = `${date.toLocaleString()} — ${node.entry.subject}\n${node.entry.paths.length} file(s) changed`
      item.iconPath = new vscode.ThemeIcon("git-commit")
      item.contextValue = "volt.history.commit"
      return item
    }
    const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None)
    item.iconPath = new vscode.ThemeIcon("file")
    item.tooltip = `Diff ${node.path} at ${node.entry.shaShort} against the live workspace`
    const roots = this.listRoots()
    const root = roots[node.sourceIdx]
    if (root !== undefined) {
      const left = buildVoltUri(root, node.entry.sha, node.path)
      const right = vscode.Uri.joinPath(vscode.Uri.file(root), node.path)
      item.command = {
        command: "vscode.diff",
        title: "Diff at this pull",
        arguments: [left, right, `${node.path} @ ${node.entry.shaShort} ↔ workspace`],
      }
    }
    item.resourceUri = vscode.Uri.parse(`volt-history:/${node.entry.sha}/${node.path}`)
    item.contextValue = "volt.history.file"
    return item
  }

  async getChildren(node?: HistoryNode): Promise<HistoryNode[]> {
    if (node === undefined) {
      const roots = this.listRoots()
      if (roots.length === 0) {
        return [{ kind: "empty", label: "No Volt workspace bound — run `volt init` first" }]
      }
      const out: HistoryNode[] = []
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i]!
        let entries = this.logCache.get(root)
        if (entries === undefined) {
          entries = await loadLog(root, this.limit)
          this.logCache.set(root, entries)
        }
        for (const e of entries) out.push({ kind: "commit", sourceIdx: i, entry: e })
      }
      if (out.length === 0) {
        return [{ kind: "empty", label: "No sync history yet — run `volt pull` to populate" }]
      }
      return out
    }
    if (node.kind === "commit") {
      return node.entry.paths.map((p) => ({
        kind: "file",
        sourceIdx: node.sourceIdx,
        entry: node.entry,
        path: p,
      }))
    }
    return []
  }
}

async function loadLog(workspaceRoot: string, limit: number): Promise<CommitEntry[]> {
  try {
    const result = await spawnCapture(workspaceRoot, ["log", "--json", `--limit=${limit}`])
    if (result.code !== 0) return []
    const parsed = JSON.parse(result.stdout) as LogJson
    return Array.isArray(parsed.commits) ? parsed.commits : []
  } catch {
    return []
  }
}

function formatTimestamp(date: Date): string {
  const nowMs = Date.now()
  const ageMs = nowMs - date.getTime()
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (ageMs < min) return "just now"
  if (ageMs < hour) return `${Math.floor(ageMs / min)} min ago`
  if (ageMs < day) return `${Math.floor(ageMs / hour)} hr ago`
  if (ageMs < 7 * day) return `${Math.floor(ageMs / day)} days ago`
  return date.toISOString().slice(0, 10)
}
