/**
 * WHICH POUs WITH CODE DO NOT LOWER, AND WHY — the list, so a change in the corpus figure can be attributed
 * instead of accepted.
 *
 * Prints one line per POU that has statements and does not produce an IR, with the refusal codes lowering
 * reported. Run it before and after a resolver change and diff the two outputs.
 *
 * Run: bun scripts/probe-lowering-refusals.ts > before.txt
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { isGraphicalBody, parseStatements, type TopLevel } from "../src/syntax/index.js"
import { isLibrarySymbol, scopeForUnit } from "../src/symbols/index.js"
import { lowerUnit } from "../src/transpile/index.js"
import { loweringProject } from "../test/corpus/support/project.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
if (!existsSync(CORPUS)) throw new Error(`no corpus at ${CORPUS}`)

const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

for (const projectName of readdirSync(CORPUS)
  .filter((p) => statSync(join(CORPUS, p)).isDirectory())
  .sort()) {
  const dir = join(CORPUS, projectName)
  const lowering = loweringProject(dir)
  for (const { uri: file, parseResult } of lowering.files.filter((f) => !isLibrarySymbol(f)))
    for (const unit of parseResult.units.filter(isRunnable)) {
      const scope = scopeForUnit(lowering.project, unit)
      if (scope === undefined) continue
      if (isGraphicalBody(unit.body)) continue
      if (parseStatements(unit.body).statements.length === 0) continue
      try {
        const { pou, diagnostics } = lowerUnit(unit, scope, lowering)
        const codes = [...new Set((diagnostics ?? []).map((d) => d.code))].sort()
        console.log(
          `${pou === undefined ? "REFUSED" : "lowered"}\t${relative(CORPUS, file)}\t${codes.join(",")}`,
        )
      } catch (e) {
        console.log(`THREW  \t${relative(CORPUS, file)}\t${(e as Error).message}`)
      }
    }
}
