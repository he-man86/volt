// The pull/push/build/init actions — the desktop counterpart of the extension's commands.ts. The FLOW (adopt
// vs refresh, outcome filtering + destructive-confirm, progress formatting) lives in @volt/control; this file
// only supplies Electron's native primitives (dialogs + IPC) and wires them to the shared functions.
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Dialog, IpcMain } from "electron"
import {
  pull,
  push,
  build,
  initFromProject,
  rebind,
  reconnectBound,
  disconnect,
  boundProjectId,
  mergeContinue,
  mergeAbort,
  mergeResolve,
  describePull,
  describePush,
  describeMerge,
  describeDisconnect,
  presentOutcome,
  settleOutcome,
  formatProgress,
  firstLine,
  type OutcomePresenter,
  type OutcomeActionTag,
  type ProgressUpdate,
} from "@volt/control"
import type { Shell } from "./context.js"
import { runDiagnostics } from "./panel.js"
import { openInOpencode } from "./agent.js"

// The desktop has no merge EDITOR (so no per-file `open-conflicts` / take-a-side — that's vscode's job), but
// finishing/aborting a merge needs no editor, so those are actionable here. presentOutcome filters to this set.
const DESKTOP_CAPS = new Set<OutcomeActionTag>(["force-pull", "pull-first", "force-push", "finish-merge", "abort-merge"])

