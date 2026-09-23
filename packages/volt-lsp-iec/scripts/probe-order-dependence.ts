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
import { extname, join, relative } from "node:path"
import {
  parseSource,
  isGraphicalBody,
  parseStatements,
  unitAttributes,
  memberAttributes,
  declarationAttributes,
  type TopLevel,
} from "../src/syntax/index.js"
import { buildSymbolTable, scopeForUnit } from "../src/symbols/index.js"
import { lowerUnit } from "../src/transpile/index.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"
import { scanLibraryManifests } from "../src/workspace-refs.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
if (!existsSync(CORPUS)) throw new Error(`no corpus at ${CORPUS}`)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  const key = (p: string) => p.split("\\").join("/")
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

/** The same narrowing predicate the corpus test uses, so `unit.body` is typed. */
const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

/** Every routine key this ordering produces, tagged with the POU it came from. */
function routinesFor(dir: string, files: string[]): Map<string, string> {
  const parsed = files.map((file) => {
    const source = readFileSync(file, "utf8")
    return { file, source, parseResult: parseSource(source) }
  })
  const clean = parsed.filter((x) => x.parseResult.errors.length === 0)
  const project = buildSymbolTable(
    clean.map(({ file, source, parseResult }) => ({ uri: file, parseResult, source })),
    scanLibraryManifests(dir),
  )
  const attributes = new Map<object, Set<string>>(
    clean.flatMap(({ source, parseResult }) => [
      ...unitAttributes(parseResult, source),
      ...memberAttributes(parseResult, source),
      ...declarationAttributes(parseResult, source),
    ]),
  )
  const out = new Map<string, string>()
  for (const { file, parseResult } of clean)
    for (const unit of parseResult.units.filter(isRunnable)) {
      const scope = scopeForUnit(project, unit)
      if (scope === undefined) continue
      if (isGraphicalBody(unit.body)) continue
      const hasCode = parseStatements(unit.body).statements.length > 0
      try {
        const { pou } = lowerUnit(unit, scope, project, attributes)
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
  const files = walk(dir)

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
