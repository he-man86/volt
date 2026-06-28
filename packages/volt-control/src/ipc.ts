import { setBundledCli } from "./cli.js"
import { fetchStatus, pull, push, build, detect, showFile, ideDiff, init } from "./actions.js"
import { probeVendors } from "./health.js"
import { VOLT_CHANNELS as CH } from "./channels.js"

/** Minimal shape of Electron's `ipcMain` we use — keeps volt-control free of an electron dep. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void
}

/**
 * Wire the Volt CLI over Electron IPC. Call once from the desktop main process, passing the
 * path to the bundled `volt` CLI (a PLC workspace has no volt CLI in node_modules). The renderer
 * passes the workspace dir on every call; this process is a thin pass-through to volt-control.
 *
 * Channel names match the `window.volt` contract the desktop preload exposes (see volt-app/ipc.ts).
 */
export function registerVoltIpcHandlers(ipcMain: IpcMainLike, cliPath?: string): void {
  if (cliPath) setBundledCli(cliPath)
  ipcMain.handle(CH.detect, (_e, dir: string) => detect(dir))
  ipcMain.handle(CH.status, (_e, dir: string) => fetchStatus(dir))
  ipcMain.handle(CH.pull, (_e, dir: string, opts?: { force?: boolean }) => pull(dir, opts))
  ipcMain.handle(CH.push, (_e, dir: string, opts?: { force?: boolean }) => push(dir, opts))
  ipcMain.handle(CH.build, (_e, dir: string) => build(dir))
  ipcMain.handle(CH.show, async (_e, dir: string, ref: string, rel: string) => {
    const r = await showFile(dir, ref, rel)
    return { stdout: r.stdout.toString("utf-8"), stderr: r.stderr, code: r.code }
  })
  ipcMain.handle(CH.diff, (_e, dir: string) => ideDiff(dir))
  ipcMain.handle(CH.probe, (_e, twincatPort?: number, codesysPort?: number) =>
    probeVendors(twincatPort ?? 8555, codesysPort ?? 8556),
  )
  ipcMain.handle(CH.init, (_e, dir: string, port: number) => init(dir, port))
}
