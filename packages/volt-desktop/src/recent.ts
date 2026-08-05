// The last workspace the desktop was bound to.
//
// VS Code has an open folder and the CLI has a working directory; this app has neither, so without a memory a
// returning user would land on the CREATE surface every launch — offered a brand-new workspace while the one they
// already have sits unreachable. That is the whole reason this file exists. `main` points it at a file under
// userData; `panel` records every bind.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { voltLog } from "@volt/control"

let file: string | undefined

/** Point the recent-workspace store at its file (userData). Until this is called, reads/writes are no-ops. */
export function setRecentFile(path: string): void {
  file = path
}

/** The last bound workspace, if it still exists on disk. Absent file = first run, not an error. */
export function readRecent(): string | undefined {
  if (file === undefined || !existsSync(file)) return undefined
  let root: unknown
  try {
    root = JSON.parse(readFileSync(file, "utf8")).workspaceRoot
  } catch (err) {
    // Not silent: a corrupt store means the app "forgot" the user's project, which is otherwise indistinguishable
    // from a bug in the binding itself.
    voltLog("desktop", `recent-workspace store unreadable (${(err as Error).message}) — starting unbound`, "warn")
    return undefined
  }
  if (typeof root !== "string") return undefined
  // The folder can be gone (moved, deleted, an unplugged drive). Binding a missing root would fail every command
  // with a confusing error instead of showing the picker.
  if (!existsSync(root)) {
    voltLog("desktop", `last workspace ${root} no longer exists — starting unbound`)
    return undefined
  }
  return root
}

export function writeRecent(root: string): void {
  if (file === undefined) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ workspaceRoot: root }, null, 2))
  } catch (err) {
    voltLog("desktop", `couldn't record the last workspace: ${(err as Error).message}`, "warn")
  }
}
