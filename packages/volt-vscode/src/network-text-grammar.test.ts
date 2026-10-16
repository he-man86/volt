import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The network-text injection grammar against network text (readability.md, openspec ld-fbd-coverage 2R.3). The rules are
// Oniguruma regexes, and every one used here is also a valid JavaScript regex, so they are exercised as written: a
// rule that stops matching the text the writer writes is a colouring the editor silently loses.

type Rule = {
	name?: string
	match?: string
	begin?: string
	end?: string
	beginCaptures?: Record<string, { name: string }>
	endCaptures?: Record<string, { name: string }>
	patterns?: Rule[]
	include?: string
}
const grammar = JSON.parse(
	readFileSync(join(import.meta.dir, "..", "languages", "structured-text", "network-text.injection.tmLanguage.json"), "utf8"),
) as { patterns: Rule[] }
// A network lives only in a body whose line STATES LD or FBD (openspec implementation-keyword: the stated language is
// the one signal for how a body is read) — never found by sniffing a NETWORK line, which ST may hold as a name.
const body = grammar.patterns.find((p) => p.name === "meta.body.network.vg")!
const network = body.patterns!.find((p) => p.name === "meta.network.vg")!
const inner = network.patterns!
const rule = (name: string): Rule => {
	const r = inner.find((p) => p.name === name || p.beginCaptures?.["1"]?.name === name)
	if (r === undefined) throw new Error(`no rule ${name}`)
	return r
}
const re = (src: string): RegExp => new RegExp(src.replace(/^\(\?i\)/, ""), src.startsWith("(?i)") ? "gi" : "g")
const matches = (r: Rule, text: string): string[] => [...text.matchAll(re(r.match ?? r.begin!))].map((m) => m[0])

test("the header is NETWORK with its named fields and no order number or language", () => {
	const m = re(network.begin!).exec('NETWORK LABEL: Done DISABLED TITLE: "Tray $"A$" ready"')
	expect(m).not.toBeNull()
	const caps = network.beginCaptures!
	const named = Object.entries(caps).map(([i, c]) => [c.name, m![Number(i)]])
	expect(named).toContainEqual(["keyword.control.vg", "NETWORK"])
	expect(named).toContainEqual(["entity.name.label.vg", "Done"])
	expect(named).toContainEqual(["string.quoted.double.vg", '"Tray $"A$" ready"'])
	expect(named).toContainEqual(["keyword.other.vg", "DISABLED"])
	// A variable spelled NETWORK_OK is no header.
	expect(re(network.begin!).exec("NETWORK_OK := TRUE;")).toBeNull()
})

test("backticked text is one operand, whatever it holds", () => {
	expect(matches(rule("variable.other.quoted.vg"), "P := `fc_dinttotime(T.Start,2)` AND `a .b`;")).toEqual([
		"`fc_dinttotime(T.Start,2)`",
		"`a .b`",
	])
})

test("the edge words are the text's own constructs", () => {
	const r = rule("keyword.other.construct.vg")
	expect(matches(r, "MOVE 1 => m EN R_EDGE(b); x := F_EDGE(NOT y);")).toEqual(["R_EDGE", "F_EDGE"])
	// …only as the construct: a variable merely containing the word is not one.
	expect(matches(r, "xR_EDGE := F_EDGE_count;")).toEqual([])
})

test("a split is its VarId, split<n>, and the pattern alone tells one (B6, P1)", () => {
	expect(matches(rule("variable.other.wire.vg"), "split22 := a AND b; x := split22 OR `split5`; mysplit3 := s.split4;")).toEqual(["split22", "split22"])
})

test("EN, ENO, BRANCH and SHORTCIRCUIT are words of the text; a box is its word (B1-B4, B8)", () => {
	expect(matches(rule("keyword.other.eno.vg"), "MOVE 0 => x EN c\nlamp := ENO BRANCH (a, b) SHORTCIRCUIT; x := s.ENOUGH OR `EN`;")).toEqual([
		"EN",
		"ENO",
		"BRANCH",
		"SHORTCIRCUIT",
	])
	expect(matches(rule("keyword.operator.word.vg"), "x := a ADD b; MOVE x => y; t := addr GT 1; z := LIMIT(0, v, 9);")).toEqual(["ADD", "MOVE", "GT"])
})

test("LET is gone: v1 text is refused, so nothing colours it as syntax", () => {
	expect(inner.some((p) => (p.match ?? "").includes("LET"))).toBe(false)
})

test("the LSP's wire token class is declared, with variable as its super type", () => {
	// The server paints a split with its own semantic token type, `wire` (openspec network-text-literal-nwl 5.3). A client
	// that has no declaration for a custom type drops the token, so the extension declares it — and as a kind of
	// variable, so a theme that knows nothing of splits still colours one like the variable it reads as.
	const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
		contributes: { semanticTokenTypes?: { id: string; superType?: string }[] }
	}
	expect(manifest.contributes.semanticTokenTypes).toContainEqual(expect.objectContaining({ id: "wire", superType: "variable" }))
})

test("networks are read only under a line stating LD or FBD — never by sniffing a NETWORK line", () => {
	// Only the body region stands at the top: ST that names a variable NETWORK (`NETWORK := TRUE;`) opens nothing.
	expect(grammar.patterns.map((p) => p.name)).toEqual(["meta.body.network.vg"])
	const opens = (line: string): boolean => re(body.begin!).test(line)
	expect(opens("IMPLEMENTATION LD")).toBe(true)
	expect(opens("  implementation fbd  ")).toBe(true)
	expect(opens("IMPLEMENTATION ST")).toBe(false)
	expect(opens("IMPLEMENTATION LD UNSUPPORTED")).toBe(false)
	expect(opens("IMPLEMENTATION CFC UNSUPPORTED")).toBe(false)
	expect(opens("x := IMPLEMENTATION LD;")).toBe(false)
	// The line is coloured exactly as the main grammar colours it — the injection wins the line, so it must.
	const main = JSON.parse(
		readFileSync(join(import.meta.dir, "..", "languages", "structured-text", "syntax.tmLanguage.json"), "utf8"),
	) as { repository: Record<string, { captures: Record<string, { name: string }> }> }
	const line = main.repository["implementation-line"]!.captures
	expect(body.beginCaptures!["1"]!.name).toBe(line["1"]!.name)
	expect(body.beginCaptures!["2"]!.name).toBe(line["3"]!.name)
})

test("the body region ends where its unit closes, and leaves that keyword to the main grammar", () => {
	const end = re(body.end!)
	for (const kw of ["END_FUNCTION_BLOCK", "END_PROGRAM", "END_FUNCTION", "END_METHOD", "END_ACTION", "END_GET", "END_SET"]) {
		end.lastIndex = 0
		const m = end.exec(`${kw}\n`)
		expect(m?.[0]).toBe("") // a lookahead: nothing consumed
	}
	end.lastIndex = 0
	expect(end.exec("END_NETWORK")).toBeNull()
})
