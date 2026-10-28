/**
 * THE GREP ORACLE — a second, deliberately simple implementation of the `grep` op's spec (openspec
 * `changes/archive/2026-10-20-grep-item-sources`), over the text `fetch` ships. It shares no code with the bridge
 * (`Volt.Engine/Sync/GrepService.cs`): the e2e `endpoints/grep-oracle.test.ts` compares the two answers exactly, and
 * `test/unit/grep-oracle.test.ts` pins the oracle's own reading of the spec offline. See the e2e file for the rules
 * and for where JS and .NET regular expressions are known to differ.
 */
// ── the spec's constants ─────────────────────────────────────────────────────────────────────────────────────────

export const LIMIT_MAX = 1000
const COUNT_CAP = 10_000
const TEXT_CAP = 500

export type Req = { pattern: string; literal?: boolean; caseSensitive?: boolean; paths?: string[]; limit?: number }
export type Match = { name: string; line: number; text: string }
export type Item = { path: string; version: string; text: string; unsupported: any[] | null }
export type Project = {
	items: Item[] // every non-library item refs names, with its fetched text, in no particular order
	unreadable: { name: string; reason: string }[]
	unwalkedFolders: string[]
}

// ── the oracle ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The text's lines: split at LF, a trailing CR removed from each; a text that ends in a line ending has no empty
 *  line after it, and the empty text has none. */
export function lines(text: string): string[] {
	if (text === "") return []
	const out = text.split("\n")
	if (out[out.length - 1] === "") out.pop()
	return out.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
}

/** Cut at 500 characters with `…` — never inside a surrogate pair (that half is not a character). */
export function cut(text: string): string {
	if (text.length <= TEXT_CAP) return text
	const code = text.charCodeAt(TEXT_CAP - 1)
	const keep = code >= 0xd800 && code <= 0xdbff ? TEXT_CAP - 1 : TEXT_CAP
	return text.slice(0, keep) + "…"
}

const SYNTAX = /[\\^$.*+?()[\]{}|/]/g
export function matcher(req: Req): RegExp {
	const source = req.literal ? req.pattern.replace(SYNTAX, "\\$&") : req.pattern
	return new RegExp(source, req.caseSensitive ? "u" : "iu")
}

/** One path glob against one path, ignoring case, segment by segment. */
export function globMatch(glob: string, path: string): boolean {
	const g = glob.split("/"), p = path.split("/")
	const seg = (gs: string, ps: string): boolean => {
		const a = [...gs.toLowerCase()], b = [...ps.toLowerCase()]
		const go = (i: number, j: number): boolean => {
			if (i === a.length) return j === b.length
			if (a[i] === "*") {
				for (let k = j; k <= b.length; k++) if (go(i + 1, k)) return true
				return false
			}
			if (j === b.length) return false
			return (a[i] === "?" || a[i] === b[j]) && go(i + 1, j + 1)
		}
		return go(0, 0)
	}
	const walk = (i: number, j: number): boolean => {
		if (i === g.length) return j === p.length
		if (g[i] === "**") {
			for (let k = j; k <= p.length; k++) if (walk(i + 1, k)) return true
			return false
		}
		return j < p.length && seg(g[i], p[j]) && walk(i + 1, j + 1)
	}
	return walk(0, 0)
}

const inScope = (req: Req, path: string) => req.paths === undefined || req.paths.some((g) => globMatch(g, path))
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const UNSUPPORTED = /^%LANGUAGE (\S+) UNSUPPORTED$/

