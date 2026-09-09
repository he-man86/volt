/**
 * THE WIRE — discovering the live bridge pipe and making one call on it. Nothing above this layer knows what a
 * socket is.
 *
 * <p>Everything here is transport. The typed op client is `bridge.ts`; item helpers are `workspace.ts`. That
 * separation is the point: this file was one fifth of a 569-line `harness.ts` that also owned fixtures, cleanup,
 * PLC_PRG surgery and assertion helpers, so a test needing one op pulled in all of it.</p>
 *
 * <p><b>There is no `get`/`post` here.</b> The suite used to call the bridge as if it were an HTTP server —
 * `get("/health")`, `post("/fetch", req)` — through an `opOf()` that stripped a leading slash and a query string
 * off a URL path to recover the op name. The HTTP wire was deleted from the product; the tests kept speaking it
 * for a server that no longer exists. Ops are named, because the wire names them (`Volt.Contracts.Vocabulary.Ops`).</p>
 */
import { readdirSync } from "node:fs"
import { connect } from "node:net"

/** Which vendor's bridge this run targets. Tests must not branch on it — see `bridge.ts`. */
export const VENDOR = process.env.VOLT_VENDOR === "twincat" ? "twincat" : "codesys"

// Discovery is by PREFIX, so an IDE that restarts with a new pid is followed. `VOLT_PIPE` may name either an exact
// pipe or a prefix; naming an exact pipe means THAT pipe — if it is not serving, we say so rather than retargeting.
const PIPE_PREFIX = process.env.VOLT_PIPE || `volt.bridge.${VENDOR}`

/**
 * Is the pid in `volt.bridge.<vendor>.<pid>` still a running process?
 *
 * <p>A killed TwinCAT XAE's worker keeps serving its pipe for up to ~15s until the connector reaps it, and that
 * pipe answers PLC_DISCONNECTED ("waiting for an IDE project") — so picking it looks exactly like a product bug.
 * The pipe is NAMED after the IDE's pid, so liveness is a cheap sync check. Un-suffixed or unparsable names are
 * kept (nothing to check). Same reason the CLI has a BridgeResolver: never target a bridge that isn't serving.</p>
 *
 * <p>KNOWN LIMIT: the OS may reuse a pid, so a false "alive" is possible. It surfaces as a failed call on that
 * pipe rather than a wrong answer, which is the right direction to fail in.</p>
 */
