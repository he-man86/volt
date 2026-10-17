/**
 * BRIDGE ONE-TO-ONE — THE LIVE RED TESTS, one per audit finding (openspec `bridge-one-to-one` design §2.2, the e2e layer;
 * the FakeIde layer is `Volt.Engine.Tests/one-to-one`). Each states what the shipped bridge MUST do once step 3 lands and
 * runs as an EXPECTED FAILURE (`it.failing`): the suite stays green while the finding holds, and a fix that makes one
 * pass FAILS it — remove the `.failing` then.
 *
 * <p>The CODESYS objects are AUTHORED by the IDE itself into a fixture of their OWN, `test/fixtures/CodesysOneToOne.project`
 * (a copy of CodesysTestProject — never that file: it hosts the LSP oracle recorders, where a check function would
 * intercept every recorded division; `scripts/author-one-to-one-fixture.py`,
 * the vendor's own Add Object path — never Volt's push, which makes the plain class: the defect under test): the check
 * function `CheckDivDInt`, the text-list enum `VltOto_TextEnum`, the abstract method `VltOto_AbsBase.Pick`, the excluded
 * POU `VltOto_Excluded`, the ExternalEvent task `VltOto_ExtTask`, the commented call of `VltOto_CommentTask` and the
 * standalone transition `VltOto_Trans` under `VltFixtureSfc`. The persistent list and the NVL are CREATES the test makes
 * (one persistent list per application; an NVL's factory needs its wizard, C2r — its create is refused by name).</p>
 *
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance bridge-one-to-one -Fixture test/fixtures/CodesysOneToOne.project -Wait
 *   VOLT_E2E_INSTANCE=bridge-one-to-one VOLT_VENDOR=codesys bun test test/e2e/one-to-one
 * </pre>
 */
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { BASE, VENDOR } from "../lib/pipe"
import { bridge } from "../lib/bridge"
import { codesysNativeExport } from "../lib/codesys-native"
import { fetchItem, landedInFull, plcFolder, pushOps, removeItem, PREFIX, fileOf, inFolder, pathIn, pathOf } from "../lib/workspace"

setDefaultTimeout(600_000)

const lf = (s: string) => s.replace(/\r\n/g, "\n")
const lines = (s: string) => lf(s).split("\n")
/** What closes a declaration after `anchor`: the blank lines that stand right after it — the declaration's own trailing
 *  newlines, stored verbatim (design §1.1 "every character"), each one more than the writer's ONE separator — and the
 *  lines after them, to the file's end. Both are returned, so a test pins the separator exactly (an extra or a missing
 *  blank line from a writer or reader bug changes `blanks`) rather than filtering the blank lines away. */
const closing = (text: string, anchor: string) => {
	const rest = after(text, anchor, Number.MAX_SAFE_INTEGER)
	const blanks = rest.findIndex((l) => l !== "")
	return { blanks, lines: rest.slice(blanks) }
}
/** The lines right after the first line equal to `anchor`. */
const after = (text: string, anchor: string, n: number) => {
	const ls = lines(text)
	const at = ls.findIndex((l) => l === anchor)
	if (at < 0) throw new Error(`no line '${anchor}' in:\n${text}`)
	return ls.slice(at + 1, at + 1 + n)
}
/** An AbstractPOUMethodObject's type GUID — its IMetaObject TypeGuid in the IDE's own serialization (`export_native`),
 *  measured on SP21 Patch 4 (a plain POUMethodObject is f8a58466-d7f6-439f-bbb8-d4600e41d099; completeness.known.ts). */
const ABSTRACT_METHOD_TYPE = "62ebfd1c-d342-43e5-8efb-f22b6d8e4a04"
const reasons = (r: any) => ((r?.conflicts ?? []) as any[]).map((c) => String(c.reason ?? "")).join(" | ")
const create = async (name: string, src: string) =>
	pushOps([{ op: "set", name: inFolder(await plcFolder(), name), sourceText: src, ifVersion: null }])

const items = (await bridge.refs()).items ?? {}
const authored = VENDOR === "codesys" && pathIn(items, "VltOto_TextEnum.dut") !== undefined
if (VENDOR === "codesys" && !authored)
	console.warn(`[one-to-one] ${BASE} serves no VltOto_* objects — serve test/fixtures/CodesysOneToOne.project (ide.ps1 up -Fixture …; author-one-to-one-fixture.py)`)

