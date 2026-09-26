/**
 * A CORPUS PROJECT, READ ONCE AND BOUND FOR LOWERING — the one loader the corpus gate and the lowering scripts share.
 *
 * It was four copies (the gate, `lower-completeness`, `probe-lowering-refusals`, `probe-order-dependence`) of the same
 * walk-parse-bind, and all four built the symbol table without saying which units came from a library. Lowering then
 * ran every bodyless library element as an empty body, and the corpus reach counted the invented meaning. One loader
 * built on `prepareProject` cannot leave that out, and it hands each library's manifest to the library repo so a
 * library the repo has written runs its ST, exactly as `lowerSource` does for a fixture.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { parseSource } from "../../../src/syntax/index.js"
import { prepareProject, type LoweringProject, type ParsedFile } from "../../../src/transpile/index.js"
import { SOURCE_EXTENSION_SET } from "../../../src/source-extensions.js"
import { scanLibraryManifests } from "../../../src/workspace-refs.js"
import { withImplementations } from "../../../libraries/index.js"

/**
 * Every source file under `dir`, IN A DETERMINISTIC ORDER.
 *
 * <b>The order is load-bearing and that is not obvious.</b> The symbol table is built from this array, and
 * lowering reaches a routine through it — so the walk order decides which of two same-named units a reference
 * binds to, and therefore how many routines lower. Measured: reversing this array moves the corpus figure from
 * 558 routines to 574, on one machine, over identical bytes.
 *
 * `readdirSync` returns whatever the filesystem hands back — alphabetical on NTFS, directory order on ext4 —
 * so without this the measurement was a property of the DEVELOPER'S DISK. It read 558 on Windows and 582 in
 * CI, and the exact-figure gate failed on every Linux run while passing locally, which is the worst shape a
 * gate can have: green for the person who could fix it.
 *
 * Sorted on the path with separators NORMALIZED, because `\` (0x5C) and `/` (0x2F) sort either side of `-`
 * and `.` — sorting raw paths would have swapped sibling order between the two platforms.
 */
export function walkSources(dir: string, extensions: ReadonlySet<string> = SOURCE_EXTENSION_SET): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkSources(p, extensions))
    else if (extensions.has(extname(p).toLowerCase())) out.push(p)
  }
  const key = (p: string) => p.split("\\").join("/")
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

/** Every source file under `dir`, read and parsed, in `walkSources` order. */
export function parseProject(dir: string): ParsedFile[] {
  return walkSources(dir).map((uri) => {
    const source = readFileSync(uri, "utf8")
    return { uri, source, parseResult: parseSource(source) }
  })
}

/**
 * The project lowering reads: its files that PARSE — a parse gap is the parser's to report, not lowering's — with each
 * library the repo has written for the version the project resolved swapped for its ST, bound by `prepareProject`.
 * `parsed` is the project's own parse, reused for every file the repo leaves as it is.
 *
 * A REPO BODY THAT DOES NOT PARSE THROWS, as `libraryBase` does for the conformance replay. Filtered with the project's
 * own files, it vanished: its declaration was already swapped out, so the element was simply gone, every call to it
 * read as `type-unknown`, and the corpus reach moved for a reason nothing named.
 */
export function loweringProject(dir: string, parsed: readonly ParsedFile[] = parseProject(dir)): LoweringProject & { files: ParsedFile[] } {
  const manifests = walkSources(dir, new Set([".library"])).map((uri) => ({ uri, source: readFileSync(uri, "utf8") }))
  const byUri = new Map(parsed.map((f) => [f.uri, f]))
  const files = withImplementations([...parsed, ...manifests])
    .filter((f) => !f.uri.toLowerCase().endsWith(".library"))
    .map((f) => {
      const own = byUri.get(f.uri)
      if (own !== undefined && own.source === f.source) return own
      const body = { ...f, parseResult: parseSource(f.source) }
      if (body.parseResult.errors.length > 0) throw new Error(`the library repo's ${f.uri} did not parse: ${body.parseResult.errors[0]!.message}`)
      return body
    })
    .filter((f) => f.parseResult.errors.length === 0)
  return { ...prepareProject(files, scanLibraryManifests(dir)), files }
}
