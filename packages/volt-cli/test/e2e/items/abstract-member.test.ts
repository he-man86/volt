/**
 * AN ABSTRACT MEMBER PULLED FROM CODESYS PUSHES BACK (openspec `abstract-member-push` 3.2, DIALECT C2n) — live.
 *
 * <p>CODESYS holds an abstract method as an `AbstractPOUMethodObject` and an abstract property's GET as an
 * `InterfacePropertyAccessorObject`, neither with an `Implementation` aspect (`vendor-facts` `merged-classes`). The pull
 * states such a member `IMPLEMENTATION NONE`, and a push writes no body there — so an edit of the OWNER lands where it
 * used to be refused (`'TakePicture' has no Implementation — a body was pushed at a slot this object does not have`).
 * The member's object is kept: a member recreated by the push would be a `POUMethodObject` and pull back as
 * `IMPLEMENTATION ST`, so "still NONE after the push" is the class check the wire can make (GUID and class themselves
 * are read through the vendor API by `vendor-facts` `merged-classes`, `guid|class.abstract@pushed`).</p>
 *
 * <p>CODESYS only (TwinCAT's abstract members have a slot — `TcAbstractMemberSlotTests`), against the committed pro2193
 * copy, which holds the abstract members; on any other project it skips, loudly:</p>
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance <name> -Fixture test/fixtures/Pro2193-94-95-96_COdesys.project -Wait
 *   VOLT_E2E_INSTANCE=<name> VOLT_VENDOR=codesys bun test test/e2e/items/abstract-member.test.ts
 * </pre>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { BASE, VENDOR } from "../lib/pipe"
import { bridge } from "../lib/bridge"
import { fetchItem, landedInFull, pushOps } from "../lib/workspace"

setDefaultTimeout(600_000)

const OWNER = "VisionSystem_BaseFB.pou"
const SIGNATURE = "METHOD ABSTRACT TakePicture : enumResultTakePicture"
const ADDED = "// volt e2e: a declaration line beside an abstract member"
const lf = (s: string) => s.replace(/\r\n/g, "\n")

const served = VENDOR === "codesys" && OWNER in ((await bridge.refs()).items ?? {})
if (!served) console.warn(`[abstract-member] skipped: ${BASE} serves no ${OWNER} on CODESYS — serve the committed pro2193 copy`)

describe.skipIf(!served)(`abstract member / ${OWNER} (${BASE})`, () => {
	let original: { sourceText: string; version: string }

	beforeAll(async () => {
		original = await fetchItem(OWNER)
	})

	afterAll(async () => {
		const now = await fetchItem(OWNER)
		if (lf(now.sourceText) === lf(original.sourceText)) return
		const r = await pushOps([{ op: "set", name: OWNER, sourceText: original.sourceText, ifVersion: now.version }])
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

		const r = await pushOps([{ op: "set", name: OWNER, sourceText: edited, ifVersion: original.version }])
		expect({ landed: landedInFull(r), conflicts: r.conflicts ?? [] }).toEqual({ landed: true, conflicts: [] })

		expect(lf((await fetchItem(OWNER)).sourceText)).toBe(edited)
	})

	it("IMPLEMENTATION ST under it is refused before any write, naming the member and `volt pull`", async () => {
		const before = await fetchItem(OWNER)
		const stale = lf(before.sourceText).replace(`${SIGNATURE}\n${ADDED}\nIMPLEMENTATION NONE`, `${SIGNATURE}\nIMPLEMENTATION ST`)
		expect(stale).toContain(`${SIGNATURE}\nIMPLEMENTATION ST\n%FOLDER Commands\nEND_METHOD`)

		const r = await bridge.push({
			expectedProjectVersion: (await bridge.refs()).projectVersion,
			ops: [{ op: "set", name: OWNER, sourceText: stale, ifVersion: before.version }],
		})

		expect(r.accepted).toBe(false)
		const reason = String((r.conflicts ?? [])[0]?.reason ?? "")
		expect(reason).toContain("'TakePicture'")
		expect(reason).toContain("volt pull")
		expect((await fetchItem(OWNER)).version).toBe(before.version)   // nothing written
	})
})
