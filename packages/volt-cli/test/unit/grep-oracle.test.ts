/**
 * The grep ORACLE's own reading of the spec, offline (`test/e2e/lib/grep-oracle.ts`; openspec
 * `changes/archive/2026-10-20-grep-item-sources`). The e2e `endpoints/grep-oracle.test.ts` compares the bridge with this
 * oracle on a live project, so a misread here would be reported there as a bridge bug: every case below is a sentence
 * of the spec, not an observation of the bridge.
 */
import { describe, expect, it } from "bun:test"
import { cut, differences, globMatch, lines, matcher, oracle, type Project } from "../e2e/lib/grep-oracle"

const project = (items: Record<string, string>, extra: Partial<Project> = {}): Project => ({
	items: Object.entries(items).map(([path, text]) => ({ path, version: `v_${path}`, text, unsupported: null })),
	unreadable: [],
	unwalkedFolders: [],
	...extra,
})

describe("grep oracle", () => {
	it("lines are 1-based, without their line ending; a final line ending opens no empty line", () => {
		expect(lines("a\r\nb\n")).toEqual(["a", "b"])
		expect(lines("a\n\nb")).toEqual(["a", "", "b"])
		expect(lines("")).toEqual([])
		expect(lines("\tx\t\t:= 1;\r\n")).toEqual(["\tx\t\t:= 1;"])
	})

	it("a line's text is cut at 500 characters with …", () => {
		expect(cut("x".repeat(500))).toBe("x".repeat(500))
		expect(cut("x".repeat(501))).toBe("x".repeat(500) + "…")
	})

	it("globs: * within a segment, ** across zero or more, ? one character, ignoring case, %2F literal", () => {
		expect(globMatch("**/*.gvl", "GVL.gvl")).toBe(true)
		expect(globMatch("**/*.gvl", "Dev/Plc Logic/App/GVL.gvl")).toBe(true)
		expect(globMatch("*.gvl", "App/GVL.gvl")).toBe(false)
		expect(globMatch("Line1/**", "line1/Plc Logic/App/PLC_PRG.pou")).toBe(true)
		expect(globMatch("Line1/**", "Line2/Plc Logic/App/PLC_PRG.pou")).toBe(false)
		expect(globMatch("**/PLC_PR?.pou", "App/PLC_PRG.pou")).toBe(true)
		expect(globMatch("**/PLC_PR?.pou", "App/PLC_PR/G.pou")).toBe(false)
		expect(globMatch("**/a%2Fb/**", "App/a%2Fb/X.pou")).toBe(true)
		expect(globMatch("App/*/X.pou", "App/a/b/X.pou")).toBe(false)
	})

	it("case-insensitive by default, folding Ä/ä; a literal's regex characters are plain text", () => {
		expect(matcher({ pattern: "fb_motor" }).test("x : FB_MOTOR;")).toBe(true)
		expect(matcher({ pattern: "fb_motor", caseSensitive: true }).test("x : FB_MOTOR;")).toBe(false)
		expect(matcher({ pattern: "zähler" }).test("ZÄHLER := 1;")).toBe(true)
		expect(matcher({ pattern: "a.b(", literal: true }).test("a.b(1)")).toBe(true)
		expect(matcher({ pattern: "a.b(", literal: true }).test("axb(1)")).toBe(false)
		expect(matcher({ pattern: "电机控制" }).test("电机控制 : FB_电机;")).toBe(true)
	})

	it("answers matches in ordinal path order then line order, with the matched items' versions", () => {
		const p = project({ "b/Y.pou": "x\nx", "B/Z.pou": "x", "a/X.pou": "y\nx" })
		const r = oracle(p, { pattern: "x" })
		expect(r.matches.map((m) => `${m.name}:${m.line}`)).toEqual(["B/Z.pou:1", "a/X.pou:2", "b/Y.pou:1", "b/Y.pou:2"])
		expect(r.items).toEqual({ "B/Z.pou": "v_B/Z.pou", "a/X.pou": "v_a/X.pou", "b/Y.pou": "v_b/Y.pou" })
		expect(r.searched).toBe(3)
	})

	it("limit bounds the matches and the items; totalMatches counts on; truncated says so", () => {
		const r = oracle(project({ "A.pou": "x\nx", "B.pou": "x" }), { pattern: "x", limit: 2 })
		expect(r.matches).toHaveLength(2)
		expect(r.items).toEqual({ "A.pou": "v_A.pou" })
		expect(r.totalMatches).toBe(3)
		expect(r.truncated).toBe(true)
	})

	it("stops at 10,000 matches: totalMatches 10000, the items after it not searched", () => {
		const r = oracle(project({ "A.pou": "x\n".repeat(10_000), "B.pou": "x" }), { pattern: "x" })
		expect(r.totalMatches).toBe(10_000)
		expect(r.searched).toBe(1)
		expect(r.truncated).toBe(true)
	})

	it("notSearched: unreadable items in scope (never a library), and items whose text has an UNSUPPORTED body", () => {
		const p = project(
			{ "A.pou": "PROGRAM A\n%LANGUAGE CFC UNSUPPORTED\nEND_PROGRAM", "B.pou": "PROGRAM B" },
			{ unreadable: [{ name: "C.pou", reason: "read failed" }, { name: "L.library", reason: "x" }] },
		)
		const want = oracle(p, { pattern: "PROGRAM" })
		expect(want.matches.map((m) => `${m.name}:${m.line}`)).toEqual(["A.pou:1", "A.pou:3", "B.pou:1"])
		expect(want.notSearched.unreadable).toEqual([{ name: "C.pou", reason: "read failed" }])
		expect(want.notSearched.hidden.map((h) => h.name)).toEqual(["A.pou"])
		const answer = (notSearched: unknown) => ({ ...want, notSearched })
		expect(differences(answer([{ name: "A.pou", reason: "its body reads %LANGUAGE CFC UNSUPPORTED" }, { name: "C.pou", reason: "read failed" }]), want)).toEqual([])
		expect(differences(answer([{ name: "C.pou", reason: "read failed" }]), want)).toHaveLength(1)
		expect(differences(answer([{ name: "A.pou", reason: "its body reads %LANGUAGE CFC UNSUPPORTED" }, { name: "B.pou", reason: "?" }, { name: "C.pou", reason: "read failed" }]), want)).toHaveLength(1)
	})

	it("differences names a match that differs, and nothing for an identical answer", () => {
		const want = oracle(project({ "A.pou": "x" }), { pattern: "x" })
		const same = { ...want, notSearched: [] }
		expect(differences(same, want)).toEqual([])
		expect(differences({ ...same, matches: [{ name: "A.pou", line: 2, text: "x" }] }, want)).toHaveLength(1)
	})
})
