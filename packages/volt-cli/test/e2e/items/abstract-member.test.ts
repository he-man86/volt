import { landed } from "../harness"
/**
 * A MEMBER WITH NO BODY SLOT HAS NO `%LANGUAGE` LINE (openspec `language-line`, DIALECT C2n) — live.
 *
 * <p>CODESYS holds an IDE-made abstract method as an `AbstractPOUMethodObject` and an abstract property's GET as an
 * `InterfacePropertyAccessorObject` (pro2193), neither with a body slot: the pull writes them with no line and nothing after
 * the declaration. Every other member has a slot — every TwinCAT abstract member (609 / 613 / 614), and every member a
 * push creates but an ABSTRACT METHOD stating no line — and pulls `%LANGUAGE ST`, with nothing under it when it holds no
 * code.</p>
 *
 * <p>Two parts:</p>
 * <ul>
 * <li><b>the migration</b> — any fixture, either vendor: a pro2193-shaped owner whose abstract members state an empty
 * `%LANGUAGE ST` is CREATED and pulls back unchanged. Its abstract METHOD stating no line is created on CODESYS as the
 * vendor's `AbstractPOUMethodObject` (C2r) and pulls back unchanged, and refused by name on TwinCAT (no method without a
 * slot, C2n); its GET stating no line is refused on both (no measured create of a slotless accessor);</li>
 * <li><b>pro2193 itself</b> — CODESYS, against the committed pro2193 copy, which holds the slotless members; on any other
 * project it skips, loudly.</li>
 * </ul>
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance <name> [-Fixture test/fixtures/Pro2193-94-95-96_COdesys.project] -Wait
 *   VOLT_E2E_INSTANCE=<name> VOLT_VENDOR=codesys bun test test/e2e/items/abstract-member.test.ts
 * </pre>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { BASE, VENDOR } from "../lib/pipe"
import { bridge } from "../lib/bridge"
import { createItem, fetchItem, landedInFull, pushOps, removeItem, PREFIX, pathIn, pathOf } from "../lib/workspace"

setDefaultTimeout(600_000)

const lf = (s: string) => s.replace(/\r\n/g, "\n")
const items = (await bridge.refs()).items ?? {}

// ── the migration: a pro2193-shaped owner created into a project that does not hold it ──────────────────────

const MIGRATED = `${PREFIX}_AbsMigrated.pou`
const migratedBare = MIGRATED.replace(/\.pou$/, "")
/** pro2193's shapes (`VisionSystem_BaseFB`): an abstract method and an abstract property's GET beside a concrete method,
 *  their members in the order both IDEs hand them back (measured: the same order on both vendors). `methodBody` and
 *  `getBody` are what the abstract method and the abstract GET state under their declaration. */
const migratedSrc = (methodBody: string, getBody: string) =>
	`FUNCTION_BLOCK ABSTRACT ${migratedBare}\nVAR\n\tbusy : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n` +
	`METHOD Run : BOOL\n%LANGUAGE ST\nRun := busy;\nEND_METHOD\n\n` +
	`METHOD ABSTRACT TakePicture : INT\n${methodBody}END_METHOD\n\n` +
	`PROPERTY PUBLIC ABSTRACT Busy : BOOL\nGET\n${getBody}END_GET\nEND_PROPERTY\n`
const ST = "%LANGUAGE ST\n"

/** A create of `src`, refused: the reason, and nothing created. */
async function refusedCreate(src: string): Promise<string> {
	await removeItem(MIGRATED)
	const r = await bridge.push({
		expectedProjectVersion: (await bridge.refs()).projectVersion,
		ops: [{ op: "set", name: MIGRATED, sourceText: src, ifVersion: null }],
	})
	expect(landed(r)).toBe(false)
	expect(pathIn((await bridge.refs()).items ?? {}, MIGRATED)).toBeUndefined()   // nothing created
	return String((r.conflicts ?? [])[0]?.reason ?? "")
}

