/**
 * WHICH POUs WITH CODE DO NOT LOWER, AND WHY — the list, so a change in the corpus figure can be attributed
 * instead of accepted.
 *
 * Prints one line per POU that has statements and does not produce an IR, with the refusal codes lowering
 * reported. Run it before and after a resolver change and diff the two outputs.
 *
 * Run: bun scripts/probe-lowering-refusals.ts > before.txt
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

const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

for (const projectName of readdirSync(CORPUS)
  .filter((p) => statSync(join(CORPUS, p)).isDirectory())
  .sort()) {
  const dir = join(CORPUS, projectName)
  const files = walk(dir)
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
  for (const { file, parseResult } of clean)
    for (const unit of parseResult.units.filter(isRunnable)) {
      const scope = scopeForUnit(project, unit)
      if (scope === undefined) continue
      if (isGraphicalBody(unit.body)) continue
      if (parseStatements(unit.body).statements.length === 0) continue
      try {
        const { pou, diagnostics } = lowerUnit(unit, scope, project, attributes)
        const codes = [...new Set((diagnostics ?? []).map((d) => d.code))].sort()
        console.log(
          `${pou === undefined ? "REFUSED" : "lowered"}\t${relative(CORPUS, file)}\t${codes.join(",")}`,
        )
      } catch (e) {
        console.log(`THREW  \t${relative(CORPUS, file)}\t${(e as Error).message}`)
      }
    }
}
