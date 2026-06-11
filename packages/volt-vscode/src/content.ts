import { basename } from "node:path"
import * as vscode from "vscode"
import { spawnCaptureBuffer } from "./cli.js"

export const VOLT_URI_SCHEME = "volt"

export type ShowRef = string

const NAMED_REFS = new Set(["HEAD", "MERGE_HEAD", "ORIG_HEAD", "WORKSPACE", "BRIDGE"])
const SHA_RE = /^[0-9a-f]{4,40}$/

function isValidRef(ref: string): boolean {
  return NAMED_REFS.has(ref) || SHA_RE.test(ref)
}

export function buildVoltUri(workspaceRoot: string, ref: ShowRef, path: string): vscode.Uri {
  const cleaned = path.split(/[\\/]/).filter((s) => s.length > 0).join("/")
  return vscode.Uri.parse(
    `${VOLT_URI_SCHEME}://${encodeURIComponent(basename(workspaceRoot))}/${ref}/${cleaned}`,
  )
}

export function parseVoltUri(uri: vscode.Uri):
  | { workspaceRoot: string; ref: ShowRef; path: string }
  | undefined {
  if (uri.scheme !== VOLT_URI_SCHEME) return undefined
  const workspaceName = decodeURIComponent(uri.authority)
  const segments = uri.path.split("/").filter((s) => s.length > 0)
  if (segments.length < 2) return undefined
  const refSegment = segments[0]
  if (!isValidRef(refSegment)) return undefined
  const ref = refSegment as ShowRef
  const relativePath = segments.slice(1).join("/")
  const target = workspaceName.toLowerCase()
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (basename(f.uri.fsPath).toLowerCase() === target) {
      return { workspaceRoot: f.uri.fsPath, ref, path: relativePath }
    }
  }
  return undefined
}

export class VoltContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.emitter.event

  notifyChange(uri: vscode.Uri): void {
    this.emitter.fire(uri)
  }

  notifyAllRefs(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === VOLT_URI_SCHEME) this.emitter.fire(doc.uri)
    }
  }

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken,
  ): Promise<string> {
    const parsed = parseVoltUri(uri)
    if (parsed === undefined) return `(volt: not a valid volt:// URI — got "${uri.toString()}")`

    if (token.isCancellationRequested) return ""

    try {
      const result = await spawnCaptureBuffer(
        parsed.workspaceRoot,
        ["show", parsed.ref, parsed.path],
      )
      if (result.code === 0) return result.stdout.toString("utf-8")
      if (result.code === 2 && parsed.ref !== "BRIDGE") return ""
      const reason = result.stderr.trim() || `exit ${result.code}`
      return `(volt show ${parsed.ref} ${parsed.path} failed: ${reason})`
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return `(volt show ${parsed.ref} ${parsed.path} threw: ${reason})`
    }
  }

  dispose(): void {
    this.emitter.dispose()
  }
}
