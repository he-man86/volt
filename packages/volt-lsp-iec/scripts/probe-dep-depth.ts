/**
 * DO ANY AMBIGUOUS NAMES NEED A TRANSITIVE DEPENDENCY? — the measurement behind `visibleFolders`'s rule.
 *
 * For every name with more than one top-level candidate that some unit actually references, reports the
 * smallest dependency DEPTH at which the asker's library reaches a candidate: 0 = its own, 1 = a declared
 * dependency, 2+ = only through a dependency's dependency, ∞ = never. Direct-only visibility is correct
 * exactly when nothing needs depth 2 or more.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { parseSource } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import { manifestsByTitle } from "../src/symbols/library-namespace.js"
import { libraryOf } from "../src/symbols/symbol.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"
import { scanLibraryManifests } from "../src/workspace-refs.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
if (!existsSync(CORPUS)) throw new Error("no corpus")

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

const tally = new Map<string, number>()

for (const projectName of readdirSync(CORPUS).filter((p) => statSync(join(CORPUS, p)).isDirectory()).sort()) {
  const dir = join(CORPUS, projectName)
  const files = walk(dir)
  const manifests = scanLibraryManifests(dir)
  const project = buildSymbolTable(
    files.map((file) => {
      const source = readFileSync(file, "utf8")
      return { uri: file, source, parseResult: parseSource(source) }
    }),
    manifests,
  )
  const byTitle = manifestsByTitle(manifests)
  const byFolder = new Map(manifests.map((m) => [m.folder.toLowerCase(), m]))

  /** BFS over DEPENDENCIES: folder -> depth, from one library. */
  const depths = (start: string): Map<string, number> => {
    const seen = new Map<string, number>([[start, 0]])
    let frontier = [start]
    for (let d = 1; d <= 8 && frontier.length > 0; d++) {
      const next: string[] = []
      for (const f of frontier)
        for (const dep of byFolder.get(f)?.dependencies ?? []) {
          const m = byTitle.get(dep.toLowerCase())
          const folder = m?.folder.toLowerCase()
          if (folder === undefined || seen.has(folder)) continue
          seen.set(folder, d)
          next.push(folder)
        }
      frontier = next
    }
    return seen
  }
  const depthCache = new Map<string, Map<string, number>>()
  const depthsOf = (f: string) => {
    let d = depthCache.get(f)
    if (d === undefined) {
      d = depths(f)
      depthCache.set(f, d)
    }
    return d
  }

  // names with several candidates
  const cands = new Map<string, string[]>()
  for (const c of project.children) {
    if (c.defUri === undefined) continue
    const k = c.name.toLowerCase()
    const l = cands.get(k)
    if (l === undefined) cands.set(k, [c.defUri])
    else l.push(c.defUri)
  }
  // every EXTENDS is a real reference we can attribute to an asking file
  for (const c of project.children) {
    if (c.extendsName === undefined || c.defUri === undefined) continue
    const list = cands.get(c.extendsName)
    if (list === undefined || list.length < 2) continue
    const mine = libraryOf({ uri: c.defUri })?.toLowerCase()
    let best = Infinity
    for (const uri of list) {
      const theirs = libraryOf({ uri })?.toLowerCase()
      const d = mine === undefined
        ? (theirs === undefined ? 0 : 1)
        : theirs === undefined ? Infinity : (depthsOf(mine).get(theirs) ?? Infinity)
      if (d < best) best = d
    }
    const key = best === Infinity ? "unreachable" : `depth ${best}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
}
for (const [k, v] of [...tally.entries()].sort()) console.log(`${k}\t${v}`)
