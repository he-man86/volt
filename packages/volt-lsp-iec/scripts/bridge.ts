/**
 * Shared bridge client for the LSP dev/recording scripts — speaks the Volt named-pipe wire directly. `call(op,
 * body)` writes one `{op,body}` frame and resolves the terminal result; the pipe host serves byte-identical Core
 * responses, so a re-record over the pipe reproduces the same ground truth the old HTTP recorder did.
 *
 * VOLT_VENDOR picks the vendor (`codesys` default / `twincat` → pipe `volt.bridge.twincat`); VOLT_PIPE overrides
 * the pipe name outright.
 */
import { connect } from "node:net"

export const VENDOR = process.env.VOLT_VENDOR === "twincat" ? "twincat" : "codesys"

/** The pipe for a given vendor (default: VOLT_VENDOR), honoring a VOLT_PIPE override. */
export function pipeName(vendor: string = VENDOR): string {
  return process.env.VOLT_PIPE || `volt.bridge.${vendor}`
}

export const TARGET = `pipe ${pipeName()}`

/** One request per connection (mirrors the CLI's PipeClient): write `{op,body}\n`, drain newline-JSON frames,
 *  resolve the terminal result (an error frame rejects; progress frames are ignored). */
export function call(op: string, body?: unknown, pipe: string = pipeName()): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect(`\\\\.\\pipe\\${pipe}`)
    let buf = ""
    let result: unknown
    sock.on("connect", () => sock.write(JSON.stringify({ op, body: body ?? undefined }) + "\n"))
    sock.on("data", (d: Buffer) => {
      buf += d.toString("utf8")
      let nl: number
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line) continue
        const frame = JSON.parse(line)
        if ("result" in frame) result = frame.result
        else if ("error" in frame) { reject(new Error(`${frame.error.code}: ${frame.error.message}`)); sock.destroy(); return }
        // progress frames ignored
      }
    })
    sock.on("end", () => resolve(result))
    sock.on("error", reject)
  })
}

