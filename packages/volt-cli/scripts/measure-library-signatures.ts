/**
 * WHAT A DIRECTED `.library` READ ANSWERS TODAY, AND WHAT THE EXTRACTION IT WOULD NEED COSTS
 * (openspec `directed-library-signatures` tasks 1.1 / 1.2). Measures; changes nothing in the product.
 *
 * <p>1.1 — `fetch { onlyItems: ["Standard, <ver> (System).library"] }`: the answer as it stands (expected: the manifest
 * alone). Then, from a full fetch, every signature folded under `(unresolved)` beside the RESOLUTION of each wildcard
 * ref — on CODESYS with the RAW `LibraryPath` strings, read in the IDE by `probe-library-signature-cost.py`
 * (`libpaths`), exactly as `CodesysObjectModel.ExtractLibrarySignatures` reads them.</p>
 *
 * <p>1.2 — times, over the pipe, as a client sees them:</p>
 * <ul>
 *   <li>the directed `.library` read #0 runs FIRST: since directed-library-signatures 3.1 it does the session's first
 *       extraction itself (on CODESYS: `Build(app)`), so IT is the cold figure;</li>
 *   <li>`init` #1: a full fetch WITH `librariesRefreshed` (its own extraction, not the session cache), after directed
 *       #0's build — so not cold (on CODESYS the message view says "The application is up to date");</li>
 *   <li>`init` #2..#4: the same, WARM;</li>
 *   <li>`known` fetch: a full fetch whose `knownItems` are the live versions — `librariesRefreshed` false, so no
 *       extraction: the walk-only floor. extraction ≈ init − known;</li>
 *   <li>directed `.library` reads after a full fetch (answered from the session cache it Stored);</li>
 *   <li>CODESYS only (R2): edit one ST POU through scripting (what typing in the editor does), then a directed read,
 *       a `known` fetch, and an `init` — the extraction AFTER AN EDIT — with the IDE's message view counted before and
 *       after each, and the precompiled library set counted right after the edit (does an app edit discard it?).</li>
 *   <li>2.3: two directed reads of DIFFERENT libraries in a row, each checked against the full fetch's folder;</li>
 *   <li>4.1 / 4.3 (MEASURE_PARITY=1): every name `refs` publishes read on its own, compared with the full fetch, tallied
 *       per extension — the snapshot the verify steps re-run once the route is built.</li>
 * </ul>
 *
 * Run against YOUR OWN bridge:
 *   pwsh scripts/ide.ps1 up -Vendor codesys -Instance directed-library-signatures -RunScript scripts/probe-library-signature-cost.py [-Fixture <.project>] -Wait
 *   VOLT_E2E_INSTANCE=directed-library-signatures [MEASURE_SETTLE_MS=60000] bun run scripts/measure-library-signatures.ts <label> > scripts/library-signature-cost-<label>.log
 *   pwsh scripts/ide.ps1 down -Vendor codesys -Instance directed-library-signatures
 *   (TwinCAT: `-Vendor twincat -Fixture 13|14`, no -RunScript, VOLT_VENDOR=twincat here; no probe, no edit step.)
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { callOn } from "../test/e2e/lib/pipe"
import { scriptPipe, vendorOf } from "../test/e2e/lib/fixture-ide"

const VENDOR = vendorOf(process.env.VOLT_VENDOR)
const PIPE: string = scriptPipe(VENDOR)
const PID = Number(PIPE.split(".").pop())
const CALL_TIMEOUT_MS = 20 * 60_000
const PROBE_TIMEOUT_MS = 10 * 60_000
const LIB_ROOT = "Library Manager"
const UNRESOLVED = "(unresolved)"

const out = (s = "") => console.log(s)

async function call(op: string, body?: unknown): Promise<any> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${op} timed out after ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS)
	})
	try {
		return await Promise.race([callOn(PIPE, op, body), timeout])
	} finally {
		clearTimeout(timer)
	}
}

async function timed(label: string, op: string, body?: unknown): Promise<{ ms: number; res: any }> {
	const t0 = performance.now()
	const res = await call(op, body)
	const ms = Math.round(performance.now() - t0)
	return { ms, res }
}

// ── the in-IDE probe (CODESYS) ─────────────────────────────────────────────────────────────────────────────────
const PROBE_DIR = join(process.env.LOCALAPPDATA ?? "", "volt-bridge", "libsig-probe", String(PID))
let rid = 0
async function probe(cmd: string, arg = ""): Promise<string[]> {
	if (!existsSync(PROBE_DIR)) throw new Error(`no probe answers for pid ${PID} (${PROBE_DIR}) - was the IDE started with -RunScript probe-library-signature-cost.py?`)
	const id = `r${Date.now()}_${++rid}`
	writeFileSync(join(PROBE_DIR, "request"), `${id}|${cmd}|${arg}`)
	const deadline = Date.now() + PROBE_TIMEOUT_MS
	while (Date.now() < deadline) {
		if (existsSync(join(PROBE_DIR, `${id}.error`))) throw new Error(`probe ${cmd}: ${readFileSync(join(PROBE_DIR, `${id}.error`), "utf8")}`)
		if (existsSync(join(PROBE_DIR, `${id}.done`))) {
			const text = readFileSync(join(PROBE_DIR, `${id}.out`), "utf8")
			for (const f of [`${id}.done`, `${id}.out`]) rmSync(join(PROBE_DIR, f), { force: true })
			return text.split(/\r?\n/).filter((l) => l.length > 0)
		}
		await Bun.sleep(100)
	}
	throw new Error(`probe ${cmd} unanswered after ${PROBE_TIMEOUT_MS} ms`)
}

/** Category → its block ("<count>" + the last texts), from `messages`. A build REPLACES its category's messages, so
 *  a count alone cannot say whether a build ran: the block's text can ("Typify code..." vs "The application is up to
 *  date"). */
