/**
 * WHICH NETWORK-TEXT CONSTRUCTS DOES THE LIVE SUITE ACTUALLY PUSH?
 *
 * The e2e suite is thorough about the constructs it knows: labels, jumps, returns, titles, EN/ENO, fan-out,
 * Execute boxes, each asserted on CREATE, on the FIXED POINT, and against a real BUILD. What it could not tell
 * anyone is what it has never pushed AT ALL — and that is the shape of every bug it has missed.
 *
 * It missed one. `ladderLabel.prg`, pulled from a real TwinCAT project, is two networks: one holding a coil
 * with nothing driving it (`coil := ;`) and one holding NOTHING but a label. Pushed back into an empty
 * project it came back gutted — declaration gone, LD turned to FBD, both labels gone, one network gone —
 * with `volt push` reporting success (`twincat-graphical-create-loss`). Neither shape appears anywhere in
 * `test/e2e`, so 175 passing tests on both vendors said nothing about either.
 *
 * So this counts. Each construct the FORMAT defines (`docs/network-text.html`, each row keyed by the id of the section
 * that specifies it) against the e2e sources that push it. It is a REPORT, not a gate: a construct with
 * no coverage is a question — "can this be created, and does anyone know?" — and answering it needs a live
 * IDE, not a red CI job.
 *
 *   bun run scripts/e2e-graphical-coverage.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const E2E = join(import.meta.dir, "..", "test", "e2e")

/**
 * WHERE A BODY LINE STARTS, inside a JS source file.
 *
 * The suite builds bodies as SINGLE-LINE string literals in which a newline is the two-character escape
 * `\\n`, not a real one — so a regex anchored with `^` anchors to the start of a SOURCE line and almost never
 * to the start of a body line. That is not a nitpick: it is why the first run of this reported
 * "network COMMENT" as uncovered when `comments.test.ts` pushes two of them. A body line begins at the start
 * of the file, immediately after a `\\n` escape, or immediately after the quote that opens the literal.
 */
const AT_LINE = '(?:^|\\\\n|[\\x22\\x27\\x60])\\s*'

const line = (rest: string): RegExp => new RegExp(AT_LINE + rest, 'm')

/** Every construct the format defines, and how it appears in a pushed body. */
/**
 * `archive` is the SECOND AXIS, and the report was wrong without it.
 *
 * Every construct this script can count is one the WRITER can state, so the shapes Volt cannot CREATE are
 * invisible to it by construction — they report as a GAP, indistinguishable from a construct nobody got
 * round to testing. Those are opposite problems: one is a missing test, the other is a missing CAPABILITY
 * that no test can supply, because a push test for a body the pusher cannot build is not writable.
 *
 * The answer to the second kind is a HAND-DRAWN fixture — a `.TcPOU` saved out of a live XAE, which is how
 * `execute-box.TcPOU` and `drawn-refused-shapes.TcPOU` got here and how both of them found bugs within the
 * hour. So a construct is covered when the suite PUSHES it or when a drawn archive HOLDS it, and the two are
 * reported apart.
 */
