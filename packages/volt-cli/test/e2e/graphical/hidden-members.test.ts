/**
 * HIDDEN MEMBERS BESIDE MEMBERS VOLT WRITES: THE IDE'S HIDDEN BODIES ARE NEVER WRITTEN (openspec `implementation-keyword`
 * 3b.1, spec "nothing in the IDE is overwritten").
 *
 * <p>`hidden-declaration.test.ts` proves it for a POU whose OWN body is hidden. This is the other half, and the riskier
 * one: an ST function block whose MEMBERS Volt does not show — a CFC method and an SFC action — beside members it does.
 * Every push to such a POU writes the POU, and on TwinCAT several of those writes are WHOLE-OBJECT: a graphical member
 * edit (`SetMemberBodies`) and a member move (`MoveMember`) delete the POU and import its document back, carrying every
 * hidden sibling through a re-serialization. That path once turned the siblings' CRLF into LF and dropped their
 * indentation and BOM (fixed offline in `TcItemArchive`, `TcHiddenBodyWriteTests`); this is the live proof.</p>
 *
 * <p>The fixture `VltFixtureMembers` is committed into both fixture projects, authored by each IDE itself
 * (`scripts/author-hidden-member-fixture.py` / `-tc.ps1`): Volt never creates a diagram, so a test cannot make one.
 * Each case edits something Volt DOES write — the hidden member's declaration, an ST member's body, a new LD member,
 * a hidden member's folder — and asserts the push is accepted and the hidden bodies are byte for byte what they were
 * before ANY push, read from the vendor's own serialization (`lib/held-body.ts`). Every case puts the fixture back.</p>
 */
import { describe, it, expect, beforeAll, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, fetchItem, requireHealthy, pushOps, expectVendorDifference, BASE } from "../harness"
import { heldImplementations } from "../lib/held-body"
import { servedProject } from "../lib/tc-files"

setDefaultTimeout(90000)

const BARE = "VltFixtureMembers"

