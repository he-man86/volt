/**
 * NETWORK TITLES AND COMMENTS — the text an engineer writes ABOUT the logic, which no test covered.
 *
 * Both are real vendor members (`INetwork.Title` / `INetwork.Comment`, `Title` / `Comment` in the archive) and
 * both drivers already read and write them. What had never been asserted is that they survive a round trip, and
 * a user's project is what showed why that matters: the IDE stores a title as the engineer typed it INCLUDING
 * the newline that ended it, network text puts the title in a QUOTED STRING on the header line, and an untrimmed
 * title emitted a quote spanning two lines — text that does not parse, so the POU could be pulled and never
 * pushed back. The same trailing newline turned a one-line comment into a comment plus an empty `//` line.
 *
 * The FIXED POINT is the real assertion here. Anything that re-writes the vendor's copy on a push that changed
 * nothing shows up as drift on the next pull.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE } from "../harness"

describe(`graphical / titles and comments (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	const clean = async (item: string) => {
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name: item, ifVersion: items[item] ?? "UNREADABLE000000" }])
	}
	const pull = async (item: string) =>
		(await bridge.fetch({ knownItems: {}, onlyItems: [item] })).changed.find((i: any) => i.name === item)

	it("a network's title and comment survive a round trip", async () => {
		const name = id("cmt"), item = fid("cmt", "prg")
		await clean(item)

		// A title on the header, a two-line comment inside, and a second network with NEITHER - so a body that
		// mixes annotated and bare networks is covered in one go.
		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD "the interlock"\n` +
			`  // holds the drive off while the guard is open\n` +
			`  // second line of the same comment\n` +
			`  out1 := (a AND b);\n` +
			`END_NETWORK\n` +
			`NETWORK 1 FBD\n  out2 := (a OR b);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1, "the item vanished after its create").toBeDefined()

		// The title stays on ONE line - an embedded newline here is the bug this test exists for.
		expect(v1.sourceText, "the network title was dropped").toContain(`NETWORK 0 FBD "the interlock"`)
		expect(v1.sourceText, "the comment was dropped").toContain("// holds the drive off while the guard is open")
		expect(v1.sourceText, "the comment's second line was dropped").toContain("// second line of the same comment")

		// …and no stray empty comment line crept in from a trailing newline.
		expect(v1.sourceText).not.toMatch(/^\s*\/\/\s*$/m)

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})
})
