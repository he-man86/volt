import { landed } from "../harness"
/** THE REFERENCE DIALOG'S FLAGS ARE SPELLED, SO THE REFERENCES THAT SET THEM MATERIALIZE (CODESYS).
 *
 *  The default CODESYS fixture holds four references off the value the 264-reference census measured: `CmpCodeMeter`
 *  is `Optional`, and `CmpEventMgr Implementation`, `CmpEventMgr Interfaces` and `CmpIoMgr Implementation` set
 *  `PublishSymbolsInContainer`. The manifest had no line for either, so all four were refused unreadable (and before
 *  53aecb9ed9 dropped without a word). Each flag is now a manifest line spelled only where true — `OPTIONAL`,
 *  `PUBLISHSYMBOLSINCONTAINER` (and `HIDEWHENREFERENCEDASDEPENDENCY`, which the fixture does not set).
 *
 *  A `.library` manifest is READ-ONLY on both vendors (PushService `ReadOnlyKindOf`): there is no push path that sets
 *  a reference flag, for these lines exactly as for `SYSTEM` / `LINKALLCONTENT` / `QUALIFIEDONLY`. So the round trip
 *  this asserts is the one that exists: flipping a flag in the file is refused by name, and the IDE keeps its value.
 *
 *  TwinCAT spells the same lines from its `Optional` / `PublishAll` / `HideReference` / `QualifiedlAccessOnly`
 *  properties (DIALECT C37b), but no committed TwinCAT fixture sets one, so this runs on CODESYS only; the TwinCAT
 *  half is `TcWireParityTests` offline, measured live once (C37b). */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE, VENDOR } from "../harness"

const manifests = async () => {
	const f: any = await bridge.fetch({ knownItems: {} })
	return new Map(
		(f.changed as any[])
			.filter((i) => String(i.name).toLowerCase().endsWith(".library"))
			.map((i) => [String(i.name), String(i.sourceText)] as const),
	)
}

/** The manifest of the reference whose LIBRARY line starts with `title`. */
const find = (all: Map<string, string>, title: string) => {
	const hit = [...all].find(([, text]) => text.startsWith(`LIBRARY ${title}`))
	if (!hit) throw new Error(`the fixture references no library '${title}' (have: ${[...all.keys()].join(", ")})`)
	return { name: hit[0], text: hit[1] }
}

describe.skipIf(VENDOR !== "codesys")(`endpoints / library reference flags (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => { await requireHealthy() })

	it("an Optional and a PublishSymbolsInContainer reference materialize, each spelling its flag", async () => {
		const all = await manifests()
		expect(find(all, "CmpCodeMeter").text).toMatch(/^OPTIONAL$/m)
		for (const title of ["CmpEventMgr Implementation", "CmpEventMgr Interfaces", "CmpIoMgr Implementation"])
			expect(`${title}: ${/^PUBLISHSYMBOLSINCONTAINER$/m.test(find(all, title).text)}`).toBe(`${title}: true`)
		// …and a reference at the default spells none of them: its bytes are what they were before the lines existed.
		const plain = [...all.values()].filter((t) => !/^(OPTIONAL|PUBLISHSYMBOLSINCONTAINER|HIDEWHENREFERENCEDASDEPENDENCY)$/m.test(t))
		expect(plain.length).toBeGreaterThan(0)
	})

	it("flipping a flag in the manifest is refused read-only by name, and the IDE keeps its value", async () => {
		const { name, text } = find(await manifests(), "CmpCodeMeter")
		const refs: any = await bridge.refs()
		const pushed: any = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name, sourceText: text.replace(/^OPTIONAL\n/m, ""), ifVersion: refs.items?.[name] }],
		})
		expect(landed(pushed)).toBe(false)
		expect(JSON.stringify(pushed.conflicts)).toContain("is read-only")

		expect(find(await manifests(), "CmpCodeMeter").text).toBe(text)
	})
})