function messageBlocks(lines: string[]): Map<string, string> {
	const m = new Map<string, string>()
	let cat = ""
	for (const l of lines) {
		if (!l.startsWith("    ")) {
			const [c, n] = l.split("\t")
			cat = c
			m.set(cat, `count ${n}`)
		} else m.set(cat, `${m.get(cat)}\n${l}`)
	}
	return m
}

/** Print the message view, and for every category whose block CHANGED since `prev`, its texts. */
async function messages(label: string, prev?: Map<string, string>): Promise<Map<string, string>> {
	const now = messageBlocks(await probe("messages"))
	const changed = [...now].filter(([c, b]) => prev?.get(c) !== b)
	out(`  messages ${label}: ${[...now].map(([c, b]) => `${c}=${b.split("\n")[0].slice(6)}`).join(", ")}; changed: ${changed.length ? changed.map(([c]) => c).join(", ") : "none"}`)
	for (const [c, b] of changed) if (prev) for (const l of [c, ...b.split("\n").slice(1)]) out(`      ${l.trim()}`)
	return now
}

// ── fetch helpers ────────────────────────────────────────────────────────────────────────────────────────────
type Item = { name: string; folder?: string; sourceText: string; version: string }

// A library SIGNATURE is the one item kind a fetch returns without tracking it: it is never in `items` (archived
// cache-library-signatures). That holds on both vendors, whatever the library root is called (CODESYS "Library
// Manager", TwinCAT "References").
const isLibFile = (it: Item, items: Record<string, string>) => !(it.name in items)
const resolutionOf = (it: Item) => /^RESOLUTION (.+)$/m.exec(it.sourceText)?.[1]?.trim()

