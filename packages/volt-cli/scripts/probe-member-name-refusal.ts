/**
 * IS THE IDE'S MEMBER-NAME REFUSAL DECIDABLE FROM THE TEXT? (openspec `push-keeps-what-landed` task 3.1)
 *
 * <p>Both IDEs refuse to create a METHOD named `Log` (CODESYS "The name 'Log' is not valid for this object.", TwinCAT
 * "Creating the child named 'Log' is not possible on node (Name mismatch)"). Only the live apply loop sees it today.
 * A pre-flight may refuse it before the first write ONLY IF the refused names are a fixed set the text alone decides —
 * `docs/driver.html`: "A pre-flight that guesses is worse than one that declines to." This probe asks the IDE.</p>
 *
 * <p>What it pushes, one op per push (a push stops at its first refusal), each a NEW FB `VltPkn_<i>`:</p>
 * <ol>
 *   <li>METHOD &lt;word&gt; for every word in the LSP's vocabulary (`KEYWORDS`, `IL_OPERATOR_WORDS`,
 *       `ELEMENTARY_TYPE_WORDS`), the standard library's functions/FBs that are NOT keywords, casing variants, and
 *       ordinary controls;</li>
 *   <li>context: the FB's own variable name, the FB's own name, an existing project POU's name — a refusal there
 *       would mean the set depends on the project, not the word;</li>
 *   <li>for every refused word and a sample of accepted ones: ACTION &lt;word&gt;, PROPERTY &lt;word&gt;, and a
 *       TOP-LEVEL FB named &lt;word&gt; — is the rule per word, or per member kind?</li>
 * </ol>
 *
 * <p>An ACCEPTED verdict is READ BACK before it is logged (gate step 3 review): a push answering `accepted` says only
 * that no op was refused, so the probe fetches the item and requires exactly ONE member, of the kind pushed, named
 * EXACTLY the word (a TOP-LEVEL FB: its header names the word, and it has no member). Anything else — a silent rename,
 * a member split differently, one dropped without an error — is logged `LANDED-OTHER` with what landed.</p>
 *
 * <p>PROBE_SET=verify (gate step 3) re-asks, with that read-back, every row the earlier runs logged ACCEPTED, every row
 * Volt's own pre-flight refused (`INVALID_ST`, which never reached the IDE), the context controls, and the words the
 * rule had decided unasked: every `<T>_TO_<T>`, and lower / mixed case of every refused vocabulary word and of the
 * conversions. Its log is `member-name-refusal-verify[-tc].log`.</p>
 *
 * Run against YOUR OWN bridge (never another session's IDE):
 *   pwsh scripts/ide.ps1 up -Vendor codesys -Instance push-keeps-what-landed -Wait     # prints the pipe
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun run scripts/probe-member-name-refusal.ts > scripts/member-name-refusal.log
 *   pwsh scripts/ide.ps1 down -Vendor codesys -Instance push-keeps-what-landed
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { callOn } from "../test/e2e/lib/pipe"
// The LSP's vocabulary, from the sibling package. A computed specifier: volt-cli's tsconfig roots at this package, so a
// static import of another package's source fails its typecheck (TS6059).
const VOCABULARY = "../../volt-lsp-iec/src/frontend/syntax/lex/vocabulary"
const { KEYWORDS, IL_OPERATOR_WORDS, ELEMENTARY_TYPE_WORDS } = (await import(VOCABULARY)) as {
	KEYWORDS: readonly string[]
	IL_OPERATOR_WORDS: ReadonlySet<string>
	ELEMENTARY_TYPE_WORDS: ReadonlySet<string>
}

const PIPE: string = process.env.VOLT_PIPE ?? ""
if (!/^volt\.bridge\.(codesys|twincat)\.\d+$/.test(PIPE)) throw new Error("set VOLT_PIPE to YOUR bridge's exact per-pid pipe")
const PREFIX = "VltPkn"
const CALL_TIMEOUT_MS = 120_000

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

/** One push against the CURRENT project version. `ops` takes the fresh refs, so an op's `ifVersion` is read in the same
 *  breath. TcXaeShell moves its project version on its own now and then (measured: once in ~250 verify rows, between
 *  a create and its delete), and a STALE_PROJECT_VERSION answer is about the race, not the word — so it is re-asked, up
 *  to 5 times, and logged as a verdict never. */
