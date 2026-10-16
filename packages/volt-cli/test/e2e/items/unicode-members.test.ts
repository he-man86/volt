/**
 * A PROJECT WHOSE MEMBERS ARE NAMED IN CHINESE CAN BE PUSHED — openspec `codesys-existing-unicode-members`, against a
 * live CODESYS.
 *
 * <p>The field bug (PLC Assist chat be8c6faa): every write to a POU holding a CJK-named method was refused before
 * anything landed — "the IDE refuses to create method '从Modbus读取命令' in '命令队列管理'" — although nothing was being
 * created: the pre-flight asked every member's name, on an update too, and CODESYS's driver refused every name that is
 * no ASCII identifier. Measured on SP21 (DIALECT C28b): CODESYS takes such a name exactly when the project's Compile
 * option "Unicode identifiers" is on — the customer's project has it on, Volt's other fixtures have it off.</p>
 *
 * <p>The objects are the IDE's own (`scripts/author-unicode-members-fixture.py`: the option switched on, the FB, its two
 * methods, the DUT and a task-called program made by the scripting creates, built clean, saved), committed as
 * `test/fixtures/CodesysUnicodeMembers.3.5.21.40.project` — never Volt's push, whose pre-flight is the defect.</p>
 *
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance unicode-members -Fixture test/fixtures/CodesysUnicodeMembers.3.5.21.40.project -Wait
 *   VOLT_E2E_INSTANCE=unicode-members VOLT_VENDOR=codesys bun test test/e2e/items/unicode-members.test.ts
 * </pre>
 */
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { bridge } from "../lib/bridge"
import { BASE, VENDOR } from "../lib/pipe"
import { fetchItem, landedInFull, pushOps } from "../lib/workspace"

setDefaultTimeout(600_000)

const FB = "命令队列管理.pou"
const READ_CMD = "从Modbus读取命令"
const ZONE_FREE = "区域可占用"
const lf = (s: string) => s.replace(/\r\n/g, "\n")
const reasons = (r: any) => ((r?.conflicts ?? []) as any[]).map((c) => String(c.reason ?? "")).join(" | ")
/** The text from a member's header to the next member's (or the file's end): what "the method is unchanged" compares. */
const member = (text: string, name: string) => {
	const ls = lf(text).split("\n")
	const at = ls.findIndex((l) => new RegExp(`^METHOD\\s+(.*\\s)?${name}\\b`).test(l))
	if (at < 0) throw new Error(`no METHOD ${name} in:\n${text}`)
	const end = ls.findIndex((l, i) => i > at && /^(METHOD|PROPERTY|ACTION|END_FUNCTION_BLOCK)\b/.test(l))
	return ls.slice(at, end < 0 ? undefined : end).join("\n")
}

const items = (await bridge.refs()).items ?? {}
const served = VENDOR === "codesys" && FB in items
if (VENDOR === "codesys" && !served)
	console.warn(`[unicode-members] ${BASE} serves no ${FB} — serve test/fixtures/CodesysUnicodeMembers.3.5.21.40.project (ide.ps1 up -Fixture …)`)

describe.skipIf(!served)(`a POU with CJK-named methods / CODESYS (${BASE})`, () => {
	let original = ""
	afterAll(async () => {
		if (!original) return
		await pushOps([{ op: "set", name: FB, sourceText: original, ifVersion: (await bridge.refs()).items[FB] ?? null }])
	})

	it("patching the FB's body lands, and both methods are kept as they were", async () => {
		const before = await fetchItem(FB)
		original = before.sourceText
		expect(lf(original)).toContain("计数 := 计数 + 1;")
		const patched = lf(original).replace("计数 := 计数 + 1;", "计数 := 计数 + 2;")
		const r = await pushOps([{ op: "set", name: FB, sourceText: patched, ifVersion: before.version }])
		expect(landedInFull(r), reasons(r)).toBe(true)
		const after = lf((await fetchItem(FB)).sourceText)
		expect(after).toContain("计数 := 计数 + 2;")
		for (const m of [READ_CMD, ZONE_FREE]) expect(member(after, m)).toBe(member(original, m))
	})

	it("a NEW method named in CJK is created: the IDE takes it (its project has Unicode identifiers on)", async () => {
		const now = await fetchItem(FB)
		const added = lf(now.sourceText).replace(
			/END_FUNCTION_BLOCK\s*$/,
			"METHOD 读取命令 : BOOL\nIMPLEMENTATION ST\n读取命令 := TRUE;\n\nEND_FUNCTION_BLOCK\n",
		)
		const r = await pushOps([{ op: "set", name: FB, sourceText: added, ifVersion: now.version }])
		expect(landedInFull(r), reasons(r)).toBe(true)
		expect(member((await fetchItem(FB)).sourceText, "读取命令")).toContain("读取命令 := TRUE;")
	})

	it("a NEW name the IDE refuses is refused in the IDE's own sentence", async () => {
		// A leading digit before CJK: refused by SP21 with Unicode identifiers on (DIALECT C28b) — the IDE's verdict, not
		// a pre-flight guess, so it arrives as the IDE words it.
		const now = await fetchItem(FB)
		const bad = lf(now.sourceText).replace(
			/END_FUNCTION_BLOCK\s*$/,
			"METHOD 1点 : BOOL\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n",
		)
		const r = await pushOps([{ op: "set", name: FB, sourceText: bad, ifVersion: now.version }])
		expect(landedInFull(r)).toBe(false)
		expect(reasons(r)).toContain("The name '1点' is not valid for this object.")
	})
})
