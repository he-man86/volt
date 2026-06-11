import * as vscode from "vscode"
import { buildVoltUri } from "./content.js"

export function registerMergeEditor(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("volt.merge.openEditor", openMergeEditor)
}

async function openMergeEditor(arg: unknown): Promise<void> {
  const fileUri = extractUri(arg)
  if (fileUri === undefined) {
    vscode.window.showWarningMessage("Volt: no file selected for merge editor.")
    return
  }
  const folder = vscode.workspace.getWorkspaceFolder(fileUri)
  if (folder === undefined) {
    vscode.window.showWarningMessage("Volt: file is not in any open workspace folder.")
    return
  }
  const rel = vscode.workspace.asRelativePath(fileUri, false)
  const root = folder.uri.fsPath

  const baseUri = buildVoltUri(root, "ORIG_HEAD", rel)
  const oursUri = buildVoltUri(root, "WORKSPACE", rel)
  const theirsUri = buildVoltUri(root, "MERGE_HEAD", rel)

  const args = {
    base: { resource: baseUri, detail: "merge base (ORIG_HEAD)" },
    input1: { resource: oursUri, title: "Workspace (ours)", description: "your edits", detail: "Workspace" },
    input2: { resource: theirsUri, title: "IDE (theirs)", description: "the engineer's edits in the PLC IDE", detail: "IDE" },
    output: fileUri,
  }

  try {
    await vscode.commands.executeCommand("_open.mergeEditor", args)
  } catch (err) {
    console.warn("volt: _open.mergeEditor unavailable, falling back to diff", err)
    await vscode.commands.executeCommand("vscode.diff", oursUri, theirsUri, `${rel} — Workspace vs IDE`)
    vscode.window.showInformationMessage(
      "Volt: built-in merge editor unavailable on this VS Code build — showing diff. Resolve manually in the workspace file and run `volt merge --continue`.",
    )
  }
}

function extractUri(arg: unknown): vscode.Uri | undefined {
  if (arg === undefined || arg === null) return vscode.window.activeTextEditor?.document.uri
  if (arg instanceof vscode.Uri) return arg
  if (typeof arg === "object") {
    const maybeUri = (arg as { uri?: unknown }).uri
    if (maybeUri instanceof vscode.Uri) return maybeUri
    const maybeResourceUri = (arg as { resourceUri?: unknown }).resourceUri
    if (maybeResourceUri instanceof vscode.Uri) return maybeResourceUri
  }
  return undefined
}
