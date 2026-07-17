// The pull/push/build/init actions — the desktop counterpart of the extension's commands.ts. Same shared
// logic (@volt/control), same outcome descriptors; the difference is only how they're triggered (Electron
// IPC from shell.html) and rendered (native dialogs vs VS Code notifications).
import { existsSync } from "node:fs"
import type { Dialog, IpcMain } from "electron"
import {
  VoltStatus,
  pull,
  push,
  build,
  init,
  describePull,
  describePush,
  vendorPort,
  type OutcomeView,
  type OutcomeActionTag,
  type PullOutcome,
  type PushOutcome,
} from "@volt/control"
import type { Shell } from "./context.js"
import { bindWorkspace, runDiagnostics } from "./panel.js"

// The desktop has no merge editor, so it offers only the outcome actions it can act on (force / pull-first);
// a conflict's message is self-explanatory. The decision of WHICH actions exist lives in @volt/control.
const DESKTOP_ACTIONS = new Set<OutcomeActionTag>(["force-pull", "pull-first", "force-push"])

export function registerCommands(ipcMain: IpcMain, dialog: Dialog, shell: Shell): void {
  // Render the neutral outcome descriptor as a native Electron dialog and dispatch the chosen action.
  async function presentOutcome(view: OutcomeView, run: (tag: OutcomeActionTag) => Promise<void>): Promise<void> {
    if (!shell.win) return
    const actions = view.actions.filter((a) => DESKTOP_ACTIONS.has(a.tag))
    const type = view.tone === "error" ? "error" : view.tone === "warn" ? "warning" : "info"
    if (actions.length === 0) {
      await dialog.showMessageBox(shell.win, { type, message: view.message })
      return
    }
    const buttons = [...actions.map((a) => a.label), "Cancel"]
    const { response } = await dialog.showMessageBox(shell.win, { type, message: view.message, buttons, defaultId: 0, cancelId: buttons.length - 1 })
    const chosen = actions[response]
    if (chosen !== undefined) await run(chosen.tag)
  }

  // Adopt the status the action returned (ONE bridge call, no follow-up /refs); only re-fetch when the action
  // didn't succeed (state uncertain) — the ok-without-status case (nothing to push) leaves the view unchanged.
  async function settle(st: VoltStatus, out: PullOutcome | PushOutcome): Promise<void> {
    if (out.kind === "ok") {
      if (out.status) st.adopt(out.status)
    } else await st.refresh(true)
  }

  async function runPull(force = false): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await pull(st.workspaceRoot, { force })
    await settle(st, out)
    await presentOutcome(describePull(out), (tag) => (tag === "force-pull" ? runPull(true) : Promise.resolve()))
  }
  async function runPush(force = false): Promise<void> {
    const st = shell.status
    if (!st) return
    const out = await push(st.workspaceRoot, { force })
    await settle(st, out)
    await presentOutcome(describePush(out), (tag) =>
      tag === "pull-first" ? runPull(false) : tag === "force-push" ? runPush(true) : Promise.resolve(),
    )
  }

  ipcMain.handle("volt:pull", () => runPull())
  ipcMain.handle("volt:push", () => runPush())
  ipcMain.handle("volt:build", async () => {
    const st = shell.status
    if (!st) return { stdout: "", stderr: "no workspace bound", code: 255 }
    const r = await build(st.workspaceRoot)
    await st.refresh(true)
    void runDiagnostics(shell) // a build can change diagnostics
    return r
  })
  ipcMain.on("volt:refresh", () => void shell.status?.refresh(true))
  ipcMain.on("volt:refreshDiagnostics", () => void runDiagnostics(shell))
  ipcMain.handle("volt:init", async (_e, vendor: "codesys" | "twincat") => {
    // Init the project opencode is on — no folder picker (like the extension initing its open workspace).
    const root = shell.boundRoot
    if (root === undefined || !existsSync(root)) return { stdout: "", stderr: "No project open in opencode.", code: 255 }
    const out = await init(root, vendorPort(vendor), {
      onProgress: (p) => shell.win?.webContents.send("volt:initProgress", p), // live progress in the init row
    })
    shell.win?.webContents.send("volt:initProgress", null) // clear the progress note when done
    if (out.code === 0) await bindWorkspace(shell, root)
    return out
  })
}
