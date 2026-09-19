/**
 * Lowering coverage — the ratchet from "the basics" to 100%, measured rather than asserted.
 *
 * Lowering is total: a POU either becomes IR or reports exactly which constructs stopped it. Run that over
 * the whole corpus and the result is a work list ordered by how much of the real world each construct
 * unblocks — so the next thing to build is a number, not an opinion.
 *
 * Unlike `parser-completeness.ts`, a nonzero count here is NOT a defect: the parser is expected to be
 * complete today, the backend is expected to be partial. What matters is that the figure only ever goes up,
 * and that nothing lowers WRONG — a construct is either supported or reported, never guessed at.
 *
 * Usage: `bun run scripts/lower-completeness.ts [--top N] [--code <slug>]`
 *   --code lists the files blocked by one construct — the fixtures to work from when you go implement it.
 *   --sole with --code narrows that to the POUs it is the ONLY blocker of: what building it would lower today.
 *   --why  lists the distinct MESSAGES behind one construct — which shape to build first.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname, relative } from "node:path"
import { declarationAttributes, isGraphicalBody, memberAttributes, parseSource, parseStatements, unitAttributes, type TopLevel } from "../src/syntax/index.js"
import { buildSymbolTable, scopeForUnit } from "../src/symbols/index.js"
import { lowerUnit } from "../src/transpile/index.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"
import { scanLibraryManifests } from "../src/workspace-refs.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const args = process.argv.slice(2)
const top = Number(args[args.indexOf("--top") + 1]) || 20
const only = args.includes("--code") ? args[args.indexOf("--code") + 1] : undefined
/** --sole: with --code, list only the POUs this construct is the ONLY blocker of — what building it would add. */
const soleOnly = args.includes("--sole")
/** --why <code>: the distinct MESSAGES behind one code, most POUs first — which construct to build, not just where. */
const why = args.includes("--why") ? args[args.indexOf("--why") + 1] : undefined
const reasons = new Map<string, number>()