// ── CODESYS: the authored objects ─────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!authored)(`bridge one-to-one / CODESYS (${BASE})`, () => {
	const made: string[] = []
	afterAll(async () => {
		for (const n of made) await removeItem(n)
	})

	// The precondition of the member-rename test below (finding 2): the SERVED copy still holds the authored abstract
	// method. Not a red test — a fresh copy holds it; a copy an earlier run of this suite already renamed (today a delete +
	// create, which re-makes `Pick` plain) does not, and every class-sensitive answer about it would be wrong.
	it("the served copy holds VltOto_AbsBase.Pick as an AbstractPOUMethodObject (a fresh copy: ide.ps1 down + up)", async () => {
		const native = await codesysNativeExport("VltOto_AbsBase")
		if (!native.includes(`Name="TypeGuid" Type="System.Guid">${ABSTRACT_METHOD_TYPE}<`))
			throw new Error(
				"VltOto_AbsBase.Pick is no longer an AbstractPOUMethodObject in the served copy — an earlier run's rename re-made it " +
					"plain. Bring the instance down and up (a fresh copy of CodesysOneToOne.project) and run again.",
			)
	})

	// finding 1: the class
	it("a check function pulls its class (%CLASS CHECK CheckDivInt32)", async () => {
		const text = (await fetchItem("CheckDivDInt.pou")).sourceText
		expect(after(text, "IMPLEMENTATION ST", 1)).toEqual(["%CLASS CHECK CheckDivInt32"])
	})

	it("a check function created from its spelled text is made as its class", async () => {
		const name = `${PREFIX}_OtoCheck`
		made.push(`${name}.pou`)
		const src =
			`FUNCTION ${name} : LINT\nVAR_INPUT\n\tdivisor : LINT;\nEND_VAR\nIMPLEMENTATION ST\n%CLASS CHECK CheckDivInt64\n` +
			`${name} := divisor;\n\nEND_FUNCTION\n`
		expect(landedInFull(await create(`${name}.pou`, src))).toBe(true)
		expect(after((await fetchItem(`${name}.pou`)).sourceText, "IMPLEMENTATION ST", 1)).toEqual(["%CLASS CHECK CheckDivInt64"])
		// The CLASS, as the IDE serializes it: a check function archives its SpecialFunc (`export_native`); text the push
		// wrote into a plain POU's body would read back the same in the pull, so the pull alone proves nothing here.
		expect(await codesysNativeExport(name)).toMatch(/Name="SpecialFunc"[^>]*>CheckDivInt64</)
	})

	it("a text-list enumeration pulls its class (%CLASS TEXTLIST_ENUM), and a create makes it", async () => {
		const text = lf((await fetchItem("VltOto_TextEnum.dut")).sourceText)
		const pulled = closing(text, "END_TYPE")
		// The class line closes the file, after the declaration's stored newlines and the one separator (the authoring
		// script stored the declaration with ONE trailing newline: one blank line, the separator being the line break).
		expect(pulled).toEqual({ blanks: 1, lines: ["%CLASS TEXTLIST_ENUM", ""] })
		const name = `${PREFIX}_OtoTextEnum`
		made.push(`${name}.dut`)
		const pushed = text.replaceAll("VltOto_TextEnum", name)
		expect(landedInFull(await create(`${name}.dut`, pushed))).toBe(true)
		// …and the create reads back BYTE-EXACT: a writer or reader that added or dropped a separator would gain or lose a
		// blank line across this round trip.
		expect(lf((await fetchItem(`${name}.dut`)).sourceText)).toBe(pushed)
		expect(await codesysNativeExport(name)).toMatch(/Name="TextListObject"/)   // the class's own text list
	})

	it("a persistent list created from %CLASS PERSISTENT is made as one, and a second is refused by name", async () => {
		const first = `${PREFIX}_OtoPersistent`
		const second = `${PREFIX}_OtoPersistent2`
		made.push(`${first}.gvl`, `${second}.gvl`)
		const src = (n: string) => `VAR_GLOBAL PERSISTENT RETAIN\n\tnKept_${n} : INT;\nEND_VAR\n%CLASS PERSISTENT\n`
		const r1 = await create(`${first}.gvl`, src(first))
		if (landedInFull(r1)) expect(await codesysNativeExport(first)).toMatch(/Name="guidinit"/)   // a VarPersistentObject's own member
		else expect(reasons(r1)).toContain("PERSISTENT")   // design §1.1: the create is refused by name unless 2.1 reproduces it
		const r2 = await create(`${second}.gvl`, src(second))
		expect(landedInFull(r2)).toBe(false)
		expect(reasons(r2)).toContain("PERSISTENT")
	})

	it("an NVL create is refused by name (its factory needs its wizard, C2r)", async () => {
		const name = `${PREFIX}_OtoNvl`
		made.push(`${name}.gvl`)
		const r = await create(`${name}.gvl`, `VAR_GLOBAL\n\tbReceived : BOOL;\nEND_VAR\n%CLASS NVL\n%NETVAR TaskName: MainTask\n`)
		expect(landedInFull(r)).toBe(false)
		expect(reasons(r)).toContain("NVL")
	})

	// finding 3: object properties
	it("an excluded POU pulls %EXCLUDE_FROM_BUILD under its implementation line", async () => {
		expect(after((await fetchItem("VltOto_Excluded.pou")).sourceText, "IMPLEMENTATION ST", 1)).toEqual(["%EXCLUDE_FROM_BUILD"])
	})

	// finding 4: the task
	it("an ExternalEvent task pulls its external event as its own label, never as Event:", async () => {
		const text = lines((await fetchItem("VltOto_ExtTask.task")).sourceText)
		expect(text.some((l) => l.startsWith("Event:"))).toBe(false)
		expect(text.find((l) => l.startsWith("External event:"))?.replace(/^External event:\s*/, "")).toBe("VltOto_Event")
	})

	it("a call's comment is spelled after the call", async () => {
		const calls = lines((await fetchItem("VltOto_CommentTask.task")).sourceText).find((l) => l.startsWith("Calls:"))
		expect(calls?.replace(/^Calls:\s*/, "")).toBe("VltOto_Called // runs first")
	})

	// finding 5: a standalone transition
	it("an SFC POU holding a standalone transition is refused by name on pull", async () => {
		const f = await bridge.fetch({ knownItems: {}, onlyItems: [await pathOf("VltFixtureSfc.pou")] })
		expect((f.unreadable ?? []).map((u: { name: string }) => fileOf(u.name))).toContain("VltFixtureSfc")
	})

	// finding 2: a member rename keeps the object. LAST in this block, on purpose: while the finding holds, the rename is a
	// delete + create, and so is the restore in `finally` — `Pick` comes back a plain POUMethodObject, and the served copy
	// no longer holds the authored abstract method. Nothing after it in this run reads `Pick`; a LATER run on the same
	// served copy fails the guard at the top of this block (bring the instance down and up for a fresh copy).
	it("an abstract member renamed in the text keeps its object, or is refused by name", async () => {
		const before = await fetchItem("VltOto_AbsBase.pou")
		const nativeBefore = await codesysNativeExport("VltOto_AbsBase")
		const r = await pushOps([
			{ op: "set", name: await pathOf("VltOto_AbsBase.pou"), sourceText: lf(before.sourceText).replaceAll("Pick", "Choose"), ifVersion: before.version },
		])
		if (!landedInFull(r)) {
			expect(reasons(r)).toContain("'Pick'")
			return
		}
		try {
			// The member's object — its GUID and its class — is the one the IDE held: a rename, not a delete + create.
			const guids = (xml: string) => new Set(xml.match(/\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/gi) ?? [])
			const now = guids(await codesysNativeExport("VltOto_AbsBase"))
			const kept = [...guids(nativeBefore)].filter((g) => now.has(g))
			expect(kept.length).toBe(guids(nativeBefore).size)
		} finally {
			const now = await fetchItem("VltOto_AbsBase.pou")
			await pushOps([{ op: "set", name: await pathOf("VltOto_AbsBase.pou"), sourceText: before.sourceText, ifVersion: now.version }])
		}
	})
})

