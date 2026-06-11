import { existsSync } from "node:fs"
import { join } from "node:path"
import * as vscode from "vscode"
import { spawnCapture, cliBin } from "./cli.js"
import { withGate } from "./gate.js"
import { VoltStatus } from "./status.js"
import { output } from "./status.js"

function logln(msg: string): void {
  output().appendLine(`[${new Date().toISOString()}] ${msg}`)
}

function firstNonEmptyLine(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return undefined
  if (lines.length > 1 && /^volt:.*failed/i.test(lines[0]!)) return lines[1]
  return lines[0]
}

function pickStatus(statuses: Map<string, VoltStatus>): VoltStatus | undefined {
  if (statuses.size === 1) return [...statuses.values()][0]
  const active = vscode.window.activeTextEditor?.document.uri
  if (active !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(active)
    if (folder !== undefined) {
      const s = statuses.get(folder.uri.fsPath)
      if (s !== undefined) return s
    }
  }
  return [...statuses.values()][0]
}

function extractUriFromArg(arg: unknown): vscode.Uri | undefined {
  if (arg === undefined || arg === null) return undefined
  if (arg instanceof vscode.Uri) return arg
  if (typeof arg === "object") {
    const maybeUri = (arg as { uri?: unknown }).uri
    if (maybeUri instanceof vscode.Uri) return maybeUri
    const maybeResourceUri = (arg as { resourceUri?: unknown }).resourceUri
    if (maybeResourceUri instanceof vscode.Uri) return maybeResourceUri
  }
  return undefined
}