async function push(ops: any[] | ((refs: any) => any[])): Promise<any> {
	for (let tries = 1; ; tries++) {
		const r = await call("refs")
		const res = await call("push", { expectedProjectVersion: r.projectVersion, ops: typeof ops === "function" ? ops(r) : ops })
		const stale = !res.accepted && (res.conflicts ?? []).some((c: any) => c.code === "STALE_PROJECT_VERSION")
		if (!stale) return res
		if (tries === 5) throw new Error(`the project version kept moving under the push: ${JSON.stringify(res.conflicts)}`)
		console.error(`STALE_PROJECT_VERSION, re-asking (${tries})`)
	}
}

async function cleanup(): Promise<void> {
	const r = await call("refs")
	const mine = Object.keys(r.items ?? {}).filter((n) => n.startsWith(PREFIX) || leftoverTopLevel.has(n))
	for (const n of mine) {
		const d = await push((fresh) => [{ op: "deleteItem", name: n, ifVersion: fresh.items[n] }])
		if (!d.accepted) throw new Error(`cleanup could not delete ${n}: ${JSON.stringify(d.conflicts)}`)
	}
	leftoverTopLevel.clear()
}
const leftoverTopLevel = new Set<string>()

const MARK = "IMPLEMENTATION ST"
const fbText = (fb: string, children = "") => `FUNCTION_BLOCK ${fb}\nVAR\n\tx : INT;\nEND_VAR\n${MARK}\n;\nEND_FUNCTION_BLOCK\n${children}`
const method = (n: string) => `\nMETHOD ${n} : INT\nVAR_INPUT\n\td : INT;\nEND_VAR\n${MARK}\n;\nEND_METHOD\n`
const action = (n: string) => `\nACTION ${n}\n${MARK}\n;\nEND_ACTION\n`
const property = (n: string) => `\nPROPERTY ${n} : INT\nGET\n${MARK}\n;\nEND_GET\nEND_PROPERTY\n`

type Outcome = { verdict: "ACCEPTED" | "REFUSED" | "LANDED-OTHER"; code?: string; reason?: string }
type Kind = "METHOD" | "ACTION" | "PROPERTY" | "TOPLEVEL"
let seq = 0

