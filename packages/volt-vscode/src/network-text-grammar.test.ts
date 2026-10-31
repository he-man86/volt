import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The network-text injection grammar against network text (volt-cli docs/network-text.html). The rules are Oniguruma
// regexes, and every one used here is also a valid JavaScript regex, so they are exercised as written: a rule that stops
// matching the text the writer writes is a colouring the editor silently loses.

type Rule = {
	name?: string
	match?: string
	begin?: string
	captures?: Record<string, { name?: string }>
	beginCaptures?: Record<string, { name: string }>
	patterns?: Rule[]
	include?: string
}
const grammar = JSON.parse(
	readFileSync(join(import.meta.dir, "..", "languages", "structured-text", "network-text.injection.tmLanguage.json"), "utf8"),
) as { patterns: Rule[] }
// Network text lives only in a body whose line STATES LD or FBD — never found by sniffing its content.
const body = grammar.patterns.find((p) => p.name === "meta.body.network-text")!
const inner = body.patterns!
const rule = (name: string): Rule => {
	const r = inner.find((p) => p.name === name || Object.values(p.captures ?? {}).some((c) => c.name === name))
	if (r === undefined) throw new Error(`no rule ${name}`)
	return r
}
const re = (src: string): RegExp => new RegExp(src.replace(/^\(\?i\)/, ""), src.startsWith("(?i)") ? "gim" : "gm")
const matches = (r: Rule, text: string, group = 0): string[] => [...text.matchAll(re(r.match!))].map((m) => m[group]!)

test("a body is network text only under %LANGUAGE LD or FBD", () => {
	expect(re(body.begin!).test("%LANGUAGE LD")).toBe(true)
	expect(re(body.begin!).test("%LANGUAGE FBD")).toBe(true)
	expect(re(body.begin!).test("%LANGUAGE ST")).toBe(false)
	expect(re(body.begin!).test("%LANGUAGE LD UNSUPPORTED")).toBe(false)
})

test("the % lines of a network are its keywords; a title is a string", () => {
	const lines = rule("meta.line.network-text")
	const text = '%NETWORK "Start $"it$""\n%DISABLED\nVAR_TEMP w1 : ANY; w2 : ANY; END_VAR\n%UNSUPPORTED "a shape" #0011aabb\n'
	expect(matches(lines, text, 1)).toEqual(["%NETWORK", "%DISABLED", "%UNSUPPORTED"])
	// …only first on its line, and only its own keys: a % in a comment or a name is none.
	expect(matches(lines, "x := a; // %NETWORK\n%NETWORKS\n")).toEqual([])
})

test("a box's head is coloured where its call opens; the same word as a contact or a name is not", () => {
	const words = rule("keyword.operator.word.network-text")
	expect(matches(words, "x := ADD(a, b); y := BRANCH_SHORTCIRCUIT(FEED := c, a, b); z := RISING(c); r := RAIL(); q := a AND b; EXECUTE('n := 1;');")).toEqual([
		"ADD",
		"BRANCH_SHORTCIRCUIT",
		"RISING",
		"RAIL",
		"EXECUTE",
	])
	expect(matches(words, "s.ADD(a); xADD(a);")).toEqual([])
})

test("the ENO a box shows is .ENO closing its call; a member of a variable is none", () => {
	const eno = rule("keyword.other.eno.network-text")
	expect(matches(eno, "lamp := MOVE(EN := c, 1, OUT => t).ENO; ok := f(a).ENO; x := GT(EN := c, i, 3); y := d.ENO;", 2)).toEqual([
		"ENO",
		"ENO",
	])
})
