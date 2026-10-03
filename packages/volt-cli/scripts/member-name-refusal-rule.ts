/**
 * DOES ONE RULE ON THE WORD ALONE REPRODUCE EVERY MEASURED VERDICT? (openspec `push-keeps-what-landed` task 3.1)
 *
 * <p>Reads the six logs `probe-member-name-refusal.ts` wrote (CODESYS SP21 + TcXaeShell; the vocabulary, families and
 * verify runs) and checks a candidate rule against every IDE verdict in them. Rows Volt's own pre-flight refused
 * (`INVALID_ST`) never reached the IDE and are not the IDE's verdict — they are listed, not checked.</p>
 *
 * <p>THE RULE DESCRIBES THE MEASURED WORDS; IT IS NOT A PRE-FLIGHT. It is fitted to them, and outside them (a word no
 * run asked) it is a guess — so a pre-flight built from these measurements refuses only words an IDE actually refused
 * (the logs), never a word the rule merely predicts.</p>
 *
 *   bun run scripts/member-name-refusal-rule.ts
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
// The LSP's vocabulary, from the sibling package. A computed specifier: volt-cli's tsconfig roots at this package, so a
// static import of another package's source fails its typecheck (TS6059).
const VOCABULARY = "../../volt-lsp-iec/src/frontend/syntax/lex/vocabulary"
const { KEYWORDS, IL_OPERATOR_WORDS, ELEMENTARY_TYPE_WORDS, CODESYS_ONLY_TYPE_WORDS } = (await import(VOCABULARY)) as {
	KEYWORDS: readonly string[]
	IL_OPERATOR_WORDS: ReadonlySet<string>
	ELEMENTARY_TYPE_WORDS: ReadonlySet<string>
	CODESYS_ONLY_TYPE_WORDS: ReadonlySet<string>
}

type Vendor = "codesys" | "twincat"

/** Keywords both IDEs ACCEPT as a member name (the LSP lists them as keywords for its own reasons). */
const ACCEPTED_KEYWORDS = new Set(["GET", "SET", "END_GET", "END_SET", "OVERRIDE", "NAMESPACE", "END_NAMESPACE"])
/** Keywords only CODESYS refuses as a name; TcXaeShell accepts them. */
const CODESYS_ONLY_REFUSED = new Set(["END_METHOD", "END_PROPERTY", "END_INTERFACE", "XSIZEOF", "VAR_GENERIC"])
/** Words no LSP list holds that both IDEs refuse: the generic types the IDE treats as reserved, and IL's CALC. */
const EXTRA = new Set(["ANY", "ANY_INT", "ANY_NUM", "ANY_REAL", "ANY_BIT", "ANY_STRING", "ANY_DATE", "CALC"])
/** The long spellings are NOT conversion stems: TIME_OF_DAY_TO_INT and TO_DATE_AND_TIME are accepted names. */
const LONG = new Set(["TIME_OF_DAY", "DATE_AND_TIME", "LDATE_AND_TIME", "LTIME_OF_DAY"])
/** The only stems whose `<T>_TO_<T>` is refused (measured, verify run); the stem must still be the vendor's. */
const SAME_TYPE_REFUSED = new Set(["TOD", "DT", "LTOD", "LDT"])

function types(v: Vendor): Set<string> {
	return new Set([...ELEMENTARY_TYPE_WORDS].filter((t) => !(v === "twincat" && CODESYS_ONLY_TYPE_WORDS.has(t))))
}

export function refusedName(word: string, v: Vendor): boolean {
	const w = word.toUpperCase()
	if (w.includes("__")) return true
	const ts = types(v)
	if ((KEYWORDS as readonly string[]).includes(w) && !ACCEPTED_KEYWORDS.has(w)) return v === "codesys" || !CODESYS_ONLY_REFUSED.has(w)
	if (IL_OPERATOR_WORDS.has(w) || ts.has(w) || EXTRA.has(w)) return true
	const stems = [...ts].filter((t) => !LONG.has(t))
	const conv = w.match(/^(?:(.+)_)?TO_(.+)$/)
	if (!conv || !stems.includes(conv[2])) return false
	if (conv[1] === undefined) return true
	// `<T>_TO_<T>` is NO conversion name to either IDE (INT_TO_INT, REAL_TO_REAL … are accepted, verify run) — except over
	// the date-and-time short words, which both refuse (TOD_TO_TOD, DT_TO_DT; on CODESYS also LTOD_TO_LTOD, LDT_TO_LDT).
	if (conv[1] === conv[2]) return SAME_TYPE_REFUSED.has(conv[1])
	return stems.includes(conv[1])
}

/** The verify runs (gate step 3) READ BACK every accept, so their ACCEPTED is "landed exactly as pushed". The first four
 *  logs' ACCEPTED rows were logged without a read-back; every one of them is re-asked in the verify logs, so a row the
 *  verify log answers overrides the earlier one (`LATER WINS`). */
const LOGS: [string, Vendor][] = [
	["member-name-refusal.log", "codesys"],
	["member-name-refusal-families.log", "codesys"],
	["member-name-refusal-verify.log", "codesys"],
	["member-name-refusal-tc.log", "twincat"],
	["member-name-refusal-families-tc.log", "twincat"],
	["member-name-refusal-verify-tc.log", "twincat"],
]
const verdicts = new Map<string, { v: Vendor; kind: string; word: string; verdict: string; code?: string; reason: string }>()
for (const [file, v] of LOGS) {
	for (const line of readFileSync(join(import.meta.dir, file), "utf8").split("\n")) {
		const p = line.split(/\s+/)
		if (!["METHOD", "ACTION", "PROPERTY", "TOPLEVEL"].includes(p[0]) || p[2]?.startsWith("(")) continue
		if (!["ACCEPTED", "REFUSED", "LANDED-OTHER"].includes(p[2])) throw new Error(`${file}: unreadable row '${line}'`)
		verdicts.set(`${v} ${p[0]} ${p[1]}`, { v, kind: p[0], word: p[1], verdict: p[2], code: p[3], reason: line })
	}
}
let checked = 0
const preflight: string[] = [], other: string[] = [], wrong: string[] = []
for (const r of verdicts.values()) {
	if (r.code === "[INVALID_ST]") { preflight.push(`${r.v} ${r.kind} ${r.word}`); continue }
	if (r.verdict === "LANDED-OTHER") { other.push(r.reason.trim()); continue }
	const refused = r.verdict === "REFUSED"
	checked++
	if (refused !== refusedName(r.word, r.v)) wrong.push(`${r.v} ${r.kind} ${r.word}: IDE ${r.verdict}, rule ${refused ? "accepts" : "refuses"}`)
}
console.log(
	`${checked} IDE verdicts checked (distinct vendor × kind × word), ${preflight.length} still refused by Volt's own ` +
	`pre-flight (INVALID_ST), ${other.length} landed as something else, ${wrong.length} the rule gets wrong`,
)
for (const w of preflight) console.log(`  pre-flight: ${w}`)
for (const w of other) console.log(`  landed-other: ${w}`)
for (const w of wrong) console.log(`  wrong: ${w}`)
if (other.length > 0 || wrong.length > 0) process.exitCode = 1
