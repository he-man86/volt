/**
 * AN ABSTRACT MEMBER READS AND PUSHES THE SAME ON BOTH VENDORS (openspec `abstract-member-push` 3.2,
 * `abstract-member-parity` 3.3, DIALECT C2n) — live.
 *
 * <p>The text is decided by the DECLARATION, never by the IDE object's class or slot: an `ABSTRACT` member with no code
 * is `IMPLEMENTATION NONE` — CODESYS's slotless `AbstractPOUMethodObject` / `InterfacePropertyAccessorObject` (pro2193),
 * a CODESYS slotted `POUMethodObject` / `PropertyAccessorObject`, and every TwinCAT abstract member (609 / 613 / 614)
 * alike. A push of NONE writes no body where the object has no slot and `""` where it has one.</p>
 *
 * <p>Two parts:</p>
 * <ul>
 * <li><b>the migration</b> — any fixture, either vendor: a pro2193-shaped owner holding `IMPLEMENTATION NONE` is CREATED
 * (refused before `abstract-member-parity`, which cost pro2193's 7 owner files on a cross-vendor or blank-project
 * migration), and pulls back unchanged;</li>
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

// ── the migration: a NONE owner created into a project that does not hold it ─────────────────────────────

const MIGRATED = `${PREFIX}_AbsMigrated.pou`
const migratedBare = MIGRATED.replace(/\.pou$/, "")
/** pro2193's shapes (`VisionSystem_BaseFB`): an abstract method and an abstract property's GET, NONE, beside a concrete
 *  method — the owner a blank-project migration used to refuse by name. Its members in the order both IDEs hand them
 *  back (measured: the same order on both vendors). */
const MIGRATED_SRC =
	`FUNCTION_BLOCK ABSTRACT ${migratedBare}\nVAR\n\tbusy : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n` +
	`METHOD Run : BOOL\nIMPLEMENTATION ST\nRun := busy;\nEND_METHOD\n\n` +
	`METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE\nEND_METHOD\n\n` +
	`PROPERTY PUBLIC ABSTRACT Busy : BOOL\nGET\nIMPLEMENTATION NONE\nEND_GET\nEND_PROPERTY\n`

describe(`abstract member migration / ${MIGRATED} (${BASE})`, () => {
	afterAll(async () => {
		await removeItem(MIGRATED)
	})

	it("a pro2193-shaped owner holding IMPLEMENTATION NONE is created, and pulls back unchanged", async () => {
		await removeItem(MIGRATED)
		await createItem(MIGRATED, MIGRATED_SRC)

		expect(lf((await fetchItem(MIGRATED)).sourceText)).toBe(MIGRATED_SRC)
	})

	it("code under its abstract method is refused before any write, naming the member and the IDE's words", async () => {
		const before = await fetchItem(MIGRATED)
		const withCode = lf(before.sourceText).replace(
			"METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE",
			"METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION ST\nTakePicture := 1;",
		)
		expect(withCode).not.toBe(lf(before.sourceText))

		const r = await bridge.push({
			expectedProjectVersion: (await bridge.refs()).projectVersion,
			ops: [{ op: "set", name: await pathOf(MIGRATED), sourceText: withCode, ifVersion: before.version }],
		})

		expect(r.accepted).toBe(false)
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

	it("pulls IMPLEMENTATION NONE under the abstract method and the abstract property's GET, and nowhere else", () => {
		const text = lf(original.sourceText)
		// The member's %FOLDER directive stands under its line (`StWriter`).
		expect(text).toContain(`${SIGNATURE}\nIMPLEMENTATION NONE\n%FOLDER Commands\nEND_METHOD`)
		expect(text).toContain("PROPERTY PUBLIC ABSTRACT Busy : BOOL\n%FOLDER Properties\nGET\nIMPLEMENTATION NONE\nEND_GET")
		expect(text.split("\n").filter((l) => l === "IMPLEMENTATION NONE")).toHaveLength(2)
	})

	it("a declaration line beside it pushes back, lands, and the member still pulls NONE (its object is kept)", async () => {
		const edited = lf(original.sourceText).replace(SIGNATURE, `${SIGNATURE}\n${ADDED}`)
		expect(edited).not.toBe(lf(original.sourceText))

		const r = await pushOps([{ op: "set", name: await pathOf(OWNER), sourceText: edited, ifVersion: original.version }])
		expect({ landed: landedInFull(r), conflicts: r.conflicts ?? [] }).toEqual({ landed: true, conflicts: [] })

		expect(lf((await fetchItem(OWNER)).sourceText)).toBe(edited)
	})

	// A file pulled before abstract-member-parity states `IMPLEMENTATION ST` with nothing under it: the same content as
	// NONE — accepted, no body written at the missing slot, and the member still pulls NONE. (It was refused here while
	// the text depended on the slot.)
	it("an empty IMPLEMENTATION ST under it is the same content as NONE: accepted, and it still pulls NONE", async () => {
		const before = await fetchItem(OWNER)
		const stale = lf(before.sourceText).replace(`${SIGNATURE}\n${ADDED}\nIMPLEMENTATION NONE`, `${SIGNATURE}\nIMPLEMENTATION ST`)
		expect(stale).toContain(`${SIGNATURE}\nIMPLEMENTATION ST\n%FOLDER Commands\nEND_METHOD`)

		const r = await pushOps([{ op: "set", name: await pathOf(OWNER), sourceText: stale, ifVersion: before.version }])
		expect({ landed: landedInFull(r), conflicts: r.conflicts ?? [] }).toEqual({ landed: true, conflicts: [] })

		expect(lf((await fetchItem(OWNER)).sourceText)).toBe(lf(original.sourceText))
	})
})