function ideAlive(pipeName: string): boolean {
	const pid = Number(pipeName.split(".").pop())
	if (!Number.isInteger(pid) || pid <= 0) return true
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/** The live per-pid pipe(s) matching the target — the `VOLT_PIPE` pipe/prefix, else every pipe of this vendor. */
export function livePipes(): string[] {
	try {
		const matching = readdirSync("\\\\.\\pipe\\").filter((n) => n === PIPE_PREFIX || n.startsWith(PIPE_PREFIX + "."))
		// PREFER pipes whose IDE is alive, so a stale worker is never picked while a live bridge exists. But if none
		// is alive, still return the real pipes: a TwinCAT worker deliberately OUTLIVES its IDE (~15s until the
		// connector reaps it) and must answer PLC_DISCONNECTED from that window — a product behaviour the chaos
		// tier asserts, not a state to hide. This chooses among REAL pipes; the one thing this file must never do
		// is invent a pipe name (see `call`).
		const alive = matching.filter(ideAlive)
		return alive.length > 0 ? alive : matching
	} catch {
		return []
	}
}

/** Every live pipe of a NAMED vendor — for the cross-vendor suite, which is the only thing driving two at once. */
export function livePipesFor(vendor: "codesys" | "twincat"): string[] {
	return readdirSync("\\\\.\\pipe\\").filter((n) => n.startsWith(`volt.bridge.${vendor}.`))
}

let cachedPipe: string | undefined

/**
 * Resolve the live pipe: keep the cached one while it is still up, else re-discover.
 *
 * <p>Falls back to the raw prefix when no bridge is up — deliberately, because a `connect` there ENOENTs with the
 * prefix in the message. That is the one `?? fallback` in this file, and it is safe only because the value it
 * falls back to is designed to fail loudly downstream rather than quietly succeed.</p>
 */
function resolvePipe(): string {
	if (cachedPipe && livePipes().includes(cachedPipe)) return cachedPipe
	cachedPipe = livePipes()[0] ?? PIPE_PREFIX
	// Stamp the RESOLVED name into the environment, because a spawned `volt` inherits it — and VOLT_PIPE is how the
	// CLI is told which bridge to drive. Without this the suite starts from the vendor PREFIX (as the README says to),
	// resolves it to a per-pid pipe for its own calls, and every CLI child still inherits the prefix — which is not a
	// pipe. The invariant is not "the harness uses one pipe"; it is that EVERYTHING driving this bridge does.
	process.env.VOLT_PIPE = cachedPipe
	return cachedPipe
}

/**
 * The live pipe, resolved AT CALL TIME. Anything driving the bridge uses this, never a module-load snapshot: bun
 * runs every e2e file in ONE process, so a snapshot is minutes stale by the time a late suite uses it, and the
 * cache is dropped on any socket error. When both survive, a test can hand `init` the snapshot (pipe A) while every
 * other call drives the re-resolved cache (pipe B) — binding a workspace on one IDE and operating against another,
 * with the failure surfacing minutes later somewhere unrelated. One question, one answer.
 */
export const currentPipe = (): string => resolvePipe()

/**
 * A stable label for `describe()` titles ONLY.
 *
 * <p>It is deliberately not exported as something a test can branch on. `PIPE.includes("twincat") ? … : …` was
 * real code in this suite — a vendor branch smuggled in through a value documented as a label. Where a vendor
 * genuinely differs, say so with `expectVendorDifference` in `bridge.ts`, which forces both sides to be asserted.</p>
 */
export const BASE = `pipe ${resolvePipe()}`

/**
 * One request per connection (mirrors the CLI's own PipeClient): write `{op,body}\n`, drain frames, return the
 * terminal result. Progress frames are ignored; an error frame throws `CODE: message`.
 */
export function call(op: string, body?: unknown): Promise<any> {
	const pipe = resolvePipe()
	// Say what is actually wrong. Connecting to the bare prefix yields `ENOENT \\.\pipe\volt.bridge.codesys`, which
	// reads as a bridge bug when the truth is "no IDE is up yet" — the trap that made a cold run report 3 phantom
	// failures.
	if (!livePipes().includes(pipe))
		throw new Error(
			`no live ${PIPE_PREFIX}* pipe — is the IDE running with its project loaded? ` +
				`(CODESYS: scripts/ide.ps1 up -Vendor codesys · TwinCAT: scripts/ide.ps1 up -Vendor twincat, connector running)`,
		)
	return callOn(pipe, op, body)
}

/**
 * One request against an EXPLICITLY NAMED pipe — the same framing as {@link call}, minus the resolution.
 *
 * <p>Exported for the cross-vendor suite, the one thing that drives TWO bridges at once and so cannot use the
 * single resolved pipe. It reuses this framing rather than copying it: that suite's whole claim is that both
 * vendors answer IDENTICALLY, which is worth nothing if it reaches them through a different client than everything
 * else. (`stability/parallel-instances` did copy it, and the copy is exactly what this export removes.)</p>
 */
export function callOn(pipe: string, op: string, body?: unknown): Promise<any> {
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
				else if ("error" in frame) {
					reject(new Error(`${frame.error.code}: ${frame.error.message}`))
					sock.destroy()
					return
				}
				// progress frames ignored
			}
		})
		sock.on("end", () => resolve(result))
		sock.on("error", (e) => {
			cachedPipe = undefined
			reject(e)
		})
	})
}