export function registerCommands(ipcMain: IpcMain, dialog: Dialog, shell: Shell): void {
  // One progress channel for EVERY action (formatProgress is shared with vscode); null clears it.
  const report = (p: ProgressUpdate): void => void shell.win?.webContents.send("volt:progress", formatProgress(p))
  const clearProgress = (): void => void shell.win?.webContents.send("volt:progress", null)
  const notify = (type: "error" | "info", message: string): void => {
    if (shell.win) void dialog.showMessageBox(shell.win, { type, message })
  }

  // Every action runs through here: a throw ALWAYS surfaces as an error dialog and ALWAYS clears the progress
  // note (the renderer's busy spinner is cleared only by clearProgress's null frame). Without this, a thrown
  // action — e.g. the volt CLI binary missing on a partial install — left the spinner stuck forever with no
  // error shown. This is the desktop's report-on-failure, mirroring how vscode surfaces a command that throws.
  const runGuarded = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err))
    } finally {
      clearProgress()
    }
  }

  // The outcome flow (filter → confirm destructive → dispatch) is @volt/control's presentOutcome; the desktop
  // supplies only the dialog primitives. The destructive "cannot be undone" confirm now fires here too.
  const presenter: OutcomePresenter = {
    async choose(view) {
      if (!shell.win) return undefined
      const type = view.tone === "error" ? "error" : view.tone === "warn" ? "warning" : "info"
      if (view.actions.length === 0) {
        // Nothing to decide → no modal for a plain success (the panel already reflects the result; the acting
        // button's spinner was the in-progress feedback). Only errors/warnings still interrupt.
        if (view.tone !== "info") await dialog.showMessageBox(shell.win, { type, message: view.message })
        return undefined
      }
      const buttons = [...view.actions.map((a) => a.label), "Cancel"]
      const { response } = await dialog.showMessageBox(shell.win, { type, message: view.message, buttons, defaultId: 0, cancelId: buttons.length - 1 })
      return view.actions[response]?.tag
    },
    async confirm(action) {
      if (!shell.win) return false
      const { response } = await dialog.showMessageBox(shell.win, {
        type: "warning",
        message: action.confirmMessage ?? `${action.label}?`,
        buttons: [action.label, "Cancel"],
        defaultId: 1,
        cancelId: 1,
      })
      return response === 0
    },
  }

  async function runPull(force = false): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await pull(st.workspaceRoot, { force, onProgress: report })
    clearProgress()
    await settleOutcome(st, out)
    await presentOutcome(
      describePull(out),
      presenter,
      (tag) =>
        tag === "force-pull" ? runPull(true) : tag === "finish-merge" ? runFinishMerge() : tag === "abort-merge" ? runAbortMerge() : Promise.resolve(),
      DESKTOP_CAPS,
    )
  }
  async function runFinishMerge(): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await mergeContinue(st.workspaceRoot)
    clearProgress()
    await settleOutcome(st, out)
    await presentOutcome(
      describeMerge(out),
      presenter,
      (tag) => (tag === "finish-merge" ? runFinishMerge() : tag === "abort-merge" ? runAbortMerge() : Promise.resolve()),
      DESKTOP_CAPS,
    )
  }
  async function runAbortMerge(): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await mergeAbort(st.workspaceRoot)
    clearProgress()
    await settleOutcome(st, out)
    await presentOutcome(describeMerge(out), presenter, () => Promise.resolve(), DESKTOP_CAPS)
  }
  // Take a whole side for ONE conflicted file (mine = workspace, ide = IDE), then re-present so a now-fully-resolved
  // merge surfaces its Finish action. The per-file resolution the desktop was missing — the CLI/control already
  // had it (mergeResolve); this just wires the two buttons, like VS Code's take-a-side.
  async function runMergeResolve(path: string, side: "mine" | "ide"): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await mergeResolve(st.workspaceRoot, path, side)
    clearProgress()
    await settleOutcome(st, out)
    await presentOutcome(
      describeMerge(out),
      presenter,
      (tag) => (tag === "finish-merge" ? runFinishMerge() : tag === "abort-merge" ? runAbortMerge() : Promise.resolve()),
      DESKTOP_CAPS,
    )
  }
  async function runPush(force = false): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await push(st.workspaceRoot, { force, onProgress: report })
    clearProgress()
    await settleOutcome(st, out)
    await presentOutcome(
      describePush(out, st.cached),
      presenter,
      (tag) => (tag === "pull-first" ? runPull(false) : tag === "force-push" ? runPush(true) : Promise.resolve()),
      DESKTOP_CAPS,
    )
  }

  ipcMain.handle("volt:pull", () => runGuarded(() => runPull()))
  ipcMain.handle("volt:push", () => runGuarded(() => runPush()))
  // Force + merge finalisation as FIRST-CLASS actions, not just outcome-dialog buttons. They were reachable only
  // reactively (after a refused pull/push), so a workspace that was ALREADY mid-merge when the app opened had no
  // way out: the section said "resolve the files, then finish the merge" and offered nothing to finish it with.
  ipcMain.handle("volt:forcePull", () => runGuarded(() => runPull(true)))
  ipcMain.handle("volt:forcePush", () => runGuarded(() => runPush(true)))
  ipcMain.handle("volt:finishMerge", () => runGuarded(() => runFinishMerge()))
  ipcMain.handle("volt:abortMerge", () => runGuarded(() => runAbortMerge()))
  ipcMain.handle("volt:mergeResolve", (_e, path: string, side: "mine" | "ide") => runGuarded(() => runMergeResolve(path, side)))
  ipcMain.handle("volt:build", () =>
    runGuarded(async () => {
      const st = shell.status
      if (!st) return
      const r = await build(st.workspaceRoot, { onProgress: report })
      clearProgress()
      await st.refresh(true)
      void runDiagnostics(shell) // a build can change diagnostics
      if (r.code !== 0) notify("error", `Build failed: ${firstLine(r.stderr) || `exit ${r.code}`}`)
    }),
  )
  ipcMain.handle("volt:connect", () =>
    runGuarded(async () => {
      const st = shell.status
      if (!st) return
      const r = await reconnectBound(st.workspaceRoot)
      // Refresh status BEFORE the spinner clears — the connect invalidated the connector's cache, so this re-scans and
      // shows the project SERVING. The spinner is cleared by runGuarded's finally AFTER this, so it never flips onto a
      // stale "disconnected" (the flash). The select's own response (r.ok) is what gates success, not a timer.
      await st.refresh(true)
      if (!r.ok) notify("error", r.message ?? "Reconnect failed.") // success needs no popup; the UI shows it
    }),
  )
  ipcMain.handle("volt:disconnect", () =>
    runGuarded(async () => {
      // The bridge stops serving sync; the IDE stays open and re-connectable (nothing is torn down).
      // This workspace's project, not the tray's active connection (see the VS Code command).
      const r = await disconnect(await boundProjectId(shell.status?.workspaceRoot ?? ""))
      // Refresh BEFORE the spinner clears (runGuarded's finally) — disconnect invalidated the cache, so status re-scans
      // to "disconnected" now instead of the spinner flipping onto a stale "connected".
      await shell.status?.refresh(true)
      // Described ONCE in @volt/control so this and the VS Code command can't word it differently — they already
      // did (this reported an out-of-date bridge as an "error", VS Code as a "warning", for the same event).
      // Only surface a problem (error, or the out-of-date-bridge warning) — a clean disconnect needs no popup.
      const view = describeDisconnect(r)
      if (view.tone !== "info") notify(view.tone === "error" ? "error" : "info", view.message)
    }),
  )
  // Re-point the workspace to a DIFFERENT detected project — the reconnect list's "rebind" action (a rename in the
  // IDE, or binding the wrong project). Config-only: reconnects the bridge + rewrites the binding, no re-seed and no
  // folder rename (the user pulls afterward). The renderer confirms first. runGuarded's finally clears the spinner.
  ipcMain.handle("volt:rebind", (_e, projectId: string) =>
    runGuarded(async () => {
      const st = shell.status
      if (!st) return
      const project = shell.projects.find((p) => p.id === projectId)
      if (project === undefined) return notify("error", "That project is no longer detected — open it in your IDE and try again.")
      const r = await rebind(st.workspaceRoot, project)
      await st.refresh(true)
      if (!r.ok) notify("error", `Couldn't rebind: ${r.message ?? "unknown error"}`) // success shows in the panel
    }),
  )
  ipcMain.on("volt:refresh", () => void shell.status?.refresh(true))
  ipcMain.on("volt:refreshDiagnostics", () => void runDiagnostics(shell))
  ipcMain.handle("volt:init", (_e, projectId: string) =>
    runGuarded(async () => {
      // The user picked a DETECTED PROJECT (not a vendor); resolve it and derive the vendor from it.
      if (!shell.win) return
      const project = shell.projects.find((p) => p.id === projectId)
      if (project === undefined) return notify("error", "That project is no longer detected — open it in your IDE and try again.")

      // Pick a PARENT location; `volt init` CREATES a folder named after the IDE project inside it (git-clone
      // semantics) and reports the path back. opencode's own UI can only ADD an existing project — it can't create
      // a folder — so the user would otherwise hand-make an empty "New folder (2)" first. The picker + button IS
      // the confirmation (no separate dialog).
      const picked = await dialog.showOpenDialog(shell.win, {
        title: `Create a Volt workspace for “${project.displayName}”`,
        defaultPath: shell.boundRoot && existsSync(shell.boundRoot) ? join(shell.boundRoot, "..") : undefined,
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Create here",
      })
      if (picked.canceled || picked.filePaths.length === 0) return

      const out = await initFromProject(project, picked.filePaths[0], { onProgress: report })
      clearProgress()
      if (out.code === 0 && out.workspace) {
        // OPEN the new workspace in opencode → its follow-binding picks it up (mirror model). We do NOT bindWorkspace
        // directly: opencode is the single source of "which project is active", so a direct bind would fight the
        // follow-driver and get released the moment opencode is elsewhere. If opencode isn't running, the folder is
        // still created — tell the user where it is so they can open it.
        const opened = await openInOpencode(shell.opencodeUrl, shell.view, out.workspace)
        if (!opened) notify("info", `Created the Volt workspace at ${out.workspace}. Open it in opencode to start syncing.`)
      } else notify("error", `Initialize failed: ${firstLine(out.stderr) || (out.code === 0 ? "no workspace path reported" : `exit ${out.code}`)}. Open your PLC project and start its bridge from the Volt Connector (tray), then try again.`)
    }),
  )
}
