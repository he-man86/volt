/**
 * WHAT STILL DEPENDS ON THE ORDER FILES ARE BOUND? — a diff, not a hypothesis.
 *
 * Lowers one corpus project twice, once with the files sorted and once reversed, and reports the routines
 * that appear in only one of the two runs. Each entry names the POU whose lowering changed, so the resolver
 * path responsible can be traced from a real case instead of guessed at across the whole symbol layer.
 *
 * Run: bun scripts/probe-order-dependence.ts [projectName]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { isGraphicalBody, parseSource, parseStatements, type TopLevel } from "../src/syntax/index.js"
import { isLibrarySymbol, scopeForUnit } from "../src/symbols/index.js"
import { lowerUnit } from "../src/transpile/index.js"
import { loweringProject, walkSources } from "../test/corpus/support/project.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
if (!existsSync(CORPUS)) throw new Error(`no corpus at ${CORPUS}`)

/** The same narrowing predicate the corpus test uses, so `unit.body` is typed. */
const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

/** Every routine key this ordering produces, tagged with the POU it came from. */
function routinesFor(dir: string, files: string[]): Map<string, string> {
  const lowering = loweringProject(
    dir,
    files.map((uri) => {
      const source = readFileSync(uri, "utf8")
      return { uri, source, parseResult: parseSource(source) }
    }),
  )
  const out = new Map<string, string>()
  for (const { uri: file, parseResult } of lowering.files.filter((f) => !isLibrarySymbol(f)))
    for (const unit of parseResult.units.filter(isRunnable)) {
      const scope = scopeForUnit(lowering.project, unit)
      if (scope === undefined) continue
      if (isGraphicalBody(unit.body)) continue
      const hasCode = parseStatements(unit.body).statements.length > 0
      try {
        const { pou } = lowerUnit(unit, scope, lowering)
        for (const r of pou?.routines ?? [])
          out.set(`${file}:${r.key}`, `${relative(CORPUS, file)}${hasCode ? " [runs]" : ""}`)
      } catch {
        /* question 1's problem, not this probe's */
      }
    }
  return out
}

const only = process.argv[2]
for (const projectName of readdirSync(CORPUS)
  .filter((p) => statSync(join(CORPUS, p)).isDirectory())
  .sort()) {
  if (only !== undefined && projectName !== only) continue
  const dir = join(CORPUS, projectName)
  const files = walkSources(dir)

  const forward = routinesFor(dir, files)
  const reverse = routinesFor(dir, [...files].reverse())

  const gained = [...reverse.keys()].filter((k) => !forward.has(k))
  const lost = [...forward.keys()].filter((k) => !reverse.has(k))
  console.log(
    `${projectName.padEnd(20)} forward=${forward.size} reverse=${reverse.size} ` +
      `(+${gained.length} / -${lost.length})`,
  )
  const show = (label: string, keys: string[], src: Map<string, string>) => {
    const byPou = new Map<string, number>()
    for (const k of keys) {
      const pou = src.get(k)!
      byPou.set(pou, (byPou.get(pou) ?? 0) + 1)
    }
    for (const [pou, n] of [...byPou.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
      console.log(`    ${label} ${String(n).padStart(3)} routines — ${pou}`)
  }
  show("+", gained, reverse)
  show("-", lost, forward)
}
