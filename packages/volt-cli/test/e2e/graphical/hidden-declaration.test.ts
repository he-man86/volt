/**
 * A HIDDEN BODY'S DECLARATION IS EDITABLE, AND THE IDE'S BODY IS NEVER WRITTEN (openspec `implementation-keyword` 3b).
 *
 * <p>A CFC or SFC body pulls as `IMPLEMENTATION CFC|SFC UNSUPPORTED` over an empty body: Volt shows no implementation
 * code for it. The item's DECLARATION stays editable and is pushed as usual — so this suite gives each committed
 * diagram fixture (`VltFixtureCfc`, `VltFixtureSfc`, authored by each IDE itself; see `unsupported.test.ts`) a new
 * `VAR_INPUT`, pushes it, and asserts on the live IDE that the push was not blocked, the declaration landed, the item
 * still reads back as the same hidden body, and — where the vendor lets anything outside it read the body — that the
 * body is BYTE-IDENTICAL before and after. The declaration is put back at the end, so the fixture is left as found.</p>
 *
 * <p><b>Where the body can be read byte for byte.</b> Nothing on the wire carries a hidden body — that is the point of
 * hiding it — so the bytes are read from the vendor's own storage. TwinCAT saves every push to its `.TcPOU` files
 * (`FlushPendingWrites`, a `File.SaveAll`), and the POU's `<Implementation>` element there IS the body. CODESYS commits
 * a push into the open project in memory and writes no file, and its project archive is binary, so no process outside
 * the IDE can read a CODESYS body at all; the CODESYS writer's guarantee is proven offline instead, against the object
 * manager's checkout (`CodesysHiddenBodyWriteTests`, which counts every read of the implementation aspect), and live
 * here by everything short of the bytes.</p>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { bridge, fetchItem, requireHealthy, pushOps, expectVendorDifference, BASE } from "../harness"
import { servedProject, tcImplementations, tcPouFile } from "../lib/tc-files"

setDefaultTimeout(60000)

const CASES = [["CFC", "VltFixtureCfc"], ["SFC", "VltFixtureSfc"]] as const

const ADDED = "VAR_INPUT\n\tbVoltHiddenProbe : BOOL;\nEND_VAR\n"

describe(`graphical / a hidden body's declaration is pushed and its body never written (${BASE})`, () => {
	const wire = new Map<string, string>()
	let project = ""

	beforeAll(async () => {
		await requireHealthy()
		// The SERVED project, or no test here can say which file it read: requireHealthy just proved one is served.
		project = servedProject(await bridge.health())
		const refs = await bridge.refs()
		for (const [, bare] of CASES) {
			const full = Object.keys(refs.items).find((n) => n.startsWith(`${bare}.`))
			if (!full) throw new Error(`fixture POU '${bare}' is missing from this project — it is committed; re-add it in the IDE`)
			wire.set(bare, full)
		}
	})

	/** Push `sourceText` over `name`, gated on its current version. */
	async function set(name: string, sourceText: string): Promise<any> {
		const refs = await bridge.refs()
		return pushOps([{ op: "set", name, sourceText, ifVersion: refs.items[name] }])
	}

	/** The body as the IDE holds it, where anything outside the IDE can read it (see the file header). */
	function heldBody(bare: string): string[] | null {
		return expectVendorDifference(
			"openspec implementation-keyword 3b.1: CODESYS saves no file on push and its archive is binary, so a CODESYS " +
				"body cannot be read outside the IDE; its writer is held offline by CodesysHiddenBodyWriteTests",
			{ twincat: () => tcImplementations(tcPouFile(bare, project)), codesys: () => null },
		)
	}

	for (const [lang, bare] of CASES) {
		it(`a ${lang} POU pulls as IMPLEMENTATION ${lang} UNSUPPORTED, and its edited declaration is pushed while its body is untouched`, async () => {
			const name = wire.get(bare)!
			const pulled = (await fetchItem(name)).sourceText as string
			expect(pulled).toContain(`\nIMPLEMENTATION ${lang} UNSUPPORTED\n`)
			expect(pulled).not.toContain("XmlArchive")

			// The bytes BEFORE ANY PUSH — the body as the served project holds it now. Taking the baseline after a push
			// would make whatever that push did the reference, so a push that rewrote the body would compare equal to
			// itself. The restating push (the ordinary no-op) is then held to the same bytes like every other push.
			const before = heldBody(bare)
			expect((await set(name, pulled)).accepted).toBe(true)
			expect(heldBody(bare)).toEqual(before)

			const edited = pulled.replace(`FUNCTION_BLOCK ${bare}\n`, `FUNCTION_BLOCK ${bare}\n${ADDED}`)
			expect(edited).not.toBe(pulled)
			try {
				const r = await set(name, edited)
				expect(r.accepted).toBe(true)                                   // a hidden body blocks no push

				const after = (await fetchItem(name)).sourceText as string
				expect(after).toContain("bVoltHiddenProbe : BOOL;")             // the declaration landed
				expect(after).toContain(`\nIMPLEMENTATION ${lang} UNSUPPORTED\n`) // still the same hidden body
				expect(after).toBe(edited)
				expect(heldBody(bare)).toEqual(before)                           // and not one byte of it moved
				// …read from a file that DID take this push: the saved declaration carries the probe, so the bytes compared
				// above are the IDE's current state and not a file nothing wrote.
				expectVendorDifference("openspec implementation-keyword 3b.1: only TwinCAT saves a push to a readable file", {
					twincat: () => expect(readFileSync(tcPouFile(bare, project), "utf8")).toContain("bVoltHiddenProbe : BOOL;"),
					codesys: () => undefined,
				})
			} finally {
				// Leave the fixture as found — and that restore is itself a declaration push over a hidden body.
				expect((await set(name, pulled)).accepted).toBe(true)
				expect((await fetchItem(name)).sourceText).toBe(pulled)
				expect(heldBody(bare)).toEqual(before)
			}
		})
	}

	it("a pull of a project holding the hidden bodies is not blocked by them", async () => {
		const names = (await bridge.fetch({ knownItems: {} })).changed.map((i: any) => i.name)
		for (const [, bare] of CASES) expect(names).toContain(wire.get(bare)!)
	})
})
