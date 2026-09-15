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
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname, relative } from "node:path"
import { declarationAttributes, isGraphicalBody, memberAttributes, parseSource, parseStatements, unitAttributes, type TopLevel } from "../src/syntax/index.js"
import { buildSymbolTable, scopeForUnit } from "../src/symbols/index.js"
import { lowerUnit } from "../src/transpile/index.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const args = process.argv.slice(2)
const top = Number(args[args.indexOf("--top") + 1]) || 20
const only = args.includes("--code") ? args[args.indexOf("--code") + 1] : undefined

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
let declOnlyLowered = 0
let separateBodies = 0
let slots = 0
let statements = 0
/** blocking code → how many statement-bearing POUs it stopped, and where. */
const blockers = new Map<string, { pous: number; examples: string[] }>()

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
  const project = buildSymbolTable(files.map(({ file, source, parseResult }) => ({ uri: file, parseResult, source })))
  const attributes = new Map<object, Set<string>>(
    files.flatMap(({ source, parseResult }) => [
      ...unitAttributes(parseResult, source),
      ...memberAttributes(parseResult, source),
      ...declarationAttributes(parseResult, source),
    ]),
  )
  for (const { file, parseResult } of files) {
    // Where the code actually lives: a METHOD/ACTION body belongs to its FB's frame, which lowering does not
    // reach yet. Counted so the number is visible rather than quietly excluded.
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
      for (const code of new Set(diagnostics.map((d) => d.code))) {
        const entry = blockers.get(code) ?? { pous: 0, examples: [] }
        entry.pous++
        if (entry.examples.length < 3) entry.examples.push(relative(CORPUS, file))
        blockers.set(code, entry)
      }
    }
  }
}

const pct = (n: number, of: number) => (of === 0 ? "0.0" : ((n / of) * 100).toFixed(1))

if (only !== undefined) {
  const entry = blockers.get(only)
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
console.log(`METHOD/ACTION:     ${separateBodies} bodies not reachable yet (they share their FB's frame)`)
console.log("")
console.log("what would unblock the most POUs-with-a-body, most first:")
const ranked = [...blockers].sort((a, b) => b[1].pous - a[1].pous).slice(0, top)
const width = Math.max(4, ...ranked.map(([code]) => code.length))
for (const [code, { pous: n, examples }] of ranked)
  console.log(
    `  ${code.padEnd(width)}  ${String(n).padStart(5)}  ${pct(n, withCode).padStart(5)}%  ${examples[0] ?? ""}`,
  )
