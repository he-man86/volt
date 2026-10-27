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
 * <p>The answer names every op that did not land in `conflicts` (the refused op, then each op it stopped as
 * `NOT_ATTEMPTED`), and carries `newProjectVersion` exactly when something landed (openspec `wire-final-shape`). A
 * push landed in full when it carries a new version and no conflict.</p>
 */
export function landedInFull(r: { newProjectVersion?: string; conflicts?: readonly unknown[] }): boolean {
  return typeof r.newProjectVersion === "string" && (r.conflicts ?? []).length === 0
}

/** The wire protocol every request states (volt-cli's `WireProtocol.Version`); a bridge of another refuses it
 *  `PROTOCOL_MISMATCH` before anything runs. */
const WIRE_PROTOCOL = 1

/** One request per connection (mirrors the CLI's PipeClient): write `{op,protocol,body}\n`, drain newline-JSON frames,
 *  resolve the terminal result (an error frame rejects; progress frames are ignored). */
export function call(op: string, body?: unknown, pipe: string = pipeName()): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect(`\\\\.\\pipe\\${pipe}`)
    let buf = ""
    let result: unknown
    sock.on("connect", () => sock.write(JSON.stringify({ op, protocol: WIRE_PROTOCOL, body: body ?? undefined }) + "\n"))
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
 * started has it off and pulls every LD and FBD body as its `%LANGUAGE LD|FBD UNSUPPORTED` line: a corpus
 * refreshed through one lost every ladder while the file count it checks still matched, and the LSP gate stayed green
 * (an UNSUPPORTED line draws nothing). The bridge states the languages it shows in `health` (`languages`); ask before
 * anything is pulled or pushed.
 */
export async function requireNetworkText(pipe: string = pipeName()): Promise<void> {
  const health = await call("health", undefined, pipe)
  const shown: unknown = health?.languages
  if (Array.isArray(shown) && shown.includes("LD") && shown.includes("FBD")) return
  throw new Error(
    `LD and FBD network text is OFF in the bridge on pipe ${pipe}, so every LD and FBD body would come back as its ` +
      "`%LANGUAGE LD|FBD UNSUPPORTED` line. The switch is the BRIDGE's environment (VOLT_GRAPHICAL=1), not this " +
      "script's: serve the project with `pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor <vendor>`, which starts the " +
      "IDE with it, instead of the connector.",
  )
}
