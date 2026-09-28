import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The `IMPLEMENTATION <LANG>` line in the Structured Text grammar (openspec implementation-keyword 3.2). The rule is an
// Oniguruma regex that is also a valid JavaScript one once its leading `(?i)` becomes the `i` flag, so it is exercised
// as written: the line the writer writes must colour as keywords, and a look-alike the LSP and the push do not read as
// the line must not.

type Rule = { match?: string; captures?: Record<string, { name: string }> }
type Grammar = { patterns: { include?: string }[]; repository: Record<string, Rule> }
const grammar = JSON.parse(
	readFileSync(join(import.meta.dir, "..", "languages", "structured-text", "syntax.tmLanguage.json"), "utf8"),
) as Grammar
const rule = grammar.repository["implementation-line"]!
const re = new RegExp(rule.match!.replace(/^\(\?i\)/, ""), "i")

/** The scope each captured word of `line` gets, as `word → scope`; null when the line does not match. */
function coloured(line: string): Record<string, string> | null {
	const m = re.exec(line)
	if (m === null) return null
	const out: Record<string, string> = {}
	for (const [i, c] of Object.entries(rule.captures!)) if (m[Number(i)] !== undefined) out[m[Number(i)]!] = c.name
	return out
}

const KEYWORD = "keyword.other.implementation.structured-text"
const LANGUAGE = "keyword.other.implementation.language.structured-text"

test("IMPLEMENTATION and the language it states colour as keywords, for every language a body can state", () => {
	for (const language of ["ST", "LD", "FBD", "CFC", "SFC", "IL"])
		expect(coloured(`IMPLEMENTATION ${language}`)).toEqual({ IMPLEMENTATION: KEYWORD, [language]: LANGUAGE })
	expect(coloured("IMPLEMENTATION LD UNSUPPORTED")).toEqual({ IMPLEMENTATION: KEYWORD, LD: LANGUAGE, UNSUPPORTED: KEYWORD })
	expect(coloured("IMPLEMENTATION FBD UNSUPPORTED")).toEqual({ IMPLEMENTATION: KEYWORD, FBD: LANGUAGE, UNSUPPORTED: KEYWORD })
})

test("spacing is free and the words are case-insensitive, as ST keywords are", () => {
	expect(coloured("  implementation \t st  ")).toEqual({ implementation: KEYWORD, st: LANGUAGE })
})

test("only a whole line holding the statement is the line", () => {
	for (const line of [
		"IMPLEMENTATION",
		"IMPLEMENTATION XYZ",
		"IMPLEMENTATION LD;",
		"IMPLEMENTATION LD // note",
		"IMPLEMENTATION LD out := a;",
		"IMPLEMENTATION ST UNSUPPORTED",
		"IMPLEMENTATION CFC UNSUPPORTED",
		"x := IMPLEMENTATION LD;",
		"IMPLEMENTATION_DONE := TRUE;",
	])
		expect({ line, coloured: coloured(line) }).toEqual({ line, coloured: null })
})

test("comments are matched before the line, so a line inside a block comment stays comment", () => {
	const order = grammar.patterns.map((p) => p.include)
	expect(order.indexOf("#comments")).toBeLessThan(order.indexOf("#implementation-line"))
	expect(order.indexOf("#implementation-line")).toBeLessThan(order.indexOf("#identifiers"))
})
