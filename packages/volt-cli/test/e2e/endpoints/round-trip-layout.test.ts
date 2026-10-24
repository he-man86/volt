/**
 * A PUSHED TEXT COMES BACK IN THE CANONICAL LAYOUT, AND ONLY THAT CHANGES (wire-final-shape 4.3b, against the rule of
 * 4.3d: `wire.html#layout`). PLC Assist's read/edit suite (2026-10-24, bridge 0.1.17931) pushed a 2,451-line FB as one
 * create, fetched it back and found 80 lines different BY INDEX on both vendors: one blank line the writer puts before
 * the END line (`end-line`), shifting every member line after it, plus CRLF fetched as LF (`lf`). Both are rows of the
 * layout, so the fetched text is predictable from the page: this file pushes PLC Assist's three shapes (their generator,
 * `tests/support/large-item.ts`: tab indentation, typographic quotes and a dash, trailing whitespace, a 2,100-character
 * line, 8 METHODs and a PROPERTY with GET only, the END line straight after the code) and holds the fetched text to the
 * pushed one with exactly those rows applied — byte for byte, nothing else may move — then that it is a fixed point.
 * Their third shape's leading U+FEFF is refused BAD_REQUEST (`push.test.ts`); here it is pushed without one.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, at, cleanup, requireHealthy, pushOps, landed, BASE } from "../harness"

const TAB = "\t"

/** PLC Assist's `largeFunctionBlock(name)` (padLines 2,350, 8 methods), LF, no BOM. */
function bigFb(name: string): string {
	const lines = [`FUNCTION_BLOCK ${name}`, "VAR_INPUT", `${TAB}xEnable : BOOL;`, "END_VAR", "VAR",
		`${TAB}nVltRwCount : DINT;`, `${TAB}nVltRwExact : DINT;`, `${TAB}nVltRwTrailing : DINT;`,
		`${TAB}nVltRwTrailTarget : DINT;`, `${TAB}nVltRwSecondPage : DINT;`]
	for (let i = 0; i < 2_350; i++) {
		const n = String(i).padStart(4, "0")
		lines.push(`${TAB}nPad${n} : DINT; (* padding ${n} *)`)
	}
	lines.push("END_VAR", "IMPLEMENTATION ST", "IF xEnable THEN",
		`${TAB}nVltRwCount := nVltRwCount + 1;`,
		`${TAB}nVltRwExact := 1;`,
		`${TAB}(* VltRwUnicode “ready” – ‘set’ *)`,
		`${TAB}nVltRwTrailing := 2;${TAB}  `,
		`${TAB}nVltRwTrailTarget := 3;`,
		`${TAB}(* VltRwLong ${"x".repeat(2_100)} *)`,
		`${TAB}nVltRwSecondPage := 4;`,
		"END_IF", "END_FUNCTION_BLOCK")
	for (let m = 0; m < 8; m++)
		lines.push("", `METHOD M_VltRwStep${m} : BOOL`, "VAR_INPUT", `${TAB}nIn : DINT;`, "END_VAR", "IMPLEMENTATION ST",
			`${TAB}nVltRwCount := nVltRwCount + 1;`, `${TAB}M_VltRwStep${m} := nIn > ${m};`, "END_METHOD")
	lines.push("", "PROPERTY P_VltRwCount : DINT", "GET", "IMPLEMENTATION ST", `${TAB}P_VltRwCount := nVltRwCount;`,
		"END_GET", "END_PROPERTY")
	return `${lines.join("\n")}\n`
}

/** PLC Assist's `smallFunctionBlock(name, eol, false)`. */
const smallFb = (name: string, eol: string) =>
	[`FUNCTION_BLOCK ${name}`, "VAR", `${TAB}nVltRwEol : DINT;`, "END_VAR", "IMPLEMENTATION ST", `${TAB}nVltRwEol := 1;`,
		`${TAB}nVltRwEolKeep := 2;`, "END_FUNCTION_BLOCK", ""].join(eol)

/** The rows these texts break, applied: `lf` (CRLF is a line end, fetched LF) and `end-line` (one blank line between
 *  the code and the END line). Nothing else differs between a pushed text and its fetch. */
const canonical = (pushed: string) =>
	pushed.replaceAll("\r\n", "\n").replace("\nEND_FUNCTION_BLOCK\n", "\n\nEND_FUNCTION_BLOCK\n")

const SHAPES: [string, (n: string) => string][] = [
	["VltRwBig (2,451 lines, members, LF)", bigFb],
	["VltRwLf (LF)", (n) => smallFb(n, "\n")],
	["VltRwCrlf (CRLF)", (n) => smallFb(n, "\r\n")],
]

describe(`endpoints / a pushed text comes back in the canonical layout (${BASE})`, () => {
	setDefaultTimeout(300_000)
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	for (const [k, [label, text]] of SHAPES.entries())
		it(`${label}: fetched = pushed with the lf and end-line rows applied, and that is a fixed point`, async () => {
			const key = `rtl_${k}`, wire = await at(fid(key)), pushed = text(id(key))
			const created = await pushOps([{ op: "set", name: wire, sourceText: pushed, ifVersion: null }])
			expect(landed(created), JSON.stringify(created.conflicts)).toBe(true)

			const fetch = async () => (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
			const back = await fetch()
			expect(back, `${wire} not in fetch`).toBeDefined()
			const want = canonical(pushed)
			expect(back.sourceText).not.toBe(pushed)   // the shapes break the layout: the test is about that difference
			const a = back.sourceText.split("\n"), b = want.split("\n")
			const first = b.findIndex((l: string, i: number) => l !== a[i])
			expect(back.sourceText, `first difference at line ${first + 1}: ${JSON.stringify(a[first]?.slice(0, 80))} vs ${JSON.stringify(b[first]?.slice(0, 80))}`).toBe(want)

			const again = await pushOps([{ op: "set", name: wire, sourceText: back.sourceText, ifVersion: back.version }])
			expect(landed(again), JSON.stringify(again.conflicts)).toBe(true)
			expect((await fetch()).sourceText).toBe(want)
			await pushOps([{ op: "deleteItem", name: wire }])
		})
})