// ── TwinCAT: the refusals by name (design §1.1 "TwinCAT and the object-property lines") ──────────────────────────────

describe.skipIf(VENDOR !== "twincat")(`bridge one-to-one / TwinCAT (${BASE})`, () => {
	const made: string[] = []
	afterAll(async () => {
		for (const n of made) await removeItem(n)
	})

	it("a %CLASS CHECK create is refused by name (no automation path makes the class, tc-special-classes)", async () => {
		const name = `${PREFIX}_OtoCheck`
		made.push(`${name}.pou`)
		const r = await create(
			`${name}.pou`,
			`FUNCTION ${name} : DINT\nVAR_INPUT\n\tdivisor : DINT;\nEND_VAR\nIMPLEMENTATION ST\n%CLASS CHECK CheckDivInt32\n${name} := divisor;\n\nEND_FUNCTION\n`,
		)
		expect(landedInFull(r)).toBe(false)
		expect(reasons(r)).toContain("%CLASS")
	})

	it("%EXCLUDE_FROM_BUILD is refused by name (no measured TwinCAT member)", async () => {
		const name = `${PREFIX}_OtoExcluded`
		made.push(`${name}.pou`)
		const r = await create(
			`${name}.pou`,
			`FUNCTION_BLOCK ${name}\nVAR\nEND_VAR\nIMPLEMENTATION ST\n%EXCLUDE_FROM_BUILD\n\nEND_FUNCTION_BLOCK\n`,
		)
		expect(landedInFull(r)).toBe(false)
		expect(reasons(r)).toContain("%EXCLUDE_FROM_BUILD")
	})
})
