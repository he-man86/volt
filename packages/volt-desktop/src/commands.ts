// The pull/push/build/init actions — the desktop counterpart of the extension's commands.ts. The FLOW (adopt
// vs refresh, outcome filtering + destructive-confirm, progress formatting) lives in @volt/control; this file
// only supplies Electron's native primitives (dialogs + IPC) and wires them to the shared functions.
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Dialog, IpcMain } from "electron"
import {
  FORCE_PULL,
  FORCE_PUSH,
  ABORT_MERGE,
  pull,
  push,
  build,
  initFromProject,
  rebind,
  connectWorkspace,
  disconnectWorkspace,
  mergeContinue,
  mergeAbort,
  mergeResolve,
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
  // End an action by leaving its RESULT in the titlebar/panel progress line (which the user is already watching)
  // instead of a modal. For connect/disconnect: neither is destructive, and the panel itself shows the state that
  // resulted — a dialog to dismiss was pure friction. The renderer holds a `done` frame briefly, then clears.
  const finish = (message: string, tone: "info" | "error" = "info"): void =>
    void shell.win?.webContents.send("volt:progress", { message, done: true, tone })
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
    // A pull rewrites source, so the Diagnostics body and the rail badge are stale the moment it lands. Nothing
    // else re-fires them — the status watcher drives only `pushStatus` — so they held PRE-pull counts until
    // someone pressed Re-analyze. The VS Code sibling gets this free from `onDidChangeDiagnostics`, which is how
    // one workspace could show two different problem counts in two windows.
    //
    // GATED on `ok`: a conflicted pull leaves `<<<<<<<` markers on disk, and analysing those badges the rail
    // with a flood of parse errors that say nothing except "you are mid-merge" — which the panel already says.
    if (out.kind === "ok") void runDiagnostics(shell)
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
    // `mergeContinue` writes no source itself — it stages and commits. It re-fires anyway because the desktop
    // has no merge editor: the engineer resolved those conflicts in some OTHER editor, and Finish is this app's
    // first chance to catch up with what they did there.
    void runDiagnostics(shell)
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
    void runDiagnostics(shell) // restores the pre-pull workspace — a wholesale tree rewrite, so counts are stale
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
  // THE DESTRUCTIVE THREE CONFIRM HERE, in the main process, using @volt/control's copy.
  //
  // These were registered unguarded: the only gate on an unrecoverable overwrite was a `confirm()` in
  // `shell.html` — a file nothing typechecks, nothing bundles and no test executes, where a syntax error takes
  // every handler down silently (it has happened). An IPC channel that force-pushes with no main-process check
  // is one renderer bug away from doing it unasked.
  //
  // `@volt/control` declares itself the owner of this wording (`view/outcomes.ts`) precisely so "neither UI can
  // skip the 'cannot be undone' confirm", and the same force push already showed control's text when it arrived
  // as an outcome ACTION while showing the renderer's from the ⋯ menu. One of the two had drifted: the local
  // copy dropped "the engineer", and the engineer's changes are the entire reason a force push is dangerous.
  ipcMain.handle("volt:forcePull", () =>
    runGuarded(async () => {
      if (await presenter.confirm(FORCE_PULL)) await runPull(true)
    }),
  )
  ipcMain.handle("volt:forcePush", () =>
    runGuarded(async () => {
      if (await presenter.confirm(FORCE_PUSH)) await runPush(true)
    }),
  )
  ipcMain.handle("volt:finishMerge", () => runGuarded(() => runFinishMerge()))
  ipcMain.handle("volt:abortMerge", () =>
    runGuarded(async () => {
      if (await presenter.confirm(ABORT_MERGE)) await runAbortMerge()
    }),
  )
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
      // The flow (declare interest → settle health → word the result) is @volt/control's, shared with VS Code.
      const view = await connectWorkspace(st)
      finish(view.message, view.tone === "error" ? "error" : "info")
    }),
  )
  ipcMain.handle("volt:disconnect", () =>
    runGuarded(async () => {
      // Drop THIS workspace's interest — the bridge stops serving only if no other window wants it; the IDE stays open.
      const st = shell.status
      if (!st) return
      // Same shared flow as Connect — the desktop only decides that the result lands in the progress line.
      const view = await disconnectWorkspace(st)
      finish(view.message, view.tone === "error" ? "error" : "info")
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
      // semantics) and reports the path back. The picker + button IS the confirmation (no separate dialog).
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
        // Volt OWNS the folder it just created, so bind it DIRECTLY — the panel is synced instantly, and the app
        // reopens on it next launch (bindWorkspace records it).
        await bindWorkspace(shell, out.workspace)
        notify("info", `Created and synced the Volt workspace at ${out.workspace}. Open that folder in your editor or AI agent to work on it.`)
      } else notify("error", `Initialize failed: ${firstLine(out.stderr) || (out.code === 0 ? "no workspace path reported" : `exit ${out.code}`)}. Open your PLC project and start its bridge from the Volt Connector (tray), then try again.`)
    }),
  )

  // Open an EXISTING Volt workspace. Without opencode there is no external "current project" signal, so besides the
  // remembered last workspace this is the only way back into a workspace that already exists — and the only way to
  // switch between two of them. Binding a folder that isn't a Volt workspace is not an error: the panel says so and
  // offers to set it up.
  ipcMain.handle("volt:openWorkspace", async () => {
    if (!shell.win) return
    const picked = await dialog.showOpenDialog(shell.win, {
      title: "Open a Volt workspace",
      defaultPath: shell.boundRoot && existsSync(shell.boundRoot) ? shell.boundRoot : undefined,
      properties: ["openDirectory"],
      buttonLabel: "Open",
    })
    if (picked.canceled || picked.filePaths.length === 0) return
    await bindWorkspace(shell, picked.filePaths[0])
  })
}
