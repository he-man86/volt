/**
 * A CORPUS PROJECT, READ ONCE AND BOUND FOR LOWERING — the one loader the corpus gate and the lowering scripts share.
 *
 * It was four copies (the gate, `lower-completeness`, `probe-lowering-refusals`, `probe-order-dependence` (deleted; `git show b2496efb4b:packages/volt-lsp-iec/scripts/probe-order-dependence.ts`)) of the same
 * walk-parse-bind, and all four built the symbol table without saying which units came from a library. Lowering then
 * ran every bodyless library element as an empty body, and the corpus reach counted the invented meaning. One loader
 * built on `prepareProject` cannot leave that out, and it hands each library's manifest to the library repo so a
 * library the repo has written runs its ST, exactly as `lowerSource` does for a fixture.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { parseDocument, parseSource } from "../../../src/frontend/syntax/index.js"
import { prepareProject, type LoweringProject, type ParsedFile } from "../../../src/transpile/index.js"
import { SOURCE_EXTENSION_SET } from "../../../src/source-extensions.js"
import { readSourceText, scanLibraryManifests } from "../../../src/workspace-refs.js"
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
  // ONE sort of the whole list, on keys computed once, and a directory read that already says what each entry is. It
  // was a `statSync` per entry and a re-sort at every level with the key rebuilt per comparison: 2.2 s per walk of the
  // six corpora, against 0.17 s now for the identical list (measured 2026-10-01). A symlink is still followed.
  const out: string[] = []
  const visit = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory() || (e.isSymbolicLink() && statSync(p).isDirectory())) visit(p)
      else if (extensions.has(extname(p).toLowerCase())) out.push(p)
    }
  }
  visit(dir)
  const keyed = out.map((p) => [p.split("\\").join("/"), p] as const)
  return keyed.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, p]) => p)
}

/** Every source file under `dir`, read and parsed, in `walkSources` order. */
export function parseProject(dir: string): ParsedFile[] {
  return walkSources(dir).map((uri) => {
    const source = readSourceText(uri)
    return { uri, source, parseResult: parseDocument(uri, source, { networkText: true }) }
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
      const body = { ...f, parseResult: parseSource(f.source, { networkText: true }) }
      if (body.parseResult.errors.length > 0) throw new Error(`the library repo's ${f.uri} did not parse: ${body.parseResult.errors[0]!.message}`)
      return body
    })
    .filter((f) => f.parseResult.errors.length === 0)
  return { ...prepareProject(files, scanLibraryManifests(dir)), files }
}