describe(`abstract member migration / ${MIGRATED} (${BASE})`, () => {
	afterAll(async () => {
		await removeItem(MIGRATED)
	})

	it("its GET stating no line is refused: a push creates no accessor without a slot", async () => {
		expect(await refusedCreate(migratedSrc(ST, ""))).toContain("creates no accessor without one")
	})

	it.skipIf(VENDOR !== "twincat")("TwinCAT: its abstract method stating no line is refused: no method without a slot", async () => {
		expect(await refusedCreate(migratedSrc("", ST))).toContain("no METHOD without a body slot")
	})

	it.skipIf(VENDOR !== "codesys")("CODESYS: its abstract method stating no line is created without a slot, and pulls back unchanged", async () => {
		await removeItem(MIGRATED)
		await createItem(MIGRATED, migratedSrc("", ST))

		expect(lf((await fetchItem(MIGRATED)).sourceText)).toBe(migratedSrc("", ST))
	})

	it("the owner with an empty %LANGUAGE ST body at its abstract members is created, and pulls back unchanged", async () => {
		await removeItem(MIGRATED)
		await createItem(MIGRATED, migratedSrc(ST, ST))

		expect(lf((await fetchItem(MIGRATED)).sourceText)).toBe(migratedSrc(ST, ST))
	})

	it("code under its abstract method is refused before any write, naming the member and the IDE's words", async () => {
		const before = await fetchItem(MIGRATED)
		const withCode = lf(before.sourceText).replace(
			"METHOD ABSTRACT TakePicture : INT\n%LANGUAGE ST\nEND_METHOD",
			"METHOD ABSTRACT TakePicture : INT\n%LANGUAGE ST\nTakePicture := 1;\nEND_METHOD",
		)
		expect(withCode).not.toBe(lf(before.sourceText))

		const r = await bridge.push({
			expectedProjectVersion: (await bridge.refs()).projectVersion,
			ops: [{ op: "set", name: await pathOf(MIGRATED), sourceText: withCode, ifVersion: before.version }],
		})

		expect(landed(r)).toBe(false)
		const reason = String((r.conflicts ?? [])[0]?.reason ?? "")
		expect(reason).toContain("'TakePicture'")
		expect(reason).toContain("must not contain any statements")
		expect((await fetchItem(MIGRATED)).version).toBe(before.version)   // nothing written
	})
})

// ── pro2193 (CODESYS): the slotless members ─────────────────────────────────────────────────────────────────

const OWNER = "VisionSystem_BaseFB.pou"
const SIGNATURE = "METHOD ABSTRACT TakePicture : enumResultTakePicture"
const ADDED = "// volt e2e: a declaration line beside an abstract member"

/** The text of the member block that opens with `head`, up to and including its END line. */
const block = (text: string, head: string, end: string) => {
	const at = text.indexOf(head)
	if (at < 0) throw new Error(`no '${head}' in:\n${text}`)
	return text.slice(at, text.indexOf(end, at) + end.length)
}

const served = VENDOR === "codesys" && pathIn(items, OWNER) !== undefined
if (!served) console.warn(`[abstract-member] pro2193 part skipped: ${BASE} serves no ${OWNER} on CODESYS — serve the committed pro2193 copy`)

describe.skipIf(!served)(`abstract member / ${OWNER} (${BASE})`, () => {
	let original: { sourceText: string; version: string }

	beforeAll(async () => {
		original = await fetchItem(OWNER)
	})

	afterAll(async () => {
		const now = await fetchItem(OWNER)
		if (lf(now.sourceText) === lf(original.sourceText)) return
		const r = await pushOps([{ op: "set", name: await pathOf(OWNER), sourceText: original.sourceText, ifVersion: now.version }])
		if (!landedInFull(r)) throw new Error(`${OWNER} could not be restored: ${JSON.stringify(r.conflicts ?? r)}`)
	})

	it("pulls no %LANGUAGE line under the abstract method and the abstract property's GET, their %FOLDER closing the declaration", () => {
		const text = lf(original.sourceText)
		const method = block(text, SIGNATURE, "END_METHOD")
		expect(method).not.toContain("%LANGUAGE")
		expect(method).toEndWith("\n%FOLDER Commands\nEND_METHOD")
		const property = block(text, "PROPERTY PUBLIC ABSTRACT Busy : BOOL", "END_PROPERTY")
		expect(property).toContain("%FOLDER Properties\nGET\n")
		expect(property).not.toContain("%LANGUAGE")
	})

	it("a declaration line beside it pushes back, lands, and the member still pulls with no line (its object is kept)", async () => {
		const edited = lf(original.sourceText).replace(SIGNATURE, `${SIGNATURE}\n${ADDED}`)
		expect(edited).not.toBe(lf(original.sourceText))

		const r = await pushOps([{ op: "set", name: await pathOf(OWNER), sourceText: edited, ifVersion: original.version }])
		expect({ landed: landedInFull(r), conflicts: r.conflicts ?? [] }).toEqual({ landed: true, conflicts: [] })

		expect(lf((await fetchItem(OWNER)).sourceText)).toBe(edited)
	})

	// A stated language over a member with no slot has nowhere to go: refused by name, nothing written.
	it("an empty %LANGUAGE ST under it is refused: the IDE holds the member with no body slot", async () => {
		const before = await fetchItem(OWNER)
		const stated = lf(before.sourceText).replace(`${SIGNATURE}\n${ADDED}`, `${SIGNATURE}\n${ADDED}\n%LANGUAGE ST`)
		expect(stated).not.toBe(lf(before.sourceText))

		const r = await pushOps([{ op: "set", name: await pathOf(OWNER), sourceText: stated, ifVersion: before.version }])
		expect(landedInFull(r)).toBe(false)
		expect(String((r.conflicts ?? [])[0]?.reason ?? "")).toContain("no body slot")
		expect((await fetchItem(OWNER)).version).toBe(before.version)
	})
})
