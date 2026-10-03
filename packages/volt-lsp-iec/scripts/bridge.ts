/**
 * Shared bridge client for the LSP dev/recording scripts — speaks the Volt named-pipe wire directly. `call(op,
 * body)` writes one `{op,body}` frame and resolves the terminal result; the pipe host serves byte-identical Core
 * responses, so a re-record over the pipe reproduces the same ground truth the old HTTP recorder did.
 *
 * WHICH PIPE: only an `ide.ps1` fixture instance's — the ONE rule every script that drives a bridge from this checkout
 * follows, implemented once in volt-cli (`packages/volt-cli/test/e2e/lib/fixture-ide.ts`, beside the launcher whose
 * records it reads). `VOLT_E2E_INSTANCE` names the instance (unset = the default one), or `VOLT_PIPE` names one exact
 * `volt.bridge.<vendor>.<pid>` that an instance provably owns; anything else is refused, naming the pipes and projects it
 * will not touch. These scripts used to take `VOLT_PIPE` unchecked or the single pipe under the vendor PREFIX — and a
 * prefix cannot tell a fixture copy from an engineer's own project (the e2e suite once wrote into an 881-item one).
 * VOLT_VENDOR picks the vendor (`codesys` default / `twincat`).
 */
import { connect } from "node:net"
import { scriptPipe, vendorOf, type Vendor } from "../../volt-cli/test/e2e/lib/fixture-ide.js"

export const VENDOR: Vendor = vendorOf(process.env.VOLT_VENDOR)

const resolved = new Map<Vendor, string>()

/**
 * The pipe of `vendor` (default: VOLT_VENDOR) — resolved through the fixture-instance rule on first use and kept for the
 * run. Throws `FixtureRefusal`; there is no fallback name, because a fallback is a guess.
 */
export function pipeName(vendor: Vendor = VENDOR): string {
  let pipe = resolved.get(vendor)
  if (pipe === undefined) resolved.set(vendor, (pipe = scriptPipe(vendor)))
  return pipe
}

/** What a log line names as the target. Resolves (a script prints it before its first call). */
export const target = (): string => `pipe ${pipeName()}`

/**
 * Did a push land IN FULL — every op of it in the IDE?
 *
 * <p>`accepted` alone does not say so (openspec `push-keeps-what-landed`): when the live IDE refuses an op after
 * earlier ops landed, the push stops there and answers `accepted: true` with the receipt PLUS one conflict per op
 * that did not land (the refused op, then each later op as `NOT_ATTEMPTED`). A script that reads `accepted` alone
 * then builds a project missing the refused item and writes that build down as the fixture's — a clean build on
 * something that is not there. A full push carries no `conflicts` (the wire omits it), so absent or empty is "none".</p>
 */
export function landedInFull(r: { accepted?: boolean; conflicts?: readonly unknown[] | null }): boolean {
  return r.accepted === true && (r.conflicts == null || r.conflicts.length === 0)
}

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