export function oracle(project: Project, req: Req) {
	const re = matcher(req)
	const limit = req.limit ?? 200
	const candidates = project.items.filter((it) => inScope(req, it.path)).sort((a, b) => ordinal(a.path, b.path))
	const matches: Match[] = []
	const items: Record<string, string> = {}
	let searched = 0, totalMatches = 0
	outer: for (const it of candidates) {
		if (totalMatches >= COUNT_CAP) break
		searched++
		const ls = lines(it.text)
		for (let n = 0; n < ls.length; n++) {
			if (!re.test(ls[n])) continue
			totalMatches++
			if (matches.length < limit) {
				matches.push({ name: it.path, line: n + 1, text: cut(ls[n]) })
				items[it.path] = it.version
			}
			if (totalMatches >= COUNT_CAP) break outer
		}
	}
	// What is not searched, as fetch states it: every unreadable item in scope with refs' reason, and every item in
	// scope whose fetched text holds a body line `%LANGUAGE <LANG> UNSUPPORTED` (the bridge's reason wording is its
	// own, so the oracle states which languages, how many, and fetch's `unsupported` facts it must carry).
	const hidden = candidates
		.map((it) => ({ name: it.path, langs: lines(it.text).flatMap((l) => UNSUPPORTED.exec(l)?.[1] ?? []), unsupported: it.unsupported ?? [] }))
		.filter((h) => h.langs.length > 0)
	const unreadable = project.unreadable.filter((u) => !isLibrary(u.name) && inScope(req, u.name))
	return {
		matches, items, searched, totalMatches, truncated: totalMatches > matches.length,
		notSearched: { unreadable, hidden },
		unwalkedFolders: project.unwalkedFolders,
	}
}

export const isLibrary = (path: string) => path.toLowerCase().endsWith(".library")

/** Every difference between the bridge's answer and the oracle's, as lines a reader can act on. */
export function differences(got: any, want: ReturnType<typeof oracle>): string[] {
	const d: string[] = []
	const key = (m: Match) => `${m.name}:${m.line}`
	const gm: Match[] = got.matches ?? []
	for (let i = 0; i < Math.max(gm.length, want.matches.length); i++) {
		const a = gm[i], b = want.matches[i]
		if (a && b && a.name === b.name && a.line === b.line && a.text === b.text) continue
		d.push(`match #${i}: bridge ${a ? `${key(a)} ${JSON.stringify(a.text)}` : "(none)"} | oracle ${b ? `${key(b)} ${JSON.stringify(b.text)}` : "(none)"}`)
	}
	for (const f of ["searched", "totalMatches", "truncated"] as const)
		if (got[f] !== want[f]) d.push(`${f}: bridge ${got[f]} | oracle ${want[f]}`)
	const gi: Record<string, string> = got.items ?? {}
	for (const p of new Set([...Object.keys(gi), ...Object.keys(want.items)]))
		if (gi[p] !== want.items[p]) d.push(`items[${p}]: bridge ${gi[p]} | oracle (refs) ${want.items[p]}`)
	if (JSON.stringify(got.unwalkedFolders) !== JSON.stringify(want.unwalkedFolders))
		d.push(`unwalkedFolders: bridge ${JSON.stringify(got.unwalkedFolders)} | refs ${JSON.stringify(want.unwalkedFolders)}`)

	const ns: { name: string; reason: string }[] = got.notSearched ?? []
	const names = ns.map((n) => n.name)
	if (JSON.stringify(names) !== JSON.stringify([...names].sort(ordinal))) d.push(`notSearched: not in ordinal name order`)
	if (new Set(names).size !== names.length) d.push(`notSearched: a name appears twice`)
	const byName = new Map(ns.map((n) => [n.name, n.reason]))
	const expected = new Set<string>()
	for (const u of want.notSearched.unreadable) {
		expected.add(u.name)
		if (byName.get(u.name) !== u.reason) d.push(`notSearched[${u.name}] (unreadable): bridge ${JSON.stringify(byName.get(u.name))} | refs ${JSON.stringify(u.reason)}`)
	}
	for (const h of want.notSearched.hidden) {
		expected.add(h.name)
		const reason = byName.get(h.name)
		if (reason === undefined) { d.push(`notSearched[${h.name}]: missing; fetch shows ${h.langs.map((l) => `%LANGUAGE ${l} UNSUPPORTED`).join(", ")}`); continue }
		const count = (s: string) => reason.split(s).length - 1
		for (const lang of new Set(h.langs)) {
			const s = `%LANGUAGE ${lang} UNSUPPORTED`
			const n = h.langs.filter((l) => l === lang).length
			if (count(s) !== n) d.push(`notSearched[${h.name}]: names '${s}' ${count(s)}× | fetch has ${n}: ${JSON.stringify(reason)}`)
		}
		for (const u of h.unsupported) {
			if (u.member && !reason.includes(`'${u.member}'`)) d.push(`notSearched[${h.name}]: reason lacks member '${u.member}' fetch names: ${JSON.stringify(reason)}`)
			if (u.reason && !reason.includes(u.reason)) d.push(`notSearched[${h.name}]: reason lacks fetch's '${u.reason}': ${JSON.stringify(reason)}`)
		}
	}
	for (const n of names) if (!expected.has(n)) d.push(`notSearched[${n}]: the bridge names it, fetch ships its whole text: ${JSON.stringify(byName.get(n))}`)
	return d
}

