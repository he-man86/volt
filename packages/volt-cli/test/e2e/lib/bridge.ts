/**
 * THE OP CLIENT — the eight ops the bridge serves, named exactly as the wire names them
 * (`Volt.Contracts.Vocabulary.Ops`: health · connect · disconnect · refs · fetch · init · push · build).
 *
 * <p>One typed entry point per op and nothing else. Item-level convenience (create/update/delete/cleanup) lives in
 * `workspace.ts`; this layer stays a thin, honest mirror of the contract so a missing op is visible as a missing
 * function rather than hidden behind a helper.</p>
 */
import { expect } from "bun:test"
import { call, callOn, VENDOR } from "./pipe"

export const bridge = {
	health: (): Promise<any> => call("health"),
	refs: (): Promise<any> => call("refs"),
	fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => call("fetch", req),
	push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => call("push", req),
	build: (): Promise<any> => call("build", {}),
	// `init` was its own op until it turned out to be `fetch { init: true }` with the identity guard missing.
	init: (): Promise<any> => call("fetch", { init: true }),
	// The connection-lifecycle ops the CONNECTOR drives (the tray and the two frontends), not the CLI. `disconnect`
	// is the tray's Disconnect: the bridge refuses sync until the next `connect`, tearing nothing down.
	connect: (req: { project?: string | null } = {}): Promise<any> => call("connect", req),
	disconnect: (): Promise<any> => call("disconnect"),

	/** The connectable projects. Discovery is folded into `health` — there is no separate `instances` op. Each row
	 *  is self-describing: { vendor, version, project, status, dirty }, where status is
	 *  "idle" (detected, not served) | "healthy" | "degraded" (served). */
	projects: (): Promise<any[]> => call("health").then((h) => h.projects ?? []),
}

/** A client bound to ONE named pipe, for the cross-vendor suite — same ops, same framing, it just never asks which
 *  pipe is "the" pipe, because parity means talking to two at once. */
export function clientFor(pipe: string) {
	const on = (op: string, body?: unknown) => callOn(pipe, op, body)
	return {
		pipe,
		health: (): Promise<any> => on("health"),
		refs: (): Promise<any> => on("refs"),
		fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => on("fetch", req),
		push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => on("push", req),
		build: (): Promise<any> => on("build", {}),
		connect: (req: { project?: string | null } = {}): Promise<any> => on("connect", req),
	}
}
export type PipeClient = ReturnType<typeof clientFor>

/** The bridge's error code for an op, or null when it succeeded. Errors surface as `Error("CODE: message")`
 *  (see `pipe.call`), so the code is the prefix. */
export async function opErrorCode(run: () => Promise<unknown>): Promise<string | null> {
	try {
		await run()
		return null
	} catch (e) {
		return String((e as Error).message).split(":")[0]
	}
}

/** The connection state, derived from the flat `health.projects` array the SAME way the connector derives it:
 *  serving is a NON-IDLE row. No served row → "unavailable". There is no root `status`/`connected` on the wire —
 *  those are C#-side helpers computed off the served row, so the suite computes them the same way. */
export function healthStatus(h: any): "healthy" | "degraded" | "unavailable" {
	const served = (h?.projects ?? []).find((p: any) => p.status && p.status !== "idle")
	if (!served) return "unavailable"
	return served.status === "degraded" ? "degraded" : "healthy"
}

/**
 * ASSERT A VENDOR DIFFERENCE — the only sanctioned way for a test to know which vendor it is talking to.
 *
 * <p>This suite is one suite run against either bridge, and a pass on one with a fail on the other is a real parity
 * bug. So a bare `if (VENDOR === "twincat")` is how a gap gets quietly absorbed: the branch asserts nothing on the
 * vendor that lacks the capability, and the file still reads as full coverage. Four of the nine `???` marker
 * positions were in exactly that state — nine positions claimed, five actually verified on TwinCAT.</p>
 *
 * <p>Both sides must be stated here, so a difference is a documented pair of expectations rather than a silent
 * skip, and so the day the gap closes this call fails and forces the test updated. Every use must cite the record
 * that tracks the gap (a DIALECT entry or an openspec change) in `why`.</p>
 */
export function expectVendorDifference<T>(why: string, sides: { codesys: () => T; twincat: () => T }): T {
	expect(why.length, "a vendor difference must cite the record that tracks it").toBeGreaterThan(0)
	return VENDOR === "twincat" ? sides.twincat() : sides.codesys()
}
