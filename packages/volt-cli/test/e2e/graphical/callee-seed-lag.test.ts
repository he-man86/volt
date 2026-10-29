/**
 * A GRAPHICAL ENO READ OFF A BOX CALLING A POU THIS SESSION CREATED — a KNOWN DIVERGENCE on TwinCAT (openspec
 * `push-without-header-check` 5.Q, design S1, tasks 5.Q.9), held here as a ratchet.
 *
 * <p>Since 5.Q every POU is created as a FUNCTION_BLOCK (TwinCAT tree code 604) whatever its text, and TwinCAT keeps
 * that code until the solution is reloaded (DIALECT C2f/C2h). Its COMPILER takes the text, but its GRAPHICAL layer builds
 * a call box from the tree code: a box calling a PROGRAM or a FUNCTION that the same session created is built as a
 * function-block box, which has no ENO output, so a network reading its ENO is refused by the driver ("the IDE
 * builds that box with no ENO output"). Under the old per-kind seeds (`.prg` → 602, `.fun` → 603) it was accepted.
 * Measured 2026-10-02 (`probe-tc-graphical-callee-seed.ts` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-tc-graphical-callee-seed.ts`) → `tc-graphical-callee-seed.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/tc-graphical-callee-seed.log`)): a build in
 * between does not re-derive the code; a call whose ENO nothing reads is accepted, fetches back identical and builds clean.</p>
 *
 * <p>Triage: niche, accepted loss — 0 such calls in the TwinCAT corpus, 2 in the six corpora (all lenze-mid, a CODESYS
 * project, where nothing lags). The two conformance fixtures of this shape carry it as `vendorRefuses.twincat`.</p>
 *
 * <p>The day TwinCAT takes it (a remedy for the lag, or a different seed), the TwinCAT arm FAILS — "take it off" — and
 * the fixtures' `vendorRefuses` goes with it.</p>
 *
 * <p><b>Taken off, 2026-10-16 (openspec twincat-inproc-host).</b> The box was built from the tree code by TwinCAT's PLCopen
 * IMPORT; the native writer builds the box the TEXT states, so both shapes are accepted and round-trip on TwinCAT too. The
 * LSP conformance fixtures' `vendorRefuses.twincat` for this shape went with it (re-recorded 2026-10-17, Project13).</p>
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { VENDOR, BASE, bridge, id, fid, fetchItem, pushOps, landedInFull, requireHealthy, expectVendorDifference, at, fileOf, pathIn, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(180_000)

const versions = async (): Promise<Record<string, string>> => (await bridge.refs()).items ?? {}
async function remove(names: readonly string[]): Promise<void> {
	const have = await versions()
	const ops = names
		.map((n) => pathIn(have, n))
		.filter((p): p is string => p !== undefined)
		.map((p) => ({ op: "deleteItem", name: p, ifVersion: have[p]! }))
	if (ops.length > 0) await pushOps(ops)
}

const program = (n: string) => `PROGRAM ${n}\nVAR\n\tx : BOOL;\nEND_VAR\n%LANGUAGE ST\nx := TRUE;\n\nEND_PROGRAM\n`
const fun = (n: string) => `FUNCTION ${n} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n%LANGUAGE ST\n${n} := a + 1;\n\nEND_FUNCTION\n`
// A FUNCTION's positional pins are pushed NAMED: the push gives a function box its input names from the declaration
// (openspec ld-fbd-coverage 2R.4, DIALECT N40 — CODESYS builds no function box without them), so `f(n)` is the box
// `f(a := n)` and pulls back so (`pulls`); the CLI adopts that text as the IDE's (graphical/positional-call-cli).
const caller = (n: string, lang: "FBD" | "LD", vars: string, net: string) =>
	`PROGRAM ${n}\nVAR\n${vars}\nEND_VAR\n%LANGUAGE ${lang}\n%NETWORK\n${net}\n\nEND_PROGRAM\n`

interface Case {
	readonly what: string
	readonly callee: { readonly name: string; readonly source: string }
	readonly caller: { readonly name: string; readonly source: string; readonly pulls?: string }
	/** Refused on TwinCAT today — the known divergence. False: accepted on both vendors. */
	readonly twincatRefuses: boolean
}

const CASES: readonly Case[] = [
	{
		what: "ENO read off a box calling a PROGRAM created by the same push",
		callee: { name: fid("lagP"), source: program(id("lagP")) },
		caller: { name: fid("lagPc"), source: caller(id("lagPc"), "LD", "\tgo : BOOL;\n\tdone : BOOL;", `done := ${id("lagP")}(EN := go).ENO;`) },
		twincatRefuses: false,
	},
	{
		what: "ENO read off a box calling a FUNCTION created by the same push",
		callee: { name: fid("lagF"), source: fun(id("lagF")) },
		caller: {
			name: fid("lagFc"),
			source: caller(id("lagFc"), "FBD", "\tgo : BOOL;\n\tn : INT;\n\tok : BOOL;", `ok := ${id("lagF")}(EN := go, n).ENO;`),
			pulls: caller(id("lagFc"), "FBD", "\tgo : BOOL;\n\tn : INT;\n\tok : BOOL;", `ok := ${id("lagF")}(EN := go, a := n).ENO;`),
		},
		twincatRefuses: false,
	},
	{
		what: "a box whose ENO nothing reads calling a FUNCTION created by the same push",
		callee: { name: fid("lagG"), source: fun(id("lagG")) },
		caller: {
			name: fid("lagGc"),
			source: caller(id("lagGc"), "FBD", "\tn : INT;\n\tres : INT;", `res := ${id("lagG")}(n);`),
			pulls: caller(id("lagGc"), "FBD", "\tn : INT;\n\tres : INT;", `res := ${id("lagG")}(a := n);`),
		},
		twincatRefuses: false,
	},
]

describe(`graphical / a call box of a POU this session created (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	for (const c of CASES) {
		const names = [c.caller.name, c.callee.name]
		const refuses = VENDOR === "twincat" && c.twincatRefuses

		it(`${c.what}: ${refuses ? "is refused on TwinCAT (known divergence)" : "round-trips"}`, async () => {
			await remove(names)
			try {
				const r = await pushOps([
					{ op: "set", name: await at(c.callee.name, await projectRoot()), sourceText: c.callee.source, ifVersion: null },
					{ op: "set", name: await at(c.caller.name, await projectRoot()), sourceText: c.caller.source, ifVersion: null },
				])
				if (!refuses) {
					expect(landedInFull(r), `${c.what} was refused on ${VENDOR}: ${JSON.stringify(r.conflicts)}`).toBe(true)
					expect((await fetchItem(c.caller.name)).sourceText, `${c.caller.name} came back reshaped`).toBe(c.caller.pulls ?? c.caller.source)
					return
				}
				expectVendorDifference("push-without-header-check 5.Q.9: TwinCAT builds the box from the lagging 604 seed", {
					codesys: () => undefined,
					twincat: () => {
						// The refusal is the CALLER's, raised at apply (it needs the live 604 seed, so no pre-flight sees it):
						// the callee before it lands and the push answers `accepted: true` with a conflict for the caller
						// (openspec push-keeps-what-landed). `accepted` alone would read that as "the lag is gone".
						const refusal = (r.conflicts ?? []).find((x: any) => fileOf(x.name) === c.caller.name)
						expect(refusal, `${c.what} was ACCEPTED on TwinCAT — the lag is gone, take it off the list (and the fixtures' vendorRefuses.twincat)`).toBeDefined()
						expect(refusal.reason).toContain("the IDE builds that box with no ENO output")
					},
				})
			} finally {
				await remove(names)
			}
		})
	}
})
