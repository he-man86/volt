/**
 * THE IMPORTER EMITS ONE NETWORK PER CONNECTED COMPONENT — measured live, and now depended upon.
 *
 * PLCopen FBD has no network element, so when TwinCAT's importer is handed a flat list of wired items it has
 * to decide the boundaries itself. Measured across four shapes, from most connected to least:
 *
 *     one connected tree        -> 1
 *     one wire, two coils       -> 1     (shared refLocalId: still ONE component)
 *     two disconnected sinks    -> 2
 *     fb call + output read     -> 2
 *
 * WHY IT IS A GATE AND NOT A NOTE. A per-network splice — re-resolving only the network an engineer changed,
 * leaving the others byte-identical — is only sound where one network in gives one network out, and that is
 * exactly the connected-component rule. It is also PREDICTABLE from the model before touching the IDE, because
 * `TcNetworkWriter.Unhoist` already folds shared-wire trees into one item: the component count is its result
 * count. If a TwinCAT update ever changed this grouping, every such splice would silently renumber an
 * engineer's networks, so it is asserted rather than remembered.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE } from "../harness"

const SHAPES: [string, string, string][] = [
	// label, VAR block, the ONE network's statements
	["one connected tree", "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;", "  out := (a AND b);"],
	["one wire, two coils", "\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;",
		"  LET g1 := (a AND b);\n  out1 := g1;\n  out2 := g1;"],
	["two disconnected sinks", "\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;",
		"  out1 := a;\n  out2 := b;"],
	["fb call + output read", "\tt1 : TON;\n\ta : BOOL;\n\tpt : TIME;\n\tdone : BOOL;",
		"  t1(IN := a, PT := pt);\n  done := t1.Q;"],
]

describe(`graphical / importer grouping (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	it("emits one network per connected component", async () => {
		const report: string[] = []
		const counts: number[] = []

		for (const [label, vars, body] of SHAPES) {
			const tag = label.replace(/[^a-z]/gi, "").slice(0, 10)
			const name = id(tag)
			const item = fid(tag, "prg")

			const clean = async () => {
				const items = (await bridge.refs()).items ?? {}
				await pushOps([{ op: "deleteItem", name: item, ifVersion: items[item] ?? "UNREADABLE000000" }])
			}
			await clean()
			// try/FINALLY, not a trailing `await clean()`. The cleanup used to sit on the SUCCESS path only, so
			// anything that threw mid-shape - `v` coming back undefined is one line away - leaked that item for
			// the REST of the process. `sweepOnce` cannot help: it runs once per process, against what a PREVIOUS
			// run left. This file is one of the two the README names as flaking only in a FULL run, and a leak that
			// outlives its own test is exactly the shape that produces that.
			try {

				const src = `PROGRAM ${name}\nVAR\n${vars}\nEND_VAR\n(* @volt-implementation *)\nNETWORK 0 FBD\n${body}\nEND_NETWORK\n\nEND_PROGRAM\n`
				const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])

				if (!created.accepted) {
					report.push(`  ${label.padEnd(24)} REFUSED: ${JSON.stringify(created.conflicts).slice(0, 90)}`)
					counts.push(-1)
					continue
				}

				const v = (await bridge.fetch({ knownItems: {}, onlyItems: [item] })).changed.find((i: any) => i.name === item)
				const n = [...String(v.sourceText).matchAll(/^NETWORK\s+\d+\s+\w+/gm)].length
				report.push(`  ${label.padEnd(24)} pushed 1 network -> got ${n}`)
				counts.push(n)
			} finally {
				await clean()
			}
		}

		console.log("\nIMPORTER GROUPING (D25):\n" + report.join("\n") + "\n")
		// THE MEASURED ANSWER, asserted per vendor. This used to be `expect(report.length).toBe(SHAPES.length)`,
		// and `report.push` runs on the refusal branch as well as the success branch — so it was `4 === 4` for
		// every reachable outcome: all four pushes could fail and the test stayed green. `counts` was collected
		// and never read; it was the assertion someone meant to write. Three places called this file the gate for
		// D25 (the row itself, TcNetworkWriter's header, and the commit that added it) and all three were false.
		//
		// THE TWO VENDORS NOW AGREE, and getting here took three tries and a hand-drawn body.
		//
		// D25 is a fact about the PLCOPEN IMPORTER, TwinCAT's only route to a body it does not have: it groups by
		// connected component, so a pushed network holding two independent rungs came back as two. CODESYS builds
		// from the model and regroups nothing. This asserted `[1,1,2,2]` vs `[1,1,1,1]` for a year.
		//
		// `Stamp` now merges the importer's split back before stamping. The two failed attempts are worth keeping
		// in mind because both LOOKED right offline: the first believed the second network's tree pointed into the
		// first (it does not — a plain operand `"t1.Q"`, no id, no connector), and the second stamped each moved
		// item's own `t` while leaving the destination's `cet` in place. That is a form the vendor never writes, so
		// TwinCAT typed the moved assign from the list, read an assign as a box, and returned `done := ();` — after
		// round-tripping perfectly through Volt's own reader.
		//
		// The rule, from `ladder-demux.TcPOU` (a fan-out drawn by hand in XAE) and verified across all 22 populated
		// lists: a `NetworkItems` list has `cet` and NO child typed, or NO `cet` and EVERY child typed — never a
		// mixture. The merge converts the destination wholesale to the second form. See DIALECT C20(d).
		const expected = [1, 1, 1, 1]
		expect(counts, "the importer's grouping changed, or a push was refused (-1)").toEqual(expected)
	})
})
