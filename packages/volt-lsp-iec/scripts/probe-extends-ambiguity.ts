/**
 * HOW MANY `EXTENDS` TARGETS ARE AMBIGUOUS? — a measurement, not a guess.
 *
 * `linkExtends` builds `byName` with `Map.set`, so when two top-level scopes in one project share a name the
 * LAST one bound wins — and bind order is file order, which is `readdirSync` order. This walks each corpus
 * project the way the corpus test does and reports, per project:
 *
 *   - how many names have more than one candidate scope
 *   - how many of those collisions are actually REACHED by an `extendsName`
 *   - what the colliding candidates are (kind + file), so the right precedence can be chosen from evidence
 *
 * Run: bun scripts/probe-extends-ambiguity.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { parseSource } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"
import { libraryOf, isLibrarySymbol, type Scope } from "../src/symbols/symbol.js"

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

/** The same predicate `linkExtends` uses to decide what can BE a base. */
const isBaseCandidate = (c: Scope): boolean =>
  c.extendsName !== undefined || c.kind === "pou" || c.kind === "interface" || c.kind === "struct"

let totalCollisions = 0
let totalReached = 0

for (const project of readdirSync(CORPUS)
  .filter((p) => statSync(join(CORPUS, p)).isDirectory())
  .sort()) {
  const dir = join(CORPUS, project)
  const files = walk(dir)
  const table = buildSymbolTable(
    files.map((file) => {
      const source = readFileSync(file, "utf8")
      return { uri: file, source, parseResult: parseSource(source) }
    }),
  )

  // Every candidate, grouped by the key `linkExtends` would store it under.
  const candidates = new Map<string, Scope[]>()
  for (const c of table.children) {
    if (!isBaseCandidate(c)) continue
    const key = c.name.toLowerCase()
    const list = candidates.get(key)
    if (list === undefined) candidates.set(key, [c])
    else list.push(c)
  }

  const collisions = [...candidates.entries()].filter(([, v]) => v.length > 1)
  // A collision only MATTERS if something actually extends that name.
  const wanted = new Set(
    table.children.map((c) => c.extendsName).filter((n): n is string => n !== undefined),
  )
  const reached = collisions.filter(([name]) => wanted.has(name))

  totalCollisions += collisions.length
  totalReached += reached.length

  console.log(
    `${project.padEnd(20)} files=${String(files.length).padStart(6)} ` +
      `candidates=${String(candidates.size).padStart(5)} ` +
      `colliding-names=${String(collisions.length).padStart(4)} ` +
      `REACHED-BY-EXTENDS=${reached.length}`,
  )

  for (const [name, scopes] of reached.slice(0, 12)) {
    const text = (sc: Scope) => readFileSync(String(sc.defUri), "utf8").split("\r").join("").trim()
    const texts = scopes.map(text)
    const identical = texts.every((t) => t === texts[0])
    const libs = scopes.map((sc) => libraryOf({ uri: String(sc.defUri) }) ?? "(project)")
    // WHO is extending this name, and which library are THEY in? If the extender sits in one of the candidate
    // libraries, "resolve within your own library first" answers it without inventing a precedence.
    const extenders = table.children.filter((c) => c.extendsName === name)
    const extLibs = extenders.map((c) => libraryOf({ uri: String(c.defUri) }) ?? "(project)")
    const sameLibWins = extLibs.every((el) => libs.includes(el))
    console.log(
      `    ${name} — ${scopes.length} candidates [${libs.join(" | ")}] — ${identical ? "IDENTICAL" : "DIFFER"}`,
    )
    console.log(
      `        extended by ${extenders.length} unit(s) from [${[...new Set(extLibs)].join(" | ")}]` +
        ` -> same-library rule ${sameLibWins ? "RESOLVES" : "does NOT resolve"} it`,
    )
    if (extenders.length > 0 && extenders.length <= 4)
      for (const e of extenders) console.log(`          extender: ${e.name} @ ${relative(CORPUS, String(e.defUri))}`)
  }

}

console.log(`\nTOTAL colliding names: ${totalCollisions} · reached by an EXTENDS: ${totalReached}`)