const CONSTRUCTS: { name: string; where: string; match: RegExp; archive?: RegExp }[] = [
	{ name: "wire (VAR_TEMP g… : BOOL)", where: "#wire", match: /\bVAR_TEMP\s+g\d+/ },
	{ name: "coil (lvalue := operand)", where: "#assign", match: line("\\w[\\w.]*\\s*:=\\s*[^;\\s]") },
	{ name: "chained assign (x := y S= v)", where: "#assign", match: /:=(\s|\\n)+\w[\w.]*\s*(:=|S=|R=)/ },
	{ name: "operator group", where: "#group", match: /:=\s*\([^)]*\b(AND|OR|XOR|ADD|MUL|SUB|DIV)\b/ },
	{ name: "function call", where: "#fb", match: /:=\s*[A-Z_]\w*\(/ },
	{ name: "FB instance call", where: "#fb", match: /\b\w+\((\w+\s*:=|\s*\))/ },
	{ name: "output read (inst.Pin)", where: "#fb", match: /:=\s*\w+\.\w+/ },
	{ name: "unnamed instance (??? : TYPE)", where: "#unnamed-instance", match: /\?\?\?\s*:\s*\w+\(/ },
	{ name: "output pin (=>)", where: "#eneno", match: /=>/, archive: /n="OutputItems"[\s\S]{0,400}?<n \/>[\s\S]{0,400}?<v n="Operand">"[^"]+"/ },
	{ name: "EN pin (EN :=)", where: "#eneno", match: /\bEN\s*:=/ },
	{ name: "ENO consumer (.ENO)", where: "#eneno", match: /\)\.ENO\b/ },
	{ name: "Execute box", where: "#execute", match: /\bEXECUTE\b/, archive: /<v n="ProvidesSTSnippet">true<|n="STSnippet"[^\/]*>\s*<o/ },
	{ name: "modifier NOT", where: "#group", match: /:=\s*NOT\s|\bAND\s+NOT\b|\bOR\s+NOT\b/ },
	{ name: "rising edge (R_EDGE)", where: "#edge", match: /\bR_EDGE\(/ },
	{ name: "falling edge (F_EDGE)", where: "#edge", match: /\bF_EDGE\(/ },
	{ name: "PARALLEL", where: "#parallel", match: /\bPARALLEL\(/ },
	{ name: "backticked operand", where: "#opaque", match: /`[^`\s]*\(/ },
	{ name: "SET coil (S=)", where: "#assign", match: /\sS=\s/ },
	{ name: "RESET coil (R=)", where: "#assign", match: /\sR=\s/ },
	{ name: "JMP", where: "#control", match: /\bJMP\s+\w+/, archive: /<v n="Flags">4</ },
	{ name: "RETURN", where: "#control", match: /\bRETURN\s*;/, archive: /<v n="Flags">8</ },
	{ name: "network LABEL", where: "#comments", match: /NETWORK\s+LABEL:/ },
	{ name: "network TITLE", where: "#comments", match: /TITLE:/ },
	{ name: "network COMMENT", where: "#comments", match: line("\\/\\/ ") },
	{ name: "network DISABLED", where: "#comments", match: /\bDISABLED\b/ },
	{ name: "language LD", where: "#whitespace", match: /@volt-implementation LD \*\)/ },
	{ name: "language FBD", where: "#whitespace", match: /@volt-implementation FBD \*\)/ },

	// THE TWO THAT WERE MISSING, and the reason this file exists. Both are shapes a real project holds and
	// nothing in the suite creates.
	{ name: "EMPTY network (header straight to END_NETWORK)", where: "#comments", match: /NETWORK[^\n\\`]*\\n\s*END_NETWORK/ },
	{ name: "undriven coil (x := ;)", where: "#empty-slot", match: line("\\w[\\w.]*\\s*:=\\s*;") },
]

function sources(dir: string): string[] {
	const out: string[] = []
	for (const e of readdirSync(dir)) {
		const p = join(dir, e)
		if (statSync(p).isDirectory()) out.push(...sources(p))
		else if (e.endsWith(".ts")) out.push(p)
	}
	return out
}

/**
 * Only text that is PUSHED counts, so a construct named in PROSE does not read as covered — `labels.test.ts`
 * discusses `coil := ;` in a doc comment while never pushing one, which is exactly the false positive that
 * would have hidden this gap.
 *
 * So JS COMMENT lines are dropped and everything else is kept. The first cut kept only lines containing
 * `NETWORK`, `:=` or `=>`, which was too aggressive in the other direction: a body's own `// network comment`
 * line and a bare `EXECUTE` line contain none of those, so two constructs the suite genuinely covers were
 * reported as gaps. A coverage report that invents gaps is as useless as one that misses them.
 */
function pushedBodies(file: string): string {
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => !/^\s*(\*|\/\/)/.test(l))
		.join("\n")
}

const files = sources(E2E)
const corpus = new Map(files.map((f) => [f, pushedBodies(f)]))

/** The hand-drawn vendor archives — the only place a shape Volt cannot create can live. */
const DRAWN = join(import.meta.dir, "..", "test", "Volt.Ide.Twincat.Tests", "fixtures", "tc-pou")
const drawn = new Map(
	readdirSync(DRAWN)
		.filter((f) => f.endsWith(".TcPOU"))
		.map((f) => [f, readFileSync(join(DRAWN, f), "utf8")] as const),
)

const rows = CONSTRUCTS.map((c) => {
	const hits = [...corpus].filter(([, body]) => c.match.test(body)).map(([f]) => f)
	const held = c.archive ? [...drawn].filter(([, xml]) => c.archive!.test(xml)).map(([f]) => f) : []
	// A hit inside `refused-shapes.test.ts` is not coverage of the CONSTRUCT — it is coverage of the REFUSAL.
	// The two were indistinguishable while this only asked "does any source push it": that file pushes every
	// shape TwinCAT cannot create, so each of them counted as covered.
	//
	// ONLY that file. `uncovered-shapes.test.ts` is the opposite kind — it asserts a round trip, or a refusal
	// BY NAME, for shapes nothing had pushed before; its RESET coil round-trips AND builds. Excluding it too
	// reported five working constructs as refused, which is the mistake this axis exists to stop making.
	const accepted = hits.filter((f) => !/refused-shapes/.test(f))
	return { ...c, hits, held, accepted }
})

const covered = rows.filter((r) => r.accepted.length > 0)
const missing = rows.filter((r) => r.hits.length === 0)

/**
 * THE SHAPES VOLT CANNOT CREATE, and whether anything HOLDS one.
 *
 * This is the axis the report was missing, and two earlier attempts at it were wrong in instructive ways.
 * Counting "pushed" says nothing here, because `refused-shapes.test.ts` pushes every one of them — the push
 * is the assertion that it is REFUSED. Counting "pushed outside a refusal test" says nothing either, because
 * each also appears in a vendor-branching test that pushes it and expects success on CODESYS.
 *
 * What is knowable statically is narrower and more useful: for a shape no driver can build, the ONLY thing
 * that can hold one is a HAND-DRAWN archive. So the question is whether a fixture exists — and when it does
 * not, the report says what has to happen (somebody draws it in XAE), which no amount of test-writing will
 * substitute for. `execute-box.TcPOU` and `drawn-refused-shapes.TcPOU` are the two that exist, and each of
 * them found a bug in the hour it arrived.
 */
const UNCREATABLE = ["Execute box", "output pin (=>)"]
const undrawn = rows.filter((r) => UNCREATABLE.includes(r.name) && r.held.length === 0)
const drawnFor = rows.filter((r) => UNCREATABLE.includes(r.name) && r.held.length > 0)

console.log(`\n══ network-text constructs pushed by test/e2e (${files.length} source files) ══\n`)
for (const r of covered) console.log(`  ok    ${r.where}  ${r.name.padEnd(46)} ${r.accepted.length} file(s)`)
console.log()
console.log("  ── shapes NO driver can create: the only cover is a hand-drawn archive ──")
for (const r of drawnFor) console.log(`  drawn ${r.where}  ${r.name.padEnd(46)} ${r.held.join(", ")}`)
for (const r of undrawn)
	console.log(`  DRAW  ${r.where}  ${r.name.padEnd(46)} nothing holds this shape — draw one in XAE`)
console.log()
for (const r of missing) console.log(`  GAP   ${r.where}  ${r.name}`)

console.log(
	`\n${covered.length} of ${rows.length} constructs are pushed somewhere in the live suite; ` +
		`${missing.length} are not pushed at all.\n`,
)
if (undrawn.length > 0)
	console.log(
		`${undrawn.length} shape(s) no driver can create have NO drawn archive. A push test for one is not ` +
			`writable — somebody has to draw it in XAE and commit the .TcPOU.
`,
	)
console.log("A GAP is not a failing test — it is a construct nobody has ever asked a live IDE to create.")
console.log("That is what `ladderLabel.prg` was: two shapes no test pushed, and both lost on a real migration.\n")
