/**
 * Shared bridge client for the LSP dev/recording scripts — speaks the Volt named-pipe wire (the HTTP endpoints are
 * gone with the volt-cli cutover). `get`/`post` keep the old path-based call sites working by mapping a route
 * ("/refs", "/build") to the pipe op ("refs", "build"); the pipe host serves byte-identical Core responses, so a
 * re-record over the pipe reproduces the same ground truth the HTTP recorder did.
 *
 * VOLT_BRIDGE_PORT stays the vendor selector (8555 = TwinCAT → pipe `volt.bridge.beckhoff`, else CODESYS →
 * `volt.bridge.codesys`); VOLT_PIPE overrides the pipe name outright.
 */
import { connect } from "node:net"

export const PORT = process.env.VOLT_BRIDGE_PORT ?? "8556"

/** The pipe for a given port (default: VOLT_BRIDGE_PORT), honoring a VOLT_PIPE override. */
export function pipeName(port: string = PORT): string {
  return process.env.VOLT_PIPE || (port === "8555" ? "volt.bridge.beckhoff" : "volt.bridge.codesys")
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

const opOf = (path: string): string => path.replace(/^\//, "").split("?")[0]

export const get = (path: string): Promise<any> => call(opOf(path))
export const post = (path: string, body?: unknown): Promise<any> => call(opOf(path), body)
