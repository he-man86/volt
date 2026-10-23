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
import { E2E_INSTANCE, gatherFacts, resolveFixturePipes, resolveOnePipe, type Vendor } from "./fixture-ide"

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
 * THE ONE fixture pipe a run drives for `vendor` — only one an `ide.ps1` instance provably started on a fixture copy
 * (`fixture-ide.ts`), and only when that instance serves exactly ONE. `explicit` (`VOLT_PIPE` / `VOLT_PIPE_<VENDOR>`)
 * names one exactly, verified the same way. Throws a refusal naming every pipe it will not touch.
 *
 * <p>There is no prefix-wide discovery and no "first pipe found": that is how the suite once wrote `VltE2E_*` items
 * into an engineer's 881-item project. Nor is there a "first of the instance's pipes": `ide.ps1 up -Vendor twincat`
 * used to open Project13 AND Project14 by default and this took `pipes[0]`, so which project a run drove followed the
 * order the two XAE pids sorted in — the same command passed three graphical tests on one and failed them on the
 * other. The scripts and LSP recorders already refused an instance serving several (`resolveOnePipe`); the suite asks
 * the same question now and gets the same answer.</p>
 */
function onePipe(vendor: Vendor, explicit: string | undefined): string {
	return resolveOnePipe(gatherFacts(vendor), { instance: E2E_INSTANCE, explicit })
}

/** The pipe a cross-vendor suite uses for a vendor — {@link onePipe}, or undefined when that vendor has NO fixture IDE
 *  of ours: a SKIP that says what it refused. It was `livePipesFor(v)[0]` over every `volt.bridge.<vendor>.*` on the
 *  machine, and on 2026-10-03 it created and deleted items in an engineer's project that happened to sort first. An
 *  instance serving SEVERAL of that vendor's pipes is a failure, not a skip — an IDE is up, the run just cannot say
 *  which one it means. So is a pipe the caller NAMED (`VOLT_PIPE_<VENDOR>`) that is not a fixture: they asked for it. */
export function fixturePipeOrSkip(vendor: "codesys" | "twincat", suite: string): string | undefined {
	const explicit = process.env[`VOLT_PIPE_${vendor.toUpperCase()}`] || undefined
	const facts = gatherFacts(vendor)
	try {
		resolveFixturePipes(facts, { instance: E2E_INSTANCE, explicit })
	} catch (e) {
		if (explicit) throw e
		console.log(`${suite}: ${vendor}: ${(e as Error).message}`)
		return undefined
	}
	return resolveOnePipe(facts, { instance: E2E_INSTANCE, explicit })
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
	cachedPipe = onePipe(VENDOR, EXPLICIT_PIPE)
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
	return callBound(pipe, op, body)
}

/** The ops that write, and so must name the project they write (openspec `push-requires-project-identity`). */
const WRITES = new Set(["push", "build"])

/** Per pipe: the identity its bridge echoed on `refs` — dropped when the harness connects or disconnects it. */
const identities = new Map<string, Promise<{ expectedPlatform: string; expectedProjectName: string }>>()

/**
 * One call as a bound client makes it: a WRITE carries the identity of the project the bridge serves, as the CLI sends
 * its binding — read from the bridge's own `refs` echo, once per pipe. A body that names either member keeps its own, so a
 * test of a wrong or missing binding sends exactly what it means to; {@link callOn} sends a body as given.
 */
export function callBound(pipe: string, op: string, body?: unknown): Promise<any> {
	if (op === "connect" || op === "disconnect") identities.delete(pipe)
	const b: Record<string, unknown> = typeof body === "object" && body !== null ? { ...body } : {}
	if (!WRITES.has(op) || "expectedPlatform" in b || "expectedProjectName" in b) return callOn(pipe, op, body)
	let identity = identities.get(pipe)
	if (!identity) {
		identity = callOn(pipe, "refs").then((r: any) => ({ expectedPlatform: r.platform, expectedProjectName: r.projectName }))
		identity.catch(() => identities.delete(pipe))
		identities.set(pipe, identity)
	}
	return identity.then((id) => callOn(pipe, op, { ...b, ...id }))
}

/** Every line a bridge answered one raw request with, as sent: the frames parsed, the bytes kept. */
export type RawAnswer = { lines: string[]; frames: any[] }

/**
 * One request frame sent EXACTLY as given — `frame` is the bytes before the newline, whatever they are (not JSON, members
 * in any order or case, over the frame cap) — and every line the bridge answered, progress included. The contract suite
 * and the transcript recorder need what {@link callOn} hides: the request a polite client never sends, and the frames
 * around the result. Resolves when the bridge closes the connection; a line that is not JSON is kept as a frame
 * `{ unparsed: <line> }` so the caller can fail on it by name.
 */
export function callRaw(pipe: string, frame: string | Buffer): Promise<RawAnswer> {
	return new Promise((resolve, reject) => {
		const sock = connect(`\\\\.\\pipe\\${pipe}`)
		const chunks: Buffer[] = []
		sock.on("connect", () => {
			sock.write(frame)
			sock.write("\n")
		})
		sock.on("data", (d: Buffer) => chunks.push(d))
		const done = () => {
			const lines = Buffer.concat(chunks).toString("utf8").split("\n").filter((l) => l.length > 0)
			const frames = lines.map((l) => {
				try { return JSON.parse(l) } catch { return { unparsed: l } }
			})
			resolve({ lines, frames })
		}
		sock.on("end", done)
		sock.on("close", () => done())
		sock.on("error", (e: NodeJS.ErrnoException) => {
			// A bridge that refuses an oversize frame closes while the client is still writing (EPIPE): what it answered
			// before closing is the answer.
			if ((e.code === "EPIPE" || e.code === "ECONNRESET") && chunks.length > 0) return done()
			cachedPipe = undefined
			reject(e)
		})
	})
}

/**
 * How many requests of each op this process sent, printed once after the last test file (`test/request-count.ts`,
 * preloaded: bun runs no `exit` handler under `bun test`). A read costs a whole tree walk on TwinCAT (the 2026-10-19
 * audit: ~1,750 `refs` per run, ~10 min), so what a run asks is a number it reports, not a guess — a helper that reads
 * again what the call before it already answered shows up here.
 */
function countOp(op: string): void {
	const counts = ((globalThis as any).__voltE2eRequests ??= new Map<string, number>()) as Map<string, number>
	counts.set(op, (counts.get(op) ?? 0) + 1)
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
	countOp(op)
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
