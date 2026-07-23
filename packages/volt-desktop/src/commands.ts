// The pull/push/build/init actions — the desktop counterpart of the extension's commands.ts. The FLOW (adopt
// vs refresh, outcome filtering + destructive-confirm, progress formatting) lives in @volt/control; this file
// only supplies Electron's native primitives (dialogs + IPC) and wires them to the shared functions.
import { existsSync } from "node:fs"
import type { Dialog, IpcMain } from "electron"
import {
  pull,
  push,
  build,
  initFromProject,
  reconnectBound,
  disconnect,
  mergeContinue,
  mergeAbort,
  describePull,
  describePush,
  describeMerge,
  presentOutcome,
  settleOutcome,
  formatProgress,
  firstLine,
  type OutcomePresenter,
  type OutcomeActionTag,
  type ProgressUpdate,
} from "@volt/control"
import type { Shell } from "./context.js"
import { bindWorkspace, runDiagnostics } from "./panel.js"

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
        await dialog.showMessageBox(shell.win, { type, message: view.message })
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
      clearProgress()
      await st.refresh(true) // reflect the new bridge selection in status
      if (r.ok) notify("info", "Reconnected to the IDE.")
      else notify("error", r.message ?? "Reconnect failed.")
    }),
  )
  ipcMain.handle("volt:disconnect", () =>
    runGuarded(async () => {
      // The bridge stops serving sync; the IDE stays open and re-connectable (nothing is torn down).
      await disconnect()
      clearProgress()
      await shell.status?.refresh(true)
      notify("info", "Disconnected — the IDE stays open. Connect again to resume syncing.")
    }),
  )
  ipcMain.on("volt:refresh", () => void shell.status?.refresh(true))
  ipcMain.on("volt:refreshDiagnostics", () => void runDiagnostics(shell))
  ipcMain.handle("volt:init", (_e, projectId: string) =>
    runGuarded(async () => {
      // Init the project opencode is on — no folder picker (like the extension initing its open workspace). The
      // user picked a DETECTED PROJECT (not a vendor); resolve it and derive the vendor from it.
      const root = shell.boundRoot
      if (root === undefined || !existsSync(root)) return notify("error", "No project open in opencode.")
      const project = shell.projects.find((p) => p.id === projectId)
      if (project === undefined) return notify("error", "That project is no longer detected — open it in your IDE and try again.")
      const out = await initFromProject(project, root, { onProgress: report })
      clearProgress()
      if (out.code === 0) await bindWorkspace(shell, root)
      else notify("error", `Initialize failed: ${firstLine(out.stderr) || `exit ${out.code}`}. Open your PLC project and start its bridge from the Volt Connector (tray), then try again.`)
    }),
  )
}