/** A directed answer for `name` against the full fetch `full`: SAME when it carries exactly the items the full fetch
 *  writes for it (folder, name, version, text) — for a `.library`, everything in its folder (its signatures).
 *  <p>AMBIGUOUS: a full name that lives in TWO folders (the 13 `System_Visu*` refs on Pro2193, tasks.md 1.1) has no
 *  single expectation. The init cannot show it — FetchService dedupes `changed` by full name, so `full` holds each name
 *  once — so the caller passes `twoFolders`: the names a `knownItems` fetch re-sends from a folder the init did not
 *  answer them from (the measured symptom of the second copy).</p>
 *  <p>EMPTY: a `.library` whose full-fetch folder holds the manifest alone and whose directed answer is the same — equal
 *  only because both carry no signature (a wildcard ref the exact join misses, a facade), which is not parity.</p> */
function parity(full: Item[], name: string, directed: Item[], twoFolders: Map<string, string>): string {
	const key = (i: Item) => `${i.folder}|${i.name}|${i.version}|${i.sourceText}`
	const own = full.filter((i) => i.name === name)
	if (own.length !== 1) return `AMBIGUOUS full fetch answers ${JSON.stringify(name)} ${own.length} times`
	const second = twoFolders.get(name)
	if (second !== undefined)
		return `AMBIGUOUS ${JSON.stringify(name)} lives in two folders (init ${JSON.stringify(own[0].folder)}, known fetch ${JSON.stringify(second)})`
	const expected = (name.endsWith(".library") ? full.filter((i) => i.folder === own[0].folder) : own).map(key).sort()
	const got = directed.map(key).sort()
	const missing = expected.filter((k) => !got.includes(k)).length
	const extra = got.filter((k) => !expected.includes(k)).length
	if (missing === 0 && extra === 0 && name.endsWith(".library") && expected.length === 1)
		return `EMPTY (manifest alone in both answers)`
	return missing === 0 && extra === 0
		? `SAME (${got.length} items)`
		: `DIFFERS (expected ${expected.length}, got ${got.length}: ${missing} missing, ${extra} extra)`
}

function describeFetch(label: string, ms: number, res: any) {
	const changed: Item[] = res.changed ?? []
	const libs = changed.filter((i) => i.name.endsWith(".library"))
	const sigs = changed.filter((i) => isLibFile(i, res.items ?? {}))
	const unresolved = sigs.filter((i) => (i.folder ?? "").includes(UNRESOLVED))
	out(
		`  ${label}: ${ms} ms  librariesRefreshed=${res.librariesRefreshed}  changed=${changed.length}  ` +
			`.library=${libs.length}  signatures=${sigs.length}  under (unresolved)=${unresolved.length}  items=${Object.keys(res.items ?? {}).length}`,
	)
}

