/**
 * Shared bridge client for the LSP dev/recording scripts — speaks the Volt named-pipe wire directly. `call(op,
 * body)` writes one `{op,body}` frame and resolves the terminal result; the pipe host serves byte-identical Core
 * responses, so a re-record over the pipe reproduces the same ground truth the old HTTP recorder did.
 *
 * VOLT_VENDOR picks the vendor (`codesys` default / `twincat` → pipe `volt.bridge.twincat`); VOLT_PIPE overrides
 * the pipe name outright.
 */
import { readdirSync } from "node:fs"
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

/**
 * The ONE live pipe of `vendor` a script should talk to: `VOLT_PIPE` when set, else the single per-pid
 * `volt.bridge.<vendor>.<pid>` pipe that is up. None or several is an error naming them — a script that picked one of
 * two IDEs would record the wrong project, and the CLI refuses the same ambiguity (`BridgeResolver`).
 */
export function servedPipe(vendor: string = VENDOR): string {
  if (process.env.VOLT_PIPE) return process.env.VOLT_PIPE
  const live = readdirSync("\\\\.\\pipe\\").filter((n) => n.startsWith(`volt.bridge.${vendor}.`))
  if (live.length === 1) return live[0]!
  throw new Error(
    live.length === 0
      ? `no ${vendor} bridge is up — serve the project with \`pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor ${vendor}\``
      : `${live.length} ${vendor} bridges are up (${live.join(", ")}) — name the one to use with VOLT_PIPE`,
  )
}

/**
 * Refuse to go on unless LD and FBD network text is ON in the bridge behind `pipe`.
 *
 * WHY: the switch (`VOLT_GRAPHICAL=1`, volt-cli's `NetworkTextSwitch`) is read from the BRIDGE's own process — inside
 * CODESYS, or in the TwinCAT worker — never from this script's, so setting it here does nothing. A bridge the connector
 * started has it off and pulls every LD and FBD body as its `IMPLEMENTATION LD|FBD UNSUPPORTED` line: a corpus
 * refreshed through one lost every ladder while the file count it checks still matched, and the LSP gate stayed green
 * (an UNSUPPORTED line draws nothing). The bridge reports its switch in `health` (`networkText`); ask before anything
 * is pulled or pushed. Absent is off — a bridge from before the field cannot say it is on.
 */
export async function requireNetworkText(pipe: string = pipeName()): Promise<void> {
  const health = await call("health", undefined, pipe)
  if (health?.networkText === true) return
  throw new Error(
    `LD and FBD network text is OFF in the bridge on pipe ${pipe}, so every LD and FBD body would come back as its ` +
      "`IMPLEMENTATION LD|FBD UNSUPPORTED` line. The switch is the BRIDGE's environment (VOLT_GRAPHICAL=1), not this " +
      "script's: serve the project with `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor <vendor>`, which starts the " +
      "IDE with it, instead of the connector.",
  )
}