function extractMergeItemPath(
  arg: unknown,
): { folder: vscode.WorkspaceFolder; rel: string } | undefined {
  const uri = extractUriFromArg(arg)
  if (uri === undefined) return undefined
  const folder = vscode.workspace.getWorkspaceFolder(uri)
  if (folder === undefined) return undefined
  const rel = vscode.workspace.asRelativePath(uri, false)
  return { folder, rel }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  statuses: Map<string, VoltStatus>,
): vscode.Disposable[] {
  output()

  const runMutating = async (
    args: string[],
    title: string,
    workspaceRoot: string,
  ): Promise<void> => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      async () => {
        await withGate(workspaceRoot, async () => {
          const result = await spawnCapture(workspaceRoot, args)
          logln(`${args[0]} exit=${result.code}`)
          if (result.code !== 0) {
            const firstLine = firstNonEmptyLine(result.stderr) ?? `exit ${result.code}`
            const pick = await vscode.window.showErrorMessage(
              `Volt: ${args[0]} failed: ${firstLine}`,
              "Show Output",
            )
            if (pick === "Show Output") output().show(true)
          } else {
            vscode.window.showInformationMessage(`Volt: ${args[0]} complete.`)
          }
          const s = statuses.get(workspaceRoot)
        })
      },
    )
    const s = statuses.get(workspaceRoot)
    if (s !== undefined) await s.refresh()
  }

  const runMergeOp = async (
    args: string[],
    progressTitle: string,
    workspaceRoot: string,
  ): Promise<void> => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
      async () => {
        const result = await spawnCapture(workspaceRoot, args)
        logln(`${args[0]} exit=${result.code}`)
        if (result.code !== 0) {
          const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`
          const pick = await vscode.window.showErrorMessage(
            `Volt: ${args[0]} failed: ${firstLine}`,
            "Show Output",
          )
          if (pick === "Show Output") output().show(true)
        } else {
          vscode.window.showInformationMessage(`Volt: ${args[0]} complete.`)
        }
        const s = statuses.get(workspaceRoot)
        if (s !== undefined) await s.refresh()
      },
    )
  }

  const resolveOne = async (arg: unknown, side: "ours" | "theirs"): Promise<void> => {
    const target = extractMergeItemPath(arg)
    if (target === undefined) {
      vscode.window.showWarningMessage("Volt: select a merge conflict item to resolve.")
      return
    }
    const sideFlag = side === "ours" ? "--use-ours" : "--use-theirs"
    await runMergeOp(
      ["merge", "--resolve", target.rel, sideFlag],
      `Volt: Resolving ${target.rel} (use ${side === "ours" ? "mine" : "IDE's"})…`,
      target.folder.uri.fsPath,
    )
  }

  const resolveAll = async (side: "ours" | "theirs"): Promise<void> => {
    const s = pickStatus(statuses)
    if (s === undefined) {
      vscode.window.showWarningMessage("Volt: no Volt-bound workspace folder found.")
      return
    }
    const status = s.status
    const conflicts = status?.merging?.conflicts ?? []
    if (conflicts.length === 0) {
      vscode.window.showInformationMessage("Volt: no merge conflicts to resolve.")
      return
    }
    const label = side === "ours" ? "my version" : "the IDE's version"
    const ok = await vscode.window.showWarningMessage(
      `Resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} using ${label}? This overwrites the workspace for each conflicted file.`,
      { modal: true },
      "Resolve all",
    )
    if (ok !== "Resolve all") return
    const sideFlag = side === "ours" ? "--use-ours" : "--use-theirs"
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Volt: Resolving ${conflicts.length} conflict(s) using ${label}…`, cancellable: false },
      async (progress) => {
        let resolved = 0
        for (const c of conflicts) {
          progress.report({ message: `${c.path} (${resolved + 1}/${conflicts.length})` })
          const result = await spawnCapture(s.workspaceRoot, ["merge", "--resolve", c.path, sideFlag])
          if (result.code !== 0) {
            const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`
            logln(`resolve ${c.path} failed: ${result.stderr.trim()}`)
            vscode.window.showErrorMessage(`Volt: failed to resolve ${c.path}: ${firstLine}`)
            break
          }
          resolved += 1
        }
        await s.refresh()
        if (resolved > 0) {
          vscode.window.setStatusBarMessage(
            `$(check) Volt: resolved ${resolved} conflict(s). Run "Continue merge" to finalize.`,
            5000,
          )
        }
      },
    )
  }

  const discardOutgoing = async (arg: unknown): Promise<void> => {
    const target = extractMergeItemPath(arg)
    if (target === undefined) {
      vscode.window.showWarningMessage("Volt: select a file to discard.")
      return
    }
    const ok = await vscode.window.showWarningMessage(
      `Discard local changes to ${target.rel}? This restores the file to its last-pulled (HEAD) version. The current edits will be lost.`,
      { modal: true },
      "Discard",
    )
    if (ok !== "Discard") return
    const s = statuses.get(target.folder.uri.fsPath)
    if (s === undefined) return
    const result = await spawnCapture(target.folder.uri.fsPath, ["show", "HEAD", target.rel])
    if (result.code !== 0) {
      const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`
      vscode.window.showErrorMessage(`Volt: couldn't read HEAD for ${target.rel}: ${firstLine}`)
      logln(`discardOutgoing ${target.rel} failed: ${result.stderr.trim()}`)
      return
    }
    const fileUri = vscode.Uri.joinPath(target.folder.uri, target.rel)
    try {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result.stdout, "utf-8"))
    } catch (err) {
      vscode.window.showErrorMessage(
        `Volt: failed to write ${target.rel}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }
    vscode.window.setStatusBarMessage(`$(check) Volt: discarded local changes to ${target.rel}`, 3000)
    await s.refresh()
  }

  const disposables: vscode.Disposable[] = []

  disposables.push(
    vscode.commands.registerCommand("volt.refresh", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      await s.refresh()
      const status = s.status
      const inc = status === undefined ? 0 : status.incoming.added.length + status.incoming.modified.length + status.incoming.removed.length
      const out = status === undefined ? 0 : status.outgoing.added.length + status.outgoing.modified.length + status.outgoing.removed.length
      const msg = inc === 0 && out === 0
        ? "$(check) Volt: refreshed — in sync with IDE"
        : `$(sync) Volt: refreshed — ${inc} incoming, ${out} outgoing`
      vscode.window.setStatusBarMessage(msg, 3000)
    }),

    vscode.commands.registerCommand("volt.pull", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      await runMutating(["pull"], "Volt: Pulling (bridge → workspace)…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.push", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      await runMutating(["push"], "Volt: Pushing (workspace → bridge)…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.forcePull", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      const ok = await vscode.window.showWarningMessage(
        "Force-pull will discard all local edits in this workspace. Continue?",
        { modal: true },
        "Force Pull",
      )
      if (ok !== "Force Pull") return
      await runMutating(["pull", "--force"], "Volt: Force-pulling…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.forcePush", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      const ok = await vscode.window.showWarningMessage(
        "Force-push will overwrite the IDE's current state with your workspace. Continue?",
        { modal: true },
        "Force Push",
      )
      if (ok !== "Force Push") return
      await runMutating(["push", "--force"], "Volt: Force-pushing…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.init", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]
      if (folder === undefined) {
        vscode.window.showWarningMessage("Volt: no workspace folder open.")
        return
      }
      await runMutating(["init"], "Volt: Initializing workspace…", folder.uri.fsPath)
    }),

    vscode.commands.registerCommand("volt.initTwincat", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]
      if (folder === undefined) {
        vscode.window.showWarningMessage("Volt: no workspace folder open.")
        return
      }
      const port = vscode.workspace.getConfiguration("volt.bridge").get<number>("twincatPort", 8555)
      await runMutating(["init", "--platform", "twincat", "--port", String(port)], "Volt: Initializing for TwinCAT…", folder.uri.fsPath)
    }),

    vscode.commands.registerCommand("volt.initCodesys", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]
      if (folder === undefined) {
        vscode.window.showWarningMessage("Volt: no workspace folder open.")
        return
      }
      const port = vscode.workspace.getConfiguration("volt.bridge").get<number>("codesysPort", 8556)
      await runMutating(["init", "--platform", "codesys", "--port", String(port)], "Volt: Initializing for CODESYS…", folder.uri.fsPath)
    }),

    vscode.commands.registerCommand("volt.acceptProjectRename", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      await runMutating(["init", "--force"], "Volt: Accepting project rename…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.status", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      const result = await spawnCapture(s.workspaceRoot, ["status"])
      const doc = await vscode.workspace.openTextDocument({ content: result.stdout, language: "json" })
      await vscode.window.showTextDocument(doc)
    }),

    vscode.commands.registerCommand("volt.build", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      await runMutating(["build"], "Volt: Building…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.openConfig", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) {
        vscode.window.showWarningMessage("Volt: no Volt-bound workspace folder found.")
        return
      }
      const configPath = join(s.workspaceRoot, ".volt", "config.json")
      const uri = vscode.Uri.file(configPath)
      if (existsSync(configPath)) {
        await vscode.commands.executeCommand("vscode.open", uri)
      } else {
        vscode.window.showWarningMessage(`.volt/config.json not found at ${configPath}`)
      }
    }),

    vscode.commands.registerCommand("volt.openSettings", () => {
      void vscode.commands.executeCommand("workbench.action.openSettings", "volt")
    }),

    vscode.commands.registerCommand("volt.showOutput", () => {
      output().show(true)
    }),

    vscode.commands.registerCommand("volt.merge.continue", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      await runMergeOp(["merge", "--continue"], "Volt: Continuing merge…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.merge.abort", async () => {
      const s = pickStatus(statuses)
      if (s === undefined) return
      const ok = await vscode.window.showWarningMessage(
        "Abort the merge? Local changes made during the merge will be lost.",
        { modal: true },
        "Abort",
      )
      if (ok !== "Abort") return
      await runMergeOp(["merge", "--abort"], "Volt: Aborting merge…", s.workspaceRoot)
    }),

    vscode.commands.registerCommand("volt.merge.useMine", (arg: unknown) => resolveOne(arg, "ours")),
    vscode.commands.registerCommand("volt.merge.useTheirs", (arg: unknown) => resolveOne(arg, "theirs")),
    vscode.commands.registerCommand("volt.merge.useAllMine", () => resolveAll("ours")),
    vscode.commands.registerCommand("volt.merge.useAllTheirs", () => resolveAll("theirs")),

    vscode.commands.registerCommand("volt.discardOutgoing", (arg: unknown) => discardOutgoing(arg)),

    vscode.commands.registerCommand("volt.lsp.restart", async () => {
      vscode.window.setStatusBarMessage("Volt: language server restart triggered — reload the window for full effect", 3000)
    }),

    vscode.commands.registerCommand("volt.lsp.showOutput", () => {
      output().show(true)
    }),

    vscode.commands.registerCommand("volt.openReference", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]
      if (folder === undefined) {
        vscode.window.showWarningMessage("Volt: no workspace folder open. Open a project first.")
        return
      }
      const skillBase = ".claude/skills/st-reference"
      const prioritised = [
        vscode.Uri.joinPath(folder.uri, `${skillBase}/twincat-reference/00-index.md`),
        vscode.Uri.joinPath(folder.uri, `${skillBase}/codesys-reference/00-index.md`),
      ]
      for (const uri of prioritised) {
        try { await vscode.workspace.fs.stat(uri); await vscode.commands.executeCommand("vscode.open", uri); return } catch {}
      }
      const installed = await vscode.window.showWarningMessage(
        "Language reference not found in this workspace. Run `volt init` to install it?",
        "Run volt init",
        "Cancel",
      )
      if (installed === "Run volt init") await vscode.commands.executeCommand("volt.init")
    }),

    vscode.commands.registerCommand("volt._applyPostState", (cwd: unknown, status: unknown) => {
      if (typeof cwd !== "string") return
      const s = statuses.get(cwd)
      if (s === undefined) return
      if (typeof status !== "object" || status === null) return
      s.applyStatus("post-mutation", status as import("./types.js").StatusJson)
    }),

    vscode.commands.registerCommand("volt._refreshFolder", async (cwd: unknown, options?: unknown) => {
      if (typeof cwd !== "string") return
      const s = statuses.get(cwd)
      if (s === undefined) return
      const opts = (typeof options === "object" && options !== null)
        ? options as { skipHealthProbe?: boolean }
        : {}
      await s.refresh(opts)
    }),
  )

  return disposables
}
