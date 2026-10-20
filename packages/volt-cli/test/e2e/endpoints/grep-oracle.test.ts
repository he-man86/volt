/**
 * grep — a DIFFERENTIAL ORACLE: the bridge's `grep` against a second, deliberately simple implementation of the spec
 * (openspec `changes/archive/2026-10-20-grep-item-sources`) run here over the text `fetch` ships.
 *
 * <p>`grep.test.ts` proves each rule on an item it creates. This file proves the WHOLE answer on whatever project the
 * cell serves — a fixture or a customer corpus — and it is READ-ONLY: it creates, pushes and builds nothing, so it may
 * run against a copy of a customer project. Its `fetch` is directed (`onlyItems`, every non-library item `refs` names)
 * so no library signature extraction runs (on CODESYS that is a build).</p>
 *
 * <p>The oracle shares no code with the bridge. It splits each fetched `sourceText` into lines (1-based, the line
 * ending removed, a final line ending closing the last line rather than opening an empty one), matches each line with
 * a JS regular expression (`u`, plus `i` unless case-sensitive; a literal is escaped first), cuts a line's text at 500
 * characters with `…`, and selects items with its own path-glob matcher (segment by segment: `**` zero or more
 * segments, `*` within a segment, `?` one character, ignoring case). It orders by ordinal path then line, counts to the
 * 10,000 stop, and answers the same members the bridge does. The two must agree EXACTLY.</p>
 *
 * <p>JS and .NET regular expressions are not one dialect. The patterns below avoid where they differ: no `\w`/`\b`
 * (ASCII in JS, Unicode in .NET), no lookbehind or inline options. Two residual differences are accepted and named:
 * `\s` (JS also matches U+FEFF, .NET also U+0085) in `^\s*END_`, and `.` (JS does not match a lone CR, U+2028 or
 * U+2029) in the cap case — a mismatch there must be read against those before it is called a bridge bug. Case
 * folding: JS `iu` uses Unicode simple case folding, .NET invariant IgnoreCase its own table; they agree on ASCII and
 * on Latin letters such as `Ä`/`ä`, which is all the derived identifiers use.</p>
 *
 * <pre>
 *   powershell -File scripts/ide.ps1 up -Vendor codesys -Instance go-cs -Fixture test/fixtures/CodesysTestProject.3.5.21.40.project -Wait
 *   VOLT_E2E_INSTANCE=go-cs VOLT_VENDOR=codesys VOLT_GRAPHICAL=1 bun test test/e2e/endpoints/grep-oracle.test.ts
 * </pre>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"
import { itemVersion } from "../lib/versions"
import { derivePatterns, differences, isLibrary, LIMIT_MAX, oracle, type Project } from "../lib/grep-oracle"

// ── the test ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe(`endpoints / grep oracle (${BASE})`, () => {
	setDefaultTimeout(3_600_000)
	let refs: any, health: any
	let project: Project
	let fetchMs = 0

	beforeAll(async () => {
		await requireHealthy()
		health = await bridge.health()
		refs = await bridge.refs()
		const want = Object.keys(refs.items).filter((p) => !isLibrary(p))
		const t0 = performance.now()
		const fetched = await bridge.fetch({ onlyItems: want })
		fetchMs = Math.round(performance.now() - t0)
		const byName = new Map<string, any>(fetched.changed.map((c: any) => [c.name, c]))
		project = {
			items: want.filter((p) => byName.has(p)).map((p) => {
				const c = byName.get(p)
				return { path: p, version: refs.items[p], text: c.sourceText, unsupported: c.unsupported ?? null }
			}),
			unreadable: refs.unreadable ?? [],
			unwalkedFolders: refs.unwalkedFolders ?? [],
		}
	})

	it("STOP GATE: every fetched sourceText hashes to its refs version", () => {
		const fetchedPaths = new Set(project.items.map((i) => i.path))
		const differing = Object.keys(refs.items).filter((p) => !isLibrary(p)).flatMap((p) => {
			if (!fetchedPaths.has(p)) return [`${p}: refs names it, fetch shipped no text`]
			const item = project.items.find((i) => i.path === p)!
			return itemVersion(p, item.text) === refs.items[p] ? [] : [`${p}: sourceText does not hash to the refs version ${refs.items[p]}`]
		})
		console.log(`[grep oracle] ${project.items.length} items fetched in ${fetchMs}ms; ${differing.length} differing`)
		for (const d of differing.slice(0, 10)) console.log(`  ${d}`)
		const all = oracle(project, { pattern: "x" }).notSearched
		console.log(`[grep oracle] fetch marks ${all.unreadable.length} unreadable, ${all.hidden.length} with an UNSUPPORTED body` +
			` (${[...new Set(all.hidden.flatMap((h) => h.langs))].join(", ")}); networkText ${health.networkText}`)
		expect(differing).toEqual([])
		expect(project.items.length).toBeGreaterThan(0)
	})

	it("every pattern: the bridge's grep answers exactly what the oracle computes", async () => {
		const cases = derivePatterns(project, health, refs)
		const failed: string[] = []
		const rows: string[] = []
		for (const c of cases) {
			const t0 = performance.now()
			const got = await bridge.grep(c.req)
			const ms = Math.round(performance.now() - t0)
			const want = oracle(project, c.req)
			const diffs = differences(got, want)
			if (c.cap && !want.truncated) rows.push(`  (the cap case did not reach the limit: ${want.totalMatches} matches)`)
			if (!c.cap && want.totalMatches > LIMIT_MAX) rows.push(`  (${c.label} exceeds the limit: ${want.totalMatches} matches)`)
			rows.push(`${diffs.length ? "FAIL" : "ok  "} ${c.label.padEnd(38)} ${JSON.stringify(c.req).slice(0, 90).padEnd(90)} ` +
				`searched ${got.searched} total ${got.totalMatches}${got.truncated ? " (truncated)" : ""} notSearched ${got.notSearched?.length} ${ms}ms`)
			if (diffs.length) {
				failed.push(c.label)
				for (const d of diffs.slice(0, 10)) rows.push(`       ${d}`)
				if (diffs.length > 10) rows.push(`       … ${diffs.length - 10} more`)
			}
		}
		console.log(`[grep oracle] ${cases.length} patterns over ${project.items.length} items:\n${rows.join("\n")}`)
		expect(failed).toEqual([])
	})
})
