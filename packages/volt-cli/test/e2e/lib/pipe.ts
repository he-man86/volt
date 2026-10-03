/**
 * THE WIRE — resolving THIS run's fixture bridge pipe (`fixture-ide.ts`) and making one call on it. Nothing above this layer knows what a
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
import { E2E_INSTANCE, fixturePipesFor } from "./fixture-ide"

/** Which vendor's bridge this run targets. Tests must not branch on it — see `bridge.ts`. */
export const VENDOR = process.env.VOLT_VENDOR === "twincat" ? "twincat" : "codesys"

// The pipe the CALLER named, captured once: `resolvePipe` stamps the resolved name into `process.env.VOLT_PIPE` for
// spawned `volt` children, and re-reading it would turn an instance run into an explicit one pinned to a pipe that
// may since have gone (an IDE restarted with a new pid).
const EXPLICIT_PIPE = process.env.VOLT_PIPE || undefined

/**
 * Is this pipe in the namespace right now? Not "is its IDE alive": a TwinCAT worker deliberately OUTLIVES its XAE
 * (~15s until reaped) and must answer PLC_DISCONNECTED from that window — a product behaviour the chaos tier asserts.
 * A pipe stays usable for as long as it exists once it has been PROVEN ours (see `resolvePipe`).
 */
function present(pipe: string): boolean {
	try {
		return readdirSync("\\\\.\\pipe\\").includes(pipe)
	} catch {
		return false
	}
}

/**
 * The fixture pipe(s) this run may drive — ONLY those an `ide.ps1` instance provably started on a fixture copy
 * (`fixture-ide.ts`). Throws a refusal naming every pipe it will not touch. There is no prefix-wide discovery and no
 * "first pipe found": that is how the suite once wrote `VltE2E_*` items into an engineer's 881-item project.
 */
export function livePipes(): string[] {
	return fixturePipesFor(VENDOR, EXPLICIT_PIPE)
}

/** The fixture pipe(s) of a NAMED vendor — for the cross-vendor suite, the only thing driving two at once. Same rule:
 *  `VOLT_PIPE_<VENDOR>` names one exactly (and is verified), else the `VOLT_E2E_INSTANCE` instance's. */
export function livePipesFor(vendor: "codesys" | "twincat"): string[] {
	return fixturePipesFor(vendor, process.env[`VOLT_PIPE_${vendor.toUpperCase()}`])
}

let cachedPipe: string | undefined

/**
 * Resolve the pipe: keep the cached one while it still EXISTS (it was proven ours when it was resolved), else
 * resolve again from the instance — which follows an IDE that restarted with a new pid. Throws when no fixture IDE
 * is serving; there is no fallback name, because a fallback is a guess and a guess is what wrote into a foreign IDE.
 */
function resolvePipe(): string {
	if (cachedPipe && present(cachedPipe)) return cachedPipe
	cachedPipe = undefined
	const pipes = livePipes()
	if (pipes.length > 1)
		console.log(`[e2e] instance ${E2E_INSTANCE || "(default)"} serves ${pipes.length} fixture pipes (${pipes.join(", ")}); driving ${pipes[0]}`)
	cachedPipe = pipes[0]!
	// Stamp the RESOLVED name into the environment, because a spawned `volt` inherits it — and VOLT_PIPE is how the
	// CLI is told which bridge to drive. The invariant is not "the harness uses one pipe"; it is that EVERYTHING
	// driving this bridge does. Only a resolved, verified pipe is ever stamped.
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
 * A stable label for `describe()` titles ONLY — the vendor and the instance, NOT a resolved pipe.
 *
 * <p>It is deliberately not exported as something a test can branch on. `PIPE.includes("twincat") ? … : …` was
 * real code in this suite — a vendor branch smuggled in through a value documented as a label. Where a vendor
 * genuinely differs, say so with `expectVendorDifference` in `bridge.ts`, which forces both sides to be asserted.
 * And it does not resolve: it is evaluated at IMPORT, by offline tests too (`test/unit/oracle.test.ts` imports the
 * harness), where resolving would mean reading the process table — and refusing, with no IDE up.</p>
 */
export const BASE = `pipe ${EXPLICIT_PIPE ?? `volt.bridge.${VENDOR} (ide.ps1 instance ${E2E_INSTANCE || "(default)"})`}`

/**
 * One request per connection (mirrors the CLI's own PipeClient): write `{op,body}\n`, drain frames, return the
 * terminal result. Progress frames are ignored; an error frame throws `CODE: message`.
 */
export function call(op: string, body?: unknown): Promise<any> {
	// Rejects, naming the instance and every pipe it refuses, when no fixture IDE of ours is serving — the honest
	// message for a cold run, where connecting to a guessed name would ENOENT and read as a bridge bug.
	let pipe: string
	try {
		pipe = resolvePipe()
	} catch (e) {
		return Promise.reject(e)
	}
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
