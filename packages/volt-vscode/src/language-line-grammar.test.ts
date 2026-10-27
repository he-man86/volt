import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The `%LANGUAGE <LANG>` line in the Structured Text grammar (openspec language-line). The rule is an
// Oniguruma regex that is also a valid JavaScript one once its leading `(?i)` becomes the `i` flag, so it is exercised
// as written: the line the writer writes must colour as keywords, and a look-alike the LSP and the push do not read as
// the line must not.

type Rule = { match?: string; captures?: Record<string, { name: string }> }
type Grammar = { patterns: { include?: string }[]; repository: Record<string, Rule> }
const grammar = JSON.parse(
	readFileSync(join(import.meta.dir, "..", "languages", "structured-text", "syntax.tmLanguage.json"), "utf8"),
) as Grammar
const rule = grammar.repository["language-line"]!
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

test("%LANGUAGE and the language it states colour as keywords, for every line a body can state", () => {
	for (const language of ["ST", "LD", "FBD"])
		expect(coloured(`%LANGUAGE ${language}`)).toEqual({ "%LANGUAGE": KEYWORD, [language]: LANGUAGE })
	// A body Volt does not show (section 3b): its language and UNSUPPORTED, on every language but ST.
	// …and any other word: the vendor's own name for a language Volt has never seen (bridge-refusal-review D27).
	for (const language of ["LD", "FBD", "CFC", "SFC", "IL", "UML", "NWL", "NONE"])
		expect(coloured(`%LANGUAGE ${language} UNSUPPORTED`)).toEqual({
			"%LANGUAGE": KEYWORD,
			[language]: LANGUAGE,
			UNSUPPORTED: KEYWORD,
		})
})

test("spacing is free and the language word is read in any case", () => {
	expect(coloured("  %LANGUAGE \t st  ")).toEqual({ "%LANGUAGE": KEYWORD, st: LANGUAGE })
})

test("only a whole line holding the statement is the line", () => {
	for (const line of [
		"%LANGUAGE",
		"%LANGUAGE XYZ",
		"%LANGUAGE LD;",
		"%LANGUAGE LD // note",
		"%LANGUAGE LD out := a;",
		"%LANGUAGE ST UNSUPPORTED",
		"%LANGUAGE UNSUPPORTED UNSUPPORTED",
		"%LANGUAGE CFC", // a CFC, SFC or IL body is never shown, so the bare line states nothing
		"%LANGUAGE SFC",
		"%LANGUAGE IL",
		"%LANGUAGE CFC UNSUPPORTED x",
		"x := %LANGUAGE LD;",
		"IMPLEMENTATION ST", // the retired line
		"%LANGUAGE_DONE := TRUE;",
	])
		expect({ line, coloured: coloured(line) }).toEqual({ line, coloured: null })
})

test("comments are matched before the line, so a line inside a block comment stays comment", () => {
	const order = grammar.patterns.map((p) => p.include)
	expect(order.indexOf("#comments")).toBeLessThan(order.indexOf("#language-line"))
	expect(order.indexOf("#language-line")).toBeLessThan(order.indexOf("#identifiers"))
})
