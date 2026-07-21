/**
 * Corpus false-positive tally, grouped by check code — the zero-FP oracle in a debuggable form.
 *
 * The corpus (`test-corpus/`) compiles clean in the IDE, so EVERY error-severity diagnostic the analysis emits
 * here is a false positive. `corpus.test.ts` asserts the total is zero; this script is what you run when it
 * isn't — it groups the FPs by `code` and shows the first few offenders per code with their file, so you can
 * see which check over-fires and on what (dead-member / task-root suppression matches the server).
 *
 *   bun scripts/corpus-fp.ts            # all checks
 *   bun scripts/corpus-fp.ts array      # only codes containing "array"
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { parseSource } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import {
  computeSemanticDiagnostics,
  resolveConfig,
  deadPous,
  deadMemberSpans,
  inDeadMember,
  ownerPou,
} from "../src/analysis/index.js"
import { loadWorkspaceRefs, loadTaskRoots } from "../src/workspace-refs.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const filter = process.argv[2]

const walk = (d: string): string[] => {
  const out: string[] = []
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

const config = resolveConfig({ vendor: "codesys" })
const byCode: Record<string, string[]> = {}
for (const project of readdirSync(CORPUS)) {
  const dir = join(CORPUS, project)
  if (!statSync(dir).isDirectory()) continue
  const inputs = walk(dir).map((uri) => {
    const source = readFileSync(uri, "utf8")
    return { uri, source, parseResult: parseSource(source) }
  })
  const scope = buildSymbolTable(inputs)
  const references = loadWorkspaceRefs(dir)
  const dead = deadPous(inputs, loadTaskRoots(dir))
  const deadMembers = deadMemberSpans(inputs, dead)
  for (const f of inputs) {
    const owner = ownerPou(f.parseResult)
    if (owner !== undefined && dead.has(owner)) continue
    const dm = deadMembers.get(f.uri)
    for (const d of computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project: scope, config, references }))
      if (d.severity === "error" && !inDeadMember(d.span, dm))
        (byCode[d.code] ??= []).push(`${project}${f.uri.slice(dir.length)}: ${d.message}`)
  }
}

const codes = Object.keys(byCode)
  .filter((c) => !filter || c.includes(filter))
  .sort((a, b) => byCode[b].length - byCode[a].length)
if (codes.length === 0) {
  console.log("No false positives 🎉")
} else {
  let total = 0
  for (const code of codes) {
    total += byCode[code].length
    console.log(`\n### ${code}: ${byCode[code].length}`)
    for (const m of byCode[code].slice(0, 8)) console.log("  ", m)
    if (byCode[code].length > 8) console.log(`   … +${byCode[code].length - 8} more`)
  }
  console.log(`\nTOTAL false positives: ${total}`)
  process.exitCode = 1
}