const walk = (d: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

// The denominator that matters is a POU with a BODY. Most units in a real project are empty-bodied — their
// logic lives in separate METHOD/ACTION units — so counting all of them would report ~91% while not one
// real body lowers. Both are tracked; only the first is the coverage figure.
let withCode = 0
let withCodeLowered = 0
let declOnly = 0
/** The METHOD/ACTION bodies a lowering POU actually LOWERS, by `<project>:<routine key>` — "reached", as against
 *  the `separateBodies` count of every one that exists. They were reported as none, and they are not none. */
const reachedRoutines = new Set<string>()
const reachedFromRunning = new Set<string>()
let declOnlyLowered = 0
let separateBodies = 0
let slots = 0
let statements = 0
/** blocking code → how many statement-bearing POUs it stopped, how many it stopped ALONE, and where. */
const blockers = new Map<string, { pous: number; sole: number; examples: string[]; soleFiles: string[] }>()

// One symbol table per corpus PROJECT, as the IDE compiles it. A table per FILE made every type and global declared in
// another file unresolvable: it reported 16 `type-unknown` POUs where 7 are real, and hid 6 `case-label` blockers
// behind them (2026-09-14).
const projects = readdirSync(CORPUS).filter((name) => statSync(join(CORPUS, name)).isDirectory())
for (const projectDir of projects) {
  const files = walk(join(CORPUS, projectDir)).flatMap((file) => {
    const source = readFileSync(file, "utf8")
    try {
      const parseResult = parseSource(source)
      // a parse gap is `parser-completeness`'s to report, not ours
      return parseResult.errors.length > 0 ? [] : [{ file, source, parseResult }]
    } catch {
      return []
    }
  })
  const project = buildSymbolTable(
    files.map(({ file, source, parseResult }) => ({ uri: file, parseResult, source })),
    scanLibraryManifests(join(CORPUS, projectDir)),
  )
  const attributes = new Map<object, Set<string>>(
    files.flatMap(({ source, parseResult }) => [
      ...unitAttributes(parseResult, source),
      ...memberAttributes(parseResult, source),
      ...declarationAttributes(parseResult, source),
    ]),
  )
  for (const { file, parseResult } of files) {
    // Where the code actually lives: a METHOD/ACTION body belongs to its FB's frame. Counted so the number is
    // visible rather than quietly excluded — and counted AGAINST `reachedRoutines`, because "not reachable yet"
    // was wrong: a routine lowers when a lowering POU calls it, and 444 of these do.
    separateBodies += parseResult.units.filter(
      (u) => (u.kind === "method" || u.kind === "action") && !isGraphicalBody(u.body) && u.body.tokens.length > 0,
    ).length

    for (const unit of parseResult.units.filter(isRunnable)) {
      const scope = scopeForUnit(project, unit)
      if (scope === undefined) continue
      const hasCode = !isGraphicalBody(unit.body) && parseStatements(unit.body).statements.length > 0
      if (hasCode) withCode++
      else declOnly++

      const { pou, diagnostics } = lowerUnit(unit, scope, project, attributes)
      if (pou !== undefined) {
        for (const routine of pou.routines) {
          reachedRoutines.add(`${file}:${routine.key}`)
          if (hasCode) reachedFromRunning.add(`${file}:${routine.key}`)
        }
        if (hasCode) {
          withCodeLowered++
          slots += pou.slots.length
          statements += pou.body.length
        } else declOnlyLowered++
        continue
      }
      if (!hasCode) continue // a declaration-only POU's blockers are not the work list
      // One POU counts once per DISTINCT blocking construct — otherwise a loop body with 40 calls would
      // drown out a construct that blocks 40 different projects.
      const codes = new Set(diagnostics.map((d) => d.code))
      if (why !== undefined)
        for (const m of new Set(diagnostics.filter((d) => d.code === why).map((d) => d.message)))
          reasons.set(m, (reasons.get(m) ?? 0) + 1)
      for (const code of codes) {
        const entry = blockers.get(code) ?? { pous: 0, sole: 0, examples: [], soleFiles: [] }
        entry.pous++
        // Most blocked POUs are blocked by SEVERAL constructs, so `pous` is reach, not gain: clearing the construct
        // that reaches the most POUs can lower none of them. `sole` is what building it would actually add today.
        if (codes.size === 1) {
          entry.sole++
          entry.soleFiles.push(relative(CORPUS, file))
        }
        if (entry.examples.length < 3) entry.examples.push(relative(CORPUS, file))
        blockers.set(code, entry)
      }
    }
  }
}

const pct = (n: number, of: number) => (of === 0 ? "0.0" : ((n / of) * 100).toFixed(1))

if (why !== undefined) {
  console.log(`${why}: ${[...reasons].length} distinct reasons`)
  for (const [message, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${String(n).padStart(4)}  ${message}`)
  process.exit(0)
}

if (only !== undefined) {
  const entry = blockers.get(only)
  // `--sole` is the ACTIONABLE list: the POUs this construct is the ONLY blocker of, so building it lowers them
  // today. `reach` counts POUs it stops among others, which is a prerequisite count and not a gain.
  if (soleOnly) {
    console.log(entry === undefined ? `no POU is blocked by \`${only}\`` : `${only}: ${entry.sole} POU(s) it is the ONLY blocker of`)
    for (const f of entry?.soleFiles ?? []) console.log(`  ${f}`)
    process.exit(0)
  }
  console.log(entry === undefined ? `no POU is blocked by \`${only}\`` : `${only}: ${entry.pous} POUs, e.g.`)
  for (const e of entry?.examples ?? []) console.log(`  ${e}`)
  process.exit(0)
}

console.log(`POUs with a body:  ${withCode}`)
console.log(
  `  lowered:         ${withCodeLowered} (${pct(withCodeLowered, withCode)}%) — ${slots} slots, ${statements} top-level statements`,
)
console.log(`  blocked:         ${withCode - withCodeLowered} (${pct(withCode - withCodeLowered, withCode)}%)`)
console.log(`declaration-only:  ${declOnly} (lowered ${declOnlyLowered}) — real, but they execute nothing`)
console.log(
  `METHOD/ACTION:     ${separateBodies} bodies, ${reachedRoutines.size} REACHED ` +
    `(${reachedFromRunning.size} from a POU that RUNS; the rest are lifecycle — FB_Init and init-slot methods)`,
)
console.log("")
console.log("blocked POUs-with-a-body per construct — `reach` stopped by it, `sole` it is the ONLY blocker of:")
const ranked = [...blockers].sort((a, b) => b[1].sole - a[1].sole || b[1].pous - a[1].pous).slice(0, top)
const width = Math.max(4, ...ranked.map(([code]) => code.length))
console.log(`  ${"construct".padEnd(width)}  reach   pct   sole  example`)
for (const [code, { pous: n, sole, examples }] of ranked)
  console.log(
    `  ${code.padEnd(width)}  ${String(n).padStart(5)}  ${pct(n, withCode).padStart(5)}%  ${String(sole).padStart(4)}  ${examples[0] ?? ""}`,
  )