describe(`graphical / hidden members beside written ones keep their bodies (${BASE})`, () => {
	let name = ""
	let project = ""
	let pulled = ""
	let before: string[] = []

	/** The hidden bodies (the CFC method's, the SFC action's) as the IDE holds them, byte for byte. The ST and LD bodies
	 *  are left out on purpose: the cases edit them. How a body names its language is the vendor's: TwinCAT's `.TcPOU`
	 *  wraps it in a `<CFC>` / `<SFC>` element; CODESYS's native export names only the implementation's TYPE, by GUID
	 *  (measured on SP21 Patch 4 over this fixture: CFC `32d3375e-…`, SFC `74f81948-…`). */
	const hidden = async (): Promise<string[]> => {
		const language = expectVendorDifference("openspec implementation-keyword 3b.1: a .TcPOU names a body's language by element, a CODESYS native export by type GUID", {
			twincat: () => /<(CFC|SFC)>/,
			codesys: () => /^<Single Name="Implementation" Type="\{(32d3375e-c010-41e2-9e43-b2fbf4f2b374|74f81948-1328-492c-b6c1-a9ea72048b28)\}"/,
		})
		// Sorted: a member moved into a folder is exported after its siblings on CODESYS, and ORDER in the tree is no
		// body. Each body is still compared whole, byte for byte.
		return (await heldImplementations(BARE, project)).filter((b) => language.test(b)).sort()
	}

	async function push(sourceText: string, extra: Record<string, unknown> = {}): Promise<void> {
		const refs = await bridge.refs()
		const r = await pushOps([{ op: "set", name, sourceText, ifVersion: refs.items[name], ...extra }])
		expect(r.accepted, JSON.stringify(r.conflicts)).toBe(true) // a hidden member blocks no push
	}

	beforeAll(async () => {
		await requireHealthy()
		project = servedProject(await bridge.health())
		const refs = await bridge.refs()
		const full = Object.keys(refs.items).find((n) => n.startsWith(`${BARE}.`))
		if (!full)
			throw new Error(
				`fixture POU '${BARE}' is missing from this project — it is committed, authored by the IDE ` +
					"(scripts/author-hidden-member-fixture.py / -tc.ps1); the suite cannot create a diagram",
			)
		name = full
		pulled = (await fetchItem(name)).sourceText as string
		// Taken BEFORE any push, so no push is the reference for another.
		before = await hidden()
		expect(before.length, "the fixture holds one CFC method and one SFC action").toBe(2)
	})

	// Every case leaves the fixture as found — and that restore is itself a push over the hidden members, held to the
	// same bytes.
	afterEach(async () => {
		const now = await fetchItem(name)
		if (now.sourceText !== pulled) await push(pulled)
		expect((await fetchItem(name)).sourceText).toBe(pulled)
		expect(await hidden()).toEqual(before)
	})

	it("pulls the CFC method and the SFC action as UNSUPPORTED lines, the ST members as ST", () => {
		expect(pulled).toMatch(/\nMETHOD CfcStep : BOOL\n[\s\S]*?\nIMPLEMENTATION CFC UNSUPPORTED\nEND_METHOD\n/)
		expect(pulled).toMatch(/\nACTION SfcRun\nIMPLEMENTATION SFC UNSUPPORTED\nEND_ACTION\n/)
		expect(pulled).toMatch(/\nMETHOD Visible : BOOL\n[\s\S]*?\nIMPLEMENTATION ST\nVisible := bIn;\nEND_METHOD\n/)
		expect(pulled).not.toContain("XmlArchive")
	})

	it("pushing it back unchanged writes nothing", async () => {
		await push(pulled)
		expect(await hidden()).toEqual(before)
	})

	it("a hidden member's declaration edit lands, and no hidden body moves", async () => {
		const edited = pulled.replace("METHOD CfcStep : BOOL\nVAR_INPUT\n", "METHOD CfcStep : BOOL\nVAR_INPUT\n\tbVoltProbe : BOOL;\n")
		expect(edited).not.toBe(pulled)
		await push(edited)
		expect((await fetchItem(name)).sourceText).toBe(edited)
		expect(await hidden()).toEqual(before)
	})

	it("an ST member's body edit beside the hidden members lands, and no hidden body moves", async () => {
		const edited = pulled.replace("Visible := bIn;", "Visible := NOT bIn;")
		expect(edited).not.toBe(pulled)
		await push(edited)
		expect((await fetchItem(name)).sourceText).toBe(edited)
		expect(await hidden()).toEqual(before)
	})

	it("an LD member added and edited beside the hidden members (TwinCAT: a whole-POU re-import) moves no hidden body", async () => {
		const ld = (coil: string) =>
			`\nMETHOD VltE2E_Ld : BOOL\nVAR_INPUT\n\tp : BOOL;\nEND_VAR\nIMPLEMENTATION LD\nNETWORK\n  ${coil} := (p AND bGo);\nEND_NETWORK\nEND_METHOD\n`
		const added = pulled + ld("VltE2E_Ld")
		const bodies = (await heldImplementations(BARE, project)).length
		await push(added)
		// The control: the bodies are read from the IDE's state AFTER the push — the new member's body is among them —
		// so the equality below is not two reads of a copy nothing wrote.
		expect((await heldImplementations(BARE, project)).length).toBe(bodies + 1)
		const got = (await fetchItem(name)).sourceText as string
		expect(got).toContain("METHOD VltE2E_Ld : BOOL")
		expect(got).toContain("IMPLEMENTATION LD\nNETWORK")
		expect(await hidden()).toEqual(before)

		// The graphical member EDIT is `SetMemberBodies` on TwinCAT — the path that re-imports the whole document.
		await push(got.replace("VltE2E_Ld := (p AND bGo);", "VltE2E_Ld := (bGo AND p);"))
		expect((await fetchItem(name)).sourceText).toContain("VltE2E_Ld := (bGo AND p);")
		expect(await hidden()).toEqual(before)
	})

	it("a hidden member moved into a folder and back (TwinCAT: MoveMember) keeps its body", async () => {
		const into = pulled.replace("IMPLEMENTATION CFC UNSUPPORTED\n", "IMPLEMENTATION CFC UNSUPPORTED\n%FOLDER VltE2E_HiddenMove\n")
		expect(into).not.toBe(pulled)
		await push(into)
		expect((await fetchItem(name)).sourceText).toBe(into)
		expect(await hidden()).toEqual(before)
	})
})
