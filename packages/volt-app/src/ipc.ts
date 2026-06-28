/**
 * The `window.volt` IPC contract — the renderer-facing surface of @opencode-ai/volt-control.
 *
 * The desktop main process (packages/desktop) runs volt-control (Node) and exposes these
 * over Electron IPC via a preload `contextBridge.exposeInMainWorld("volt", …)`. The renderer
 * (this package) only ever calls `window.volt.*` — it never imports volt-control's Node code.
 *
 * Types are erased at build (`import type`), so importing volt-control here pulls in NO runtime.
 */
import type { StatusResult, PullOutcome, PushOutcome, CliResult, IdeDiff, VendorProbe } from "@opencode-ai/volt-control"

export type { StatusResult, PullOutcome, PushOutcome, CliResult, IdeDiff, VendorProbe }

export interface VoltBridge {
  detect(dir: string): Promise<boolean>
  status(dir: string): Promise<StatusResult>
  pull(dir: string, opts?: { force?: boolean }): Promise<PullOutcome>
  push(dir: string, opts?: { force?: boolean }): Promise<PushOutcome>
  build(dir: string): Promise<CliResult>
  show(dir: string, ref: string, rel: string): Promise<{ stdout: string; stderr: string; code: number }>
  diff(dir: string): Promise<IdeDiff[]>
  probe(twincatPort?: number, codesysPort?: number): Promise<VendorProbe[]>
  init(dir: string, port: number): Promise<CliResult>
}

declare global {
  interface Window {
    volt?: VoltBridge
  }
}