// ── the patterns, derived from the project ───────────────────────────────────────────────────────────────────────

/** Words that are IEC 61131-3 syntax, not identifiers — kept out of the "most frequent identifier" picks. */
const KEYWORDS = new Set(
	("ABSTRACT ACTION AND ARRAY AT BOOL BY BYTE CASE CONSTANT CONTINUE DATE DINT DO DT DWORD ELSE ELSIF END_ACTION END_CASE " +
		"END_FOR END_FUNCTION END_FUNCTION_BLOCK END_IF END_INTERFACE END_METHOD END_PROGRAM END_PROPERTY END_REPEAT " +
		"END_STRUCT END_TYPE END_UNION END_VAR END_WHILE EXIT EXTENDS FALSE FINAL FOR FUNCTION FUNCTION_BLOCK GET IF " +
		"IMPLEMENTATION IMPLEMENTS INT INTERFACE INTERNAL LINT LREAL LWORD METHOD MOD NOT OF OR PERSISTENT POINTER PRIVATE " +
		"PROGRAM PROPERTY PROTECTED PUBLIC REAL REFERENCE REPEAT RETAIN RETURN SET SINT STRING STRUCT SUPER THEN THIS TIME TO " +
		"TOD TRUE TYPE UDINT UINT ULINT UNION UNTIL USINT VAR VAR_CONFIG VAR_EXTERNAL VAR_GLOBAL VAR_INPUT VAR_IN_OUT VAR_INST " +
		"VAR_OUTPUT VAR_STAT VAR_TEMP WHILE WORD WSTRING XOR NETWORK WIRES EXECUTE END_EXECUTE DISABLED UNSUPPORTED LD FBD ST attribute").toUpperCase().split(" "),
)

export type Case = { label: string; req: Req; cap?: true }