async function main() {
	const label = process.argv[2] ?? VENDOR
	out(`== library-signature cost — ${label} — ${VENDOR} — pipe ${PIPE} — ${new Date().toISOString()}`)
	const withProbe = VENDOR === "codesys"

	let msg: Map<string, string> | undefined
	if (withProbe) {
		msg = await messages("after open")
		const before = await probe("libpaths")
		out(`  precompiled library signatures BEFORE any build: ${before[0]}`)
		// The set at open is not the same every launch (0 on one launch of the fixture, 813 on the next two, no build
		// in between), so sample it again after a settle, to tell a background precompile from a cached one.
		const settle = Number(process.env.MEASURE_SETTLE_MS ?? 0)
		if (settle > 0) {
			await Bun.sleep(settle)
			out(`  precompiled library signatures after ${settle} ms idle, still no build: ${(await probe("libpaths"))[0]}`)
		}
	}

	const r = await timed("refs", "refs")
	out(`  refs: ${r.ms} ms  items=${Object.keys(r.res.items).length}`)
	const libNames = Object.keys(r.res.items).filter((n) => n.endsWith(".library"))
	const std = libNames.filter((n) => /^(Tc2_)?Standard(\.library$|[ ,])/i.test(n))
	out(`  .library refs: ${libNames.length}; Standard: ${JSON.stringify(std)}`)
	if (std.length !== 1) throw new Error(`expected ONE Standard library ref, found ${std.length}: ${JSON.stringify(std)}`)
	const STD = std[0]

	// 1.1 — the directed read, before ANY extraction this session.
	out(`\n-- 1.1 directed read of ${STD} (cold session, before any extraction)`)
	const d0 = await timed("directed", "fetch", { knownItems: {}, onlyItems: [STD] })
	describeFetch("directed #0", d0.ms, d0.res)
	// The manifest and TON in full (4.1: TON's pins must be in the directed answer); every other item by name.
	for (const it of d0.res.changed as Item[]) {
		out(`  item ${JSON.stringify(it.name)} folder=${JSON.stringify(it.folder)} chars=${it.sourceText.length}`)
		if (it.name.endsWith(".library") || /^TON\./.test(it.name)) for (const l of it.sourceText.split("\n")) out(`    | ${l}`)
	}
	const tonD0 = (d0.res.changed as Item[]).filter((i) => /^TON\./.test(i.name))
	out(`  4.1 TON in the directed answer: ${tonD0.length ? tonD0.map((t) => `${t.name} @ ${JSON.stringify(t.folder)}`).join(", ") : "ABSENT"}`)
	if (withProbe) msg = await messages("after directed #0", msg)

	// 1.2 — the first full fetch with librariesRefreshed. Directed #0 already did the session's first (cold) extraction,
	// so this one is not cold (on CODESYS its build answers "The application is up to date").
	out(`\n-- 1.2 full fetches`)
	const i1 = await timed("init", "fetch", { init: true })
	describeFetch("init #1 (first full fetch, after directed #0's cold extraction)", i1.ms, i1.res)
	if (withProbe) msg = await messages("after init #1", msg)
	// 4.1 — directed #0 against init #1: the ONE comparison of two INDEPENDENT extractions. Every later directed read
	// is answered from the session cache a full fetch Stored (FetchService: librariesRefreshed → Store, a directed read
	// → Reuse), so its parity shows only that the directed and the full answer split ONE extraction the same way.
	// Directed #0 extracted on its own (nothing was cached yet); init #1 extracted again and Stored.
	out(`  4.1 directed #0 (own cold extraction) vs init #1 (own extraction): ${parity(i1.res.changed as Item[], STD, d0.res.changed as Item[], new Map())}`)

	// R1 — RESOLUTIONs of the refs, and the (unresolved) folders.
	const all: Item[] = i1.res.changed
	const manifests = all.filter((i) => i.name.endsWith(".library"))
	const resolutions = manifests.map((m) => ({ name: m.name, res: resolutionOf(m) ?? "" }))
	const wild = resolutions.filter((x) => /, \*/.test(x.res))
	out(`\n-- R1 refs: ${resolutions.length}, wildcard RESOLUTIONs: ${wild.length}`)
	for (const w of wild) out(`  wildcard ref ${JSON.stringify(w.name)}  RESOLUTION ${JSON.stringify(w.res)}`)
	const unresFolders = new Map<string, number>()
	for (const s of all.filter((s) => isLibFile(s, i1.res.items))) if ((s.folder ?? "").includes(UNRESOLVED)) unresFolders.set(s.folder!, (unresFolders.get(s.folder!) ?? 0) + 1)
	out(`  (unresolved) folders: ${unresFolders.size}`)
	for (const [f, n] of [...unresFolders].sort(([a], [b]) => a.localeCompare(b))) out(`    ${n}\t${f}`)
	const emptyRefs = manifests.filter((m) => !all.some((s) => isLibFile(s, i1.res.items) && s.folder === m.folder))
	out(`  refs whose folder holds no signature: ${emptyRefs.length}`)
	for (const m of emptyRefs) out(`    empty ${JSON.stringify(m.name)}  RESOLUTION ${JSON.stringify(resolutionOf(m))}`)

	if (withProbe) {
		const paths = await probe("libpaths")
		out(`\n-- R1 raw LibraryPath (AllPrecompiledSignatures after the build): ${paths[0]}`)
		const exact = new Set(resolutions.map((x) => x.res.toLowerCase()))
		const rows = paths.slice(1).map((l) => {
			const [n, ...rest] = l.split("\t")
			return { n: Number(n), path: rest.join("\t") }
		})
		const unmatched = rows.filter((x) => !exact.has(x.path.toLowerCase()))
		out(`  distinct LibraryPaths: ${rows.length}; matching a RESOLUTION exactly: ${rows.length - unmatched.length}; matching none: ${unmatched.length} (${unmatched.reduce((a, x) => a + x.n, 0)} signatures)`)
		for (const u of unmatched) out(`    UNMATCHED ${u.n}\t${JSON.stringify(u.path)}`)
		out(`  matched:`)
		for (const m of rows.filter((x) => exact.has(x.path.toLowerCase()))) out(`    matched ${m.n}\t${JSON.stringify(m.path)}`)
		// The wildcard rule R1 proposes, tried on the recorded strings: title (before the first comma) and company
		// (the last parenthesis) compared case-insensitively. Printed per ref so the comparison is visible, not inferred.
		const parts = (s: string) => {
			const m = /^(.*?),\s*(.*?)\s*\(([^()]*)\)\s*$/.exec(s.trim())
			return m ? { title: m[1].trim().toLowerCase(), version: m[2].trim(), company: m[3].trim().toLowerCase() } : undefined
		}
		out(`  wildcard pairing (title + company, case-insensitive):`)
		for (const w of wild) {
			const wp = parts(w.res)
			const hits = rows.filter((x) => {
				const p = parts(x.path)
				return p && wp && p.title === wp.title && p.company === wp.company
			})
			const titleOnly = rows.filter((x) => parts(x.path)?.title === wp?.title)
			out(`    ${JSON.stringify(w.res)} -> ${hits.length ? hits.map((h) => `${JSON.stringify(h.path)} (${h.n})`).join(", ") : "NONE"}` +
				(titleOnly.length !== hits.length ? `  [title-only: ${titleOnly.length}]` : ""))
		}
		// The SAME rule as the pairing above (title AND company), so the count left for the facade split is the rule's.
		const wildMatches = (w: { res: string }, path: string) => {
			const p = parts(path)
			const wp = parts(w.res)
			return !!p && !!wp && p.title === wp.title && p.company === wp.company
		}
		const claimed = new Set(wild.flatMap((w) => rows.filter((x) => wildMatches(w, x.path)).map((x) => x.path)))
		const still = unmatched.filter((u) => !claimed.has(u.path))
		out(`  matching neither exactly nor by the wildcard rule: ${still.length} paths (${still.reduce((a, x) => a + x.n, 0)} signatures)`)
		for (const u of still) out(`    ${u.n}\t${JSON.stringify(u.path)}`)
		// Every path against EVERY ref — exact RESOLUTION (case-insensitive, as the engine's LibraryMatcher compares) or the
		// wildcard rule — so a path two refs claim is printed, whichever rule each claim comes from.
		out(`  paths claimed by more than one ref (exact or wildcard):`)
		let multi = 0
		for (const x of rows) {
			const owners = resolutions.filter((r) => (/, \*/.test(r.res) ? wildMatches(r, x.path) : r.res.toLowerCase() === x.path.toLowerCase()))
			if (owners.length > 1) {
				multi++
				out(`    ${x.n}\t${JSON.stringify(x.path)} <- ${owners.map((o) => `${JSON.stringify(o.name)} @ ${JSON.stringify(manifests.find((m) => m.name === o.name)?.folder)}`).join(", ")}`)
			}
		}
		if (multi === 0) out(`    none`)
	}

	// Refs that repeat a RESOLUTION, and refs that share a title + company at different versions: which folder holds
	// the signatures (before directed-library-signatures 3.1 the ref walked LAST won; LibraryMatcher now picks the
	// ordinal-least full name).
	{
		const sigsIn = (folder?: string) => all.filter((s) => isLibFile(s, i1.res.items) && s.folder === folder).length
		const tkey = (r: string) => {
			const m = /^(.*?),\s*(.*?)\s*\(([^()]*)\)\s*$/.exec(r.trim())
			return m ? `${m[1].trim().toLowerCase()}|${m[3].trim().toLowerCase()}` : r.toLowerCase()
		}
		for (const [title, k] of [["RESOLUTION", (r: string) => r.toLowerCase()], ["title + company", tkey]] as const) {
			const groups = new Map<string, Item[]>()
			for (const m of manifests) {
				const r = resolutionOf(m) ?? ""
				groups.set(k(r), [...(groups.get(k(r)) ?? []), m])
			}
			const dups = [...groups].filter(([, ms]) => ms.length > 1)
			out(`\n-- refs sharing one ${title}: ${dups.length} group(s)`)
			for (const [g, ms] of dups) {
				out(`  ${g}`)
				for (const m of ms) out(`    ${JSON.stringify(m.name)}  RESOLUTION ${JSON.stringify(resolutionOf(m))}  @ ${JSON.stringify(m.folder)}  signatures beside it: ${sigsIn(m.folder)}`)
			}
		}
	}

	// What a directed read of Standard would have to return: the signatures the full fetch writes beside it.
	const bySigFolder = new Map<string, Item[]>()
	for (const s of all.filter((s) => isLibFile(s, i1.res.items))) bySigFolder.set(s.folder!, [...(bySigFolder.get(s.folder!) ?? []), s])
	out(`\n-- signature folders in init #1: ${bySigFolder.size}`)
	for (const [f, xs] of [...bySigFolder].sort(([a], [b]) => a.localeCompare(b))) out(`    ${xs.length}\t${f}`)
	const ton = all.filter((s) => isLibFile(s, i1.res.items) && /^TON\./.test(s.name))
	for (const t of ton) out(`  ${t.name} in ${t.folder}:\n${t.sourceText.split("\n").map((l) => `    | ${l}`).join("\n")}`)

	// Warm repeats.
	out("")
	const warm: number[] = []
	let last = i1
	for (let k = 2; k <= 4; k++) {
		last = await timed("init", "fetch", { init: true })
		describeFetch(`init #${k} (WARM extraction)`, last.ms, last.res)
		warm.push(last.ms)
	}
	if (withProbe) msg = await messages("after warm inits", msg)
	const knownItems = last.res.items as Record<string, string>
	const known: number[] = []
	for (let k = 1; k <= 3; k++) {
		const kf = await timed("known", "fetch", { knownItems })
		describeFetch(`known #${k} (no extraction: walk-only floor)`, kf.ms, kf.res)
		known.push(kf.ms)
	}
	// `.library` full names a no-extraction fetch re-sends although their versions are the live ones: the init and the
	// known fetch answer them from DIFFERENT folders (one full name, two Library Manager nodes). Print both folders,
	// then what a directed read of each such name answers (how many items, from which folder). The names whose second
	// folder shows here are the ones `parity` calls AMBIGUOUS.
	const twoFolders = new Map<string, string>()
	{
		const kf = await call("fetch", { knownItems })
		const resent = (kf.changed as Item[]).filter((i) => i.name.endsWith(".library"))
		out(`\n-- .library re-sent by a known fetch: ${resent.length}`)
		for (const k of resent) {
			const fromInit = (last.res.changed as Item[]).filter((i) => i.name === k.name)
			if (fromInit.some((i) => i.folder !== k.folder)) twoFolders.set(k.name, k.folder ?? "")
			out(`  ${JSON.stringify(k.name)}  known: ${JSON.stringify(k.folder)} ${JSON.stringify(resolutionOf(k))}  |  init: ${fromInit.map((i) => `${JSON.stringify(i.folder)} ${JSON.stringify(resolutionOf(i))}`).join(", ")}`)
			const d = await call("fetch", { knownItems: {}, onlyItems: [k.name] })
			out(`    directed ${JSON.stringify(k.name)}: changed=${d.changed.length} ${(d.changed as Item[]).map((i) => `${JSON.stringify(i.folder)} ${JSON.stringify(resolutionOf(i))}`).join(", ")}`)
		}
		out("")
	}
	const directed: number[] = []
	for (let k = 1; k <= 3; k++) {
		const d = await timed("directed", "fetch", { knownItems: {}, onlyItems: [STD] })
		describeFetch(`directed #${k} (warm session)`, d.ms, d.res)
		directed.push(d.ms)
	}
	if (withProbe) msg = await messages("after known + directed", msg)

	// 2.3 — two directed reads of DIFFERENT libraries one after the other, no library change between (spec "a second
	// read is warm"): the library with the most signatures beside it after Standard, then Standard again. Each answer
	// is compared with the full fetch's folder (directed == full), so after 3.1 this line is the route's own check.
	{
		const byFolder = new Map<string, Item[]>()
		for (const it of last.res.changed as Item[]) byFolder.set(it.folder ?? "", [...(byFolder.get(it.folder ?? "") ?? []), it])
		const libsBySize = (last.res.changed as Item[])
			.filter((i) => i.name.endsWith(".library") && i.name !== STD)
			.map((i) => ({ name: i.name, n: (byFolder.get(i.folder ?? "") ?? []).length - 1 }))
			.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
		const other = libsBySize[0]?.name
		out(`\n-- 2.3 two directed reads of different libraries in a row: ${JSON.stringify(other)} then ${JSON.stringify(STD)}`)
		for (const name of other ? [other, STD] : [STD]) {
			const d = await timed("directed", "fetch", { knownItems: {}, onlyItems: [name] })
			describeFetch(`directed ${JSON.stringify(name)}`, d.ms, d.res)
			out(`    ${parity(last.res.changed as Item[], name, d.res.changed as Item[], twoFolders)}`)
		}
		if (withProbe) msg = await messages("after the 2.3 reads", msg)
	}

	// 4.1 / 4.3 — the per-item snapshot: EVERY name refs publishes read on its own, compared with the last full fetch.
	// Opt-in (MEASURE_PARITY=1): one directed fetch per item (≈0.7 s each on Pro2193, 881 items).
	if (process.env.MEASURE_PARITY === "1") {
		const names = Object.keys(last.res.items as Record<string, string>).sort()
		out(`\n-- 4.3 directed == full, per item: ${names.length} names`)
		const tally = new Map<string, number>()
		for (const name of names) {
			const d = await call("fetch", { knownItems: {}, onlyItems: [name] })
			const verdict = parity(last.res.changed as Item[], name, d.changed as Item[], twoFolders)
			const ext = name.slice(name.lastIndexOf(".") + 1)
			const key = `${ext}\t${verdict.split(" ")[0]}`
			tally.set(key, (tally.get(key) ?? 0) + 1)
			if (!verdict.startsWith("SAME")) out(`  ${JSON.stringify(name)}: ${verdict}`)
		}
		out("  per extension (ext, verdict, count):")
		for (const [k, n] of [...tally].sort(([a], [b]) => a.localeCompare(b))) out(`    ${k}\t${n}`)
		// The tally iterates the names `refs` publishes, and a directed read answers only the folder of the name it was
		// asked for — so a signature the full fetch writes OUTSIDE every ref's folder (the `(unresolved)` folders) is
		// returned by no directed read and is in no row above. Count them, so the tally cannot read as "everything".
		const fullSigs = (last.res.changed as Item[]).filter((i) => isLibFile(i, last.res.items))
		const refFolders = new Set((last.res.changed as Item[]).filter((i) => i.name.endsWith(".library")).map((i) => i.folder))
		const outside = fullSigs.filter((i) => !refFolders.has(i.folder))
		out(`  full-fetch signatures: ${fullSigs.length}; in a ref's folder (a directed read can return them): ${fullSigs.length - outside.length}; outside every ref's folder (no directed read returns them): ${outside.length}`)
		const outsideFolders = new Map<string, number>()
		for (const i of outside) outsideFolders.set(i.folder ?? "", (outsideFolders.get(i.folder ?? "") ?? 0) + 1)
		for (const [f, n] of [...outsideFolders].sort(([a], [b]) => a.localeCompare(b))) out(`    ${n}\t${f}`)
	}

	const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
	// Cold is directed #0 (the session's first extraction); init #1 runs after its build, so it is not a cold figure.
	out(`\n-- summary (ms): extraction cold = directed #0 ${d0.ms} (the session's first extraction); ` +
		`init #1 ${i1.ms} (after directed #0's build, NOT cold; − known ≈ ${i1.ms - med(known)}); init warm ${warm.join("/")} (median ${med(warm)}); ` +
		`known ${known.join("/")} (median ${med(known)}); extraction warm ≈ ${med(warm) - med(known)}; directed ${directed.join("/")} warm (session cache)`)

	// R2 — edit, then read.
	if (withProbe) {
		const pou = (last.res.changed as Item[]).find(
			(i) => i.name in last.res.items && !(i.folder ?? "").split("/").includes(LIB_ROOT) && /\.pou$/.test(i.name) && /^\s*PROGRAM\b/m.test(i.sourceText) && /^IMPLEMENTATION ST\s*$/m.test(i.sourceText),
		)
		if (!pou) throw new Error("no ST program to edit")
		const bare = pou.name.replace(/\.pou$/, "")
		out(`\n-- R2 edit-then-read: editing ${bare}`)
		for (const l of await probe("edit", bare)) out(`  ${l}`)
		msg = await messages("after edit", msg)
		const afterEdit = await probe("libpaths")
		out(`  precompiled library signatures right after the edit (no build): ${afterEdit[0]}`)
		const de = await timed("directed", "fetch", { knownItems: {}, onlyItems: [STD] })
		describeFetch("directed after edit (session cache: no library version moved)", de.ms, de.res)
		msg = await messages("after directed-after-edit", msg)
		const ke = await timed("known", "fetch", { knownItems })
		describeFetch("known after edit (no extraction)", ke.ms, ke.res)
		msg = await messages("after known-after-edit", msg)
		const ie = await timed("init", "fetch", { init: true })
		describeFetch("init after edit (extraction after an edit)", ie.ms, ie.res)
		msg = await messages("after init-after-edit", msg)
		const ie2 = await timed("init", "fetch", { init: true })
		describeFetch("init again (warm after the edit's build)", ie2.ms, ie2.res)
		msg = await messages("after init-again", msg)
		out(`\n-- R2 summary (ms): extraction after edit ≈ ${ie.ms - ke.ms} (init ${ie.ms} − known ${ke.ms}); next warm init ${ie2.ms}`)

		// Cold after CODESYS's own Clean: the compile information gone, as on a project the IDE has never built.
		// Twice, each followed by THREE warm inits, so a Clean's cost can be told apart from the warm spread (one warm
		// sample beside one Clean sample could not: on the fixture the warm one once came out slower).
		for (let round = 1; round <= 2; round++) {
			out(`\n-- cold after Clean, round ${round}`)
			for (const l of await probe("clean")) out(`  ${l}`)
			const afterClean = await probe("libpaths")
			out(`  precompiled library signatures right after Clean (no build): ${afterClean[0]}`)
			msg = await messages("after clean", msg)
			const ic = await timed("init", "fetch", { init: true })
			describeFetch("init after Clean", ic.ms, ic.res)
			msg = await messages("after init-after-clean", msg)
			const after: number[] = []
			for (let k = 1; k <= 3; k++) {
				const ic2 = await timed("init", "fetch", { init: true })
				describeFetch(`init warm #${k} after the Clean's build`, ic2.ms, ic2.res)
				after.push(ic2.ms)
			}
			out(`\n-- Clean round ${round} summary (ms): init after Clean ${ic.ms}; next warm ${after.join("/")}; known floor ${ke.ms}`)
		}
	}
}

await main()
