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
	const text = '%NETWORK "Start $"it$""\n%DISABLED\nVAR w1 : ANY; w2 : ANY; END_VAR\n%UNSUPPORTED "a shape" #0011aabb\n'
	expect(matches(lines, text, 1)).toEqual(["%NETWORK", "%DISABLED", "%UNSUPPORTED"])
	// …only first on its line, and only its own keys: a % in a comment or a name is none.
	expect(matches(lines, "x := a; // %NETWORK\n%NETWORKS\n")).toEqual([])
})

test("a box's head is coloured where its call opens; the same word as a contact or a name is not", () => {
	const words = rule("keyword.operator.word.network-text")
	const text =
		"ASSIGN(ADD(a, b), Q => x); ASSIGN(BRANCH_SHORTCIRCUIT(FEED := c, a, b), Q => y); ASSIGN(RISING(INVERT(c)), Q => z); " +
		"ASSIGN(FALLING(c), Q => f); ASSIGN(RAIL(), Q => r); ASSIGN(a AND b, Q => q); EXECUTE('n := 1;'); " +
		"ASSIGN(ADD(OPERAND('INT_TO_WORD(i)'), 1), Q => COMMENT(k, 'why'));"
	expect(matches(words, text)).toEqual([
		"ASSIGN", "ADD",
		"ASSIGN", "BRANCH_SHORTCIRCUIT",
		"ASSIGN", "RISING", "INVERT",
		"ASSIGN", "FALLING",
		"ASSIGN", "RAIL",
		"ASSIGN",
		"EXECUTE",
		"ASSIGN", "ADD", "OPERAND", "COMMENT",
	])
	expect(matches(words, "s.ADD(a); xADD(a); s.ASSIGN(a);")).toEqual([])
})

test("a jump and the return are targets of an ASSIGN; the same words elsewhere are not", () => {
	const targets = rule("keyword.control.target.network-text")
	expect(matches(targets, "ASSIGN(a, Q => JMP.l); ASSIGN(b, Q_INVERTED => JMP.???); ASSIGN(c, Q => RETURN);", 1)).toEqual([
		"JMP",
		"JMP",
		"RETURN",
	])
	expect(matches(targets, "ASSIGN(a, Q => jmpx); t1(IN := a, Q => RETURNED);", 1)).toEqual([])
})

test("a mark on a receiver is in its output's name", () => {
	const marks = rule("keyword.other.mark.network-text")
	expect(matches(marks, "ASSIGN(a, Q_INVERTED => y, Q_SET => s, Q_RESET => r); t1(IN := a, PT := T#1S, q2_SET => k);", 1)).toEqual([
		"_INVERTED",
		"_SET",
		"_RESET",
		"_SET",
	])
	expect(matches(marks, "ASSIGN(a, Q => y); t1(IN := a, Q => x); ASSIGN(b, Q => Q_SET_x);", 1)).toEqual([])
})
