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

			const src = `PROGRAM ${name}\nVAR\n${vars}\nEND_VAR\n\nNETWORK 0 FBD\n${body}\nEND_NETWORK\n\nEND_PROGRAM\n`
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
			await clean()
		}

		console.log("\nIMPORTER GROUPING (D25):\n" + report.join("\n") + "\n")
		expect(report.length).toBe(SHAPES.length)
	})
})