const MEMBER_HEADER = /^\s*(METHOD|ACTION|PROPERTY)\s+((?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*)([A-Za-z_]\w*)/i

/** What the IDE holds under `name` after an accepted push: null when it is exactly one `kind` member named `word` (a
 *  TOP-LEVEL FB: its header names `word` and it has no member), else what landed instead. */
async function readBack(name: string, kind: Kind, word: string): Promise<string | null> {
	const f = await call("fetch", { knownItems: {}, onlyItems: [name] })
	const item = (f.changed ?? []).find((i: any) => i.name === name)
	if (!item) return `no item '${name}' to fetch`
	const lines = String(item.sourceText).replace(/\r/g, "").split("\n")
	const members = lines.map((l) => l.match(MEMBER_HEADER)).filter((m): m is RegExpMatchArray => m !== null)
	const seen = members.map((m) => `${m[1].toUpperCase()} ${m[3]}`).join(", ")
	if (kind === "TOPLEVEL") {
		const head = lines.map((l) => l.match(/^\s*FUNCTION_BLOCK\s+([A-Za-z_]\w*)/i)).find((m) => m)
		if (!head || head[1] !== word) return `header names '${head?.[1] ?? "(none)"}'`
		return members.length === 0 ? null : `members: ${seen}`
	}
	if (members.length !== 1 || members[0][1].toUpperCase() !== kind || members[0][3] !== word)
		return `members: ${seen || "(none)"}`
	return null
}

/** Push one create; read it back, and delete it again, when it landed. */
async function attempt(name: string, text: string, kind: Kind, word: string): Promise<Outcome> {
	const r = await push([{ op: "set", name, toFolder: "", sourceText: text, ifVersion: null }])
	if (r.accepted && (r.conflicts ?? []).length === 0) {
		const other = await readBack(name, kind, word)
		const d = await push((fresh) => [{ op: "deleteItem", name, ifVersion: fresh.items[name] }])
		if (!d.accepted) {
			leftoverTopLevel.add(name)
			throw new Error(`could not delete ${name} after it landed: ${JSON.stringify(d.conflicts)}`)
		}
		return other === null ? { verdict: "ACCEPTED" } : { verdict: "LANDED-OTHER", reason: other }
	}
	const c = (r.conflicts ?? [])[0] ?? {}
	const after = await call("refs")
	if (after.items?.[name] !== undefined) leftoverTopLevel.add(name)
	return { verdict: "REFUSED", code: c.code, reason: String(c.reason ?? JSON.stringify(r)).replace(/\s+/g, " ").slice(0, 260) }
}

const asMethod = (w: string) => attempt(`${PREFIX}_${++seq}.pou`, fbText(`${PREFIX}_${seq}`, method(w)), "METHOD", w)
const asAction = (w: string) => attempt(`${PREFIX}_${++seq}.pou`, fbText(`${PREFIX}_${seq}`, action(w)), "ACTION", w)
const asProperty = (w: string) => attempt(`${PREFIX}_${++seq}.pou`, fbText(`${PREFIX}_${seq}`, property(w)), "PROPERTY", w)
const asTopLevel = (w: string) => attempt(`${w}.pou`, fbText(w), "TOPLEVEL", w)
const AS: Record<Kind, (w: string) => Promise<Outcome>> = { METHOD: asMethod, ACTION: asAction, PROPERTY: asProperty, TOPLEVEL: asTopLevel }

/** PROBE_RESUME=<log>: the (kind, word) rows a run cut short already answered — skipped, so a resumed run asks only
 *  the rest. Its rows are appended to that log by the caller. */
const DONE = new Set<string>(
	process.env.PROBE_RESUME
		? readFileSync(process.env.PROBE_RESUME, "utf8").split("\n").map((l) => l.split(/\s+/))
				.filter((p) => ["ACCEPTED", "REFUSED", "LANDED-OTHER"].includes(p[2]) && !p[2].startsWith("("))
				.map((p) => `${p[0]} ${p[1]}`)
		: [],
)

function line(kind: string, w: string, o: Outcome): void {
	console.log(`${kind.padEnd(9)} ${w.padEnd(22)} ${o.verdict.padEnd(9)}${o.code ? ` [${o.code}]` : ""}${o.reason ? ` ${o.reason}` : ""}`)
}

// ── the candidates ─────────────────────────────────────────────────────────────────────────────────────────────────

const STANDARD_NOT_KEYWORDS = [
	// string functions
	"LEN", "LEFT", "RIGHT", "MID", "CONCAT", "INSERT", "DELETE", "REPLACE", "FIND",
	// standard FBs
	"TON", "TOF", "TP", "CTU", "CTD", "CTUD", "R_TRIG", "F_TRIG", "SR", "RS", "RTC",
	// conversions
	"INT_TO_REAL", "REAL_TO_INT", "TO_INT", "TO_REAL", "BOOL_TO_INT", "TRUNC_DINT",
	// other names in the language reference / system
	"NOW", "ANY", "ANY_INT", "ANY_NUM", "ANY_REAL", "PVOID", "XINT", "UXINT", "XWORD", "N", "CALC", "CALCN",
	"FB_init", "FB_exit", "FB_reinit", "__SYSTEM", "USING", "WITH", "NON_RETAIN", "VAR_CONFIG", "LTIME", "IMPLEMENTATION",
]
const CASING = ["log", "Log", "LOG", "lOg", "sin", "Min", "public"]
const CONTROLS = ["Foo", "Logger", "LogMsg", "Log2", "Logx", "MyLog", "Sine", "Minimum", "DoIt", "Run", "Execute", "Init", "Reset", "Start", "Stop", "Get_", "Set_", "Value", "Name", "Count", "Main", "Update", "Error", "Status"]

const unique = <T,>(xs: T[]) => [...new Set(xs)]

/**
 * PROBE_SET=families — is the refused set CLOSED? The first run found families the LSP vocabulary does not list
 * (INT_TO_REAL, TO_INT, ANY_INT refused; TRUNC_DINT, XINT accepted), so a pre-flight list would have to hold every
 * member of each family. This set walks each family whole: every X_TO_Y over the elementary types, TO_<T>, TRUNC_<T>,
 * the ANY_* generics, the character types, underscore shapes, and IEC words no vocabulary here lists. No cross-check
 * (section 3) — the first run showed the verdict is per word, the same for METHOD / ACTION / PROPERTY / top level.
 */
const TYPES = [...ELEMENTARY_TYPE_WORDS]
const FAMILIES = [
	...TYPES.flatMap((a) => TYPES.filter((b) => b !== a).map((b) => `${a}_TO_${b}`)),
	...TYPES.map((t) => `TO_${t}`),
	...TYPES.map((t) => `TRUNC_${t}`),
	"ANY_BIT", "ANY_STRING", "ANY_DATE", "ANY_ELEMENTARY", "ANY_DERIVED", "ANY_MAGNITUDE", "ANY_SIGNED", "ANY_UNSIGNED",
	"ANY_DURATION", "ANY_CHAR", "ANY_CHARS", "ANY_INTEGER", "ANY_FLOAT", "ANY_TYPE", "ANY_POINTER", "ANY_FOO",
	"CHAR", "WCHAR", "UCHAR", "UTF8", "__Foo", "a__b", "_Foo", "Foo_", "EN", "ENO", "NIL", "NULL", "LABEL",
	"CONFIGURATION", "END_CONFIGURATION", "RESOURCE", "END_RESOURCE", "TASK", "STEP", "END_STEP",
	"INITIAL_STEP", "TRANSITION", "END_TRANSITION", "ON", "PRIORITY", "SINGLE", "INTERVAL", "OVERLAP",
	"ROUND", "FLOOR", "CEIL", "SIGN", "ATAN2", "LAZY", "__LAZY", "UNION_", "BOOL_", "INT2", "TO_",
	"TO_FOO", "FOO_TO_INT", "INT_TO_FOO", "DINT_TO", "TRUNC_", "TRUNC_FOO",
	"BCD_TO_INT", "INT_TO_BCD", "BCD_TO_DINT", "DWORD_TO_BCD",
	"__ISVALIDREF_", "__SYSTEM_", "__NEW_", "__CURRENTTASK2", "__PROPERTYINFO", "__FOO", "__ADR", "__BITADR",
	"__UNREACHABLE", "__ISVALIDINTERFACE", "__TYPEOF", "__TYPECLASS", "__INSTANCE", "__MAXPOS",
]
const FAMILIES_RUN = process.env.PROBE_SET === "families"
const VERIFY_RUN = process.env.PROBE_SET === "verify"
const VENDOR = PIPE.includes(".twincat.") ? "twincat" : "codesys"
const LOG = (run: "" | "-families") => `member-name-refusal${run}${VENDOR === "twincat" ? "-tc" : ""}.log`

/** PROBE_SET=verify: the earlier runs' rows to re-ask with the read-back — every one logged ACCEPTED and every one
 *  Volt's own pre-flight refused (INVALID_ST, which never reached the IDE) — as (kind, word), in log order. */
function earlierRows(): [Kind, string][] {
	const rows = new Map<string, [Kind, string]>()
	for (const file of [LOG(""), LOG("-families")])
		for (const l of readFileSync(join(import.meta.dir, file), "utf8").split("\n")) {
			const p = l.split(/\s+/)
			if (!["METHOD", "ACTION", "PROPERTY", "TOPLEVEL"].includes(p[0]) || p[2]?.startsWith("(")) continue
			if (p[2] === "ACCEPTED" || p[3] === "[INVALID_ST]") rows.set(`${p[0]} ${p[1]}`, [p[0] as Kind, p[1]])
		}
	return [...rows.values()]
}

/** PROBE_SET=verify: the words the rule decided with no IDE answer behind them (gate step 3 review) — every
 *  `<T>_TO_<T>` (the families run skipped a == b), and lower / mixed case of every vocabulary word the IDE refused and
 *  of the conversions (case had been asked of 7 words only). */
function gapWords(): string[] {
	const title = (t: string) => t[0] + t.slice(1).toLowerCase()
	const refusedVocabulary = readFileSync(join(import.meta.dir, LOG("")), "utf8")
		.split("\n").map((l) => l.split(/\s+/))
		.filter((p) => p[0] === "METHOD" && p[2] === "REFUSED" && p[3] === "[UNSUPPORTED]").map((p) => p[1])
	return unique([
		...TYPES.map((t) => `${t}_TO_${t}`),
		...refusedVocabulary.map((w) => w.toLowerCase()).filter((w) => !CASING.includes(w)),
		...TYPES.map((t) => `to_${t.toLowerCase()}`),
		...TYPES.map((t) => `To_${title(t)}`),
		...TYPES.filter((t) => t !== "INT").flatMap((t) => [
			`int_to_${t.toLowerCase()}`, `${t.toLowerCase()}_to_int`, `Int_To_${title(t)}`, `${title(t)}_To_Int`,
		]),
	])
}

const words = VERIFY_RUN
	? gapWords()
	: FAMILIES_RUN
	? unique(FAMILIES)
	: unique([...KEYWORDS, ...IL_OPERATOR_WORDS, ...ELEMENTARY_TYPE_WORDS, ...STANDARD_NOT_KEYWORDS, ...CASING, ...CONTROLS])

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const t0 = Date.now()
console.log(`pipe ${PIPE} · ${new Date().toISOString()} · ${words.length} words`)
await cleanup()

if (VERIFY_RUN) {
	const rows = earlierRows()
	console.log(`\n== 0. read-back: ${rows.length} rows the earlier runs logged ACCEPTED or INVALID_ST ==`)
	for (const [kind, w] of rows) if (!DONE.has(`${kind} ${w}`)) line(kind, w, await AS[kind](w))
}

console.log(`\n== 1. METHOD <word> on a new FB${VERIFY_RUN ? " (the words the rule decided unasked)" : ""} ==`)
const methodOutcome = new Map<string, Outcome>()
for (const w of words) {
	if (DONE.has(`METHOD ${w}`)) continue
	const o = await asMethod(w)
	methodOutcome.set(w, o)
	line("METHOD", w, o)
}

if (!FAMILIES_RUN) {
console.log("\n== 2. context: the FB's own variable, the FB's own name, an existing project POU ==")
{
	const refs = await call("refs")
	const existing = Object.keys(refs.items ?? {}).find((n) => n.endsWith(".pou") && !n.startsWith(PREFIX))
	const fbOwn = `${PREFIX}_${++seq}`
	line("METHOD", "x (FB var)", await asMethod("x"))
	line("METHOD", `${fbOwn} (own FB)`, await attempt(`${fbOwn}.pou`, fbText(fbOwn, method(fbOwn)), "METHOD", fbOwn))
	if (!existing) throw new Error("the project holds no POU to name a method after")
	const bare = existing.replace(/\.pou$/, "")
	line("METHOD", `${bare} (project)`, await asMethod(bare))
}

if (!VERIFY_RUN) {
const refused = [...methodOutcome].filter(([, o]) => o.verdict === "REFUSED").map(([w]) => w)
const acceptedSample = [...methodOutcome].filter(([, o]) => o.verdict === "ACCEPTED").map(([w]) => w).slice(0, 12)
const crossCheck = unique([...refused, ...acceptedSample, ...CASING])

console.log(`\n== 3. ACTION / PROPERTY / top-level FB for ${refused.length} refused + ${acceptedSample.length} accepted + casing ==`)
for (const w of crossCheck) {
	line("ACTION", w, await asAction(w))
	line("PROPERTY", w, await asProperty(w))
	line("TOPLEVEL", w, await asTopLevel(w))
}
}
}
await cleanup()

// ── summary ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const byCode = new Map<string, string[]>()
for (const [w, o] of methodOutcome) {
	const k = o.verdict === "REFUSED" ? `REFUSED ${o.code}` : o.verdict
	byCode.set(k, [...(byCode.get(k) ?? []), w])
}
console.log("\n== summary (METHOD) ==")
for (const [k, ws] of byCode) console.log(`${k} (${ws.length}): ${ws.join(" ")}`)
console.log(`elapsed ${Math.round((Date.now() - t0) / 1000)} s`)