export function derivePatterns(project: Project, health: any, refs: any): Case[] {
	// Each pick is bounded in how many candidates it tries, since every try is a whole oracle pass.
	const texts = [...project.items].sort((a, b) => ordinal(a.path, b.path)).map((i) => i.text)
	const freq = new Map<string, number>()
	for (const t of texts) for (const w of t.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) if (!KEYWORDS.has(w.toUpperCase())) freq.set(w, (freq.get(w) ?? 0) + 1)
	const hits = (req: Req) => oracle(project, { ...req, limit: LIMIT_MAX }).totalMatches
	// The most frequent identifiers whose answer stays under the limit (their substrings match too, so the line count is
	// what is bounded, not the word count).
	const frequent: string[] = []
	for (const [w] of [...freq].sort((a, b) => b[1] - a[1] || ordinal(a[0], b[0])).slice(0, 300)) {
		if (frequent.length === 3) break
		if (frequent.some((f) => f.toLowerCase() === w.toLowerCase())) continue
		const n = hits({ pattern: w })
		if (n > 0 && n <= LIMIT_MAX) frequent.push(w)
	}
	const rare = [...freq].filter(([w, n]) => n === 1 && w.length >= 6).map(([w]) => w).sort(ordinal).slice(0, 100).find((w) => hits({ pattern: w }) === 1)
	const fbType = texts.map((t) => /^\s*FUNCTION_BLOCK\s+(?:(?:ABSTRACT|FINAL|PUBLIC|INTERNAL)\s+)*([A-Za-z_][A-Za-z0-9_]*)/m.exec(t)?.[1]).find((n) => n && hits({ pattern: n }) <= LIMIT_MAX)
	const firstIn = (re: RegExp, fallback: string) => {
		for (const t of texts.slice(0, 200)) { const m = re.exec(t); if (m && hits({ pattern: m[0], literal: true }) <= LIMIT_MAX) return m[0] }
		return fallback
	}
	const call = firstIn(/[A-Za-z_][A-Za-z0-9_]*\(/, "zzz_no_call(")
	const member = firstIn(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/, "zzz.no_member")
	const index = firstIn(/[A-Za-z_][A-Za-z0-9_]*\[/, "zzz_no_index[")
	const id = frequent[0] ?? "zzz_none"
	// Case variants are only telling on an identifier that HAS case: the first frequent one mixing both.
	const mixed = frequent.find((w) => w !== w.toUpperCase() && w !== w.toLowerCase()) ?? id
	const swapped = [...mixed].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("")

	const paths = Object.keys(refs.items)
	const root: string | undefined = refs.applications?.[0]
	const escaped = paths.flatMap((p) => p.split("/").slice(0, -1)).find((s) => /%2F/i.test(s))
	const pou = paths.find((p) => /\/[^/]{3,}\.pou$/i.test(p))
	const qGlob = pou ? `**/${pou.slice(pou.lastIndexOf("/") + 1).replace(/^(.)./, "$1?")}` : "**/?"

	const cases: Case[] = [
		...frequent.map((w, i) => ({ label: `frequent identifier #${i + 1}`, req: { pattern: w } })),
		{ label: "rare identifier", req: { pattern: rare ?? "zzz_rare_none" } },
		{ label: "declared FB type", req: { pattern: fbType ?? "zzz_no_fb" } },
		{ label: "literal call `(`", req: { pattern: call, literal: true } },
		{ label: "literal member `.`", req: { pattern: member, literal: true } },
		{ label: "literal index `[`", req: { pattern: index, literal: true } },
		{ label: "case: UPPER", req: { pattern: mixed.toUpperCase() } },
		{ label: "case: lower", req: { pattern: mixed.toLowerCase() } },
		{ label: "case: exact, caseSensitive", req: { pattern: mixed, caseSensitive: true } },
		{ label: "case: swapped, caseSensitive", req: { pattern: swapped, caseSensitive: true } },
		{ label: "case: swapped literal, caseSensitive", req: { pattern: swapped, literal: true, caseSensitive: true } },
		{ label: "anchored ^\\s*END_", req: { pattern: "^\\s*END_" } },
		{ label: "long lines .{501} (the 500 cut)", req: { pattern: ".{501}" } },
		{ label: "glob **/*.gvl", req: { pattern: id, paths: ["**/*.gvl"] } },
		{ label: "glob ? in a file name", req: { pattern: id, paths: [qGlob] } },
		{ label: "glob matching nothing", req: { pattern: id, paths: ["**/zzz_no_such_*.pou"] } },
		{ label: "two globs, either matches", req: { pattern: id, paths: ["**/*.gvl", "**/*.dut"] } },
	]
	if (root) cases.push({ label: "glob one application root", req: { pattern: id, paths: [`${root}/**`] } })
	if (escaped) cases.push({ label: "glob a %2F folder", req: { pattern: id, paths: [`**/${escaped}/**`] } })
	if (health.languages?.includes("LD") && health.languages?.includes("FBD")) {
		cases.push({ label: "network text %LANGUAGE LD", req: { pattern: "%LANGUAGE LD", literal: true, caseSensitive: true } })
		cases.push({ label: "network text %LANGUAGE FBD", req: { pattern: "%LANGUAGE FBD", literal: true, caseSensitive: true } })
	}
	cases.push({ label: "CAP: `.` at limit 1000", req: { pattern: "." }, cap: true })
	cases.push({ label: "CAP: `;` at limit 7", req: { pattern: ";", literal: true, limit: 7 }, cap: true })
	for (const c of cases) c.req.limit ??= LIMIT_MAX
	return cases
}
