/**
 * `GET` / `SET` ARE LEGAL NAMES — a property whose accessor bodies use them as operands must pull, push and build on
 * BOTH bridges (openspec lsp-accessor-keyword-at-line-start). A field FB with `SET : POINTER TO …` and a setter line
 * `SET^.stri_Name := P;` was read as a second SET accessor: `unreadable` on pull, INVALID_ST on push (StReader).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, cleanup, requireHealthy, expectRoundTrip, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"
import { fb } from "../fixtures"

const MARK = "%LANGUAGE ST"
const name = id("akw_fb")
const src = fb(name, {
	vars: "VAR\n\tSET : POINTER TO INT;\n\tGET : INT;\n\tstore : INT;\nEND_VAR",
	body: "SET := ADR(store);\n", // the pull writes a blank line before END_FUNCTION_BLOCK when members follow
	children:
		`\nPROPERTY P : INT\nGET\n${MARK}\n\tP := SET^;\nGET := P;\nEND_GET\n` +
		`SET\n${MARK}\nSET^ := P;\n\tGET := SET^;\nEND_SET\nEND_PROPERTY\n`,
})

describe(`items / accessor keyword as an operand (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("a property whose bodies start lines with SET^ / GET round-trips exactly and builds", async () => {
		const back = await expectRoundTrip(fid("akw_fb"), src)
		expect(back).toContain("\nSET^ := P;\n")
		await ensureCompiles(name)
	})
})
