/**
 * WOULD AN "AMBIGUOUS NAME" DIAGNOSTIC FIRE ON REAL CODE? — measured before one is written.
 *
 * A diagnostic the vendor does not also raise is a false positive (see the LSP's parity rule), so the bar is
 * that it stays silent on the corpus's PROJECT files — the only files diagnostics run on at all, since
 * library signatures are skipped wholesale. This walks every declaration in every project file and reports
 * the names where two or more candidates TIE at the best rank, which is the only case precedence cannot
 * settle.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { parseSource, type TopLevel, type TypeExpr } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import { isLibrarySymbol, lookupLocal } from "../src/symbols/symbol.js"
import { libraryRank } from "../src/symbols/precedence.js"
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

const TYPE_KINDS = new Set(["function_block", "program", "interface", "type"])
let projectFiles = 0
let ties = 0
let namesSeen = 0
let multi = 0

for (const projectName of readdirSync(CORPUS).filter((p) => statSync(join(CORPUS, p)).isDirectory()).sort()) {
  const dir = join(CORPUS, projectName)
  const files = walk(dir)
  const project = buildSymbolTable(
    files.map((file) => {
      const source = readFileSync(file, "utf8")
      return { uri: file, source, parseResult: parseSource(source) }
    }),
    scanLibraryManifests(dir),
  )
  for (const file of files) {
    if (isLibrarySymbol({ uri: file })) continue // diagnostics never run on these
    projectFiles++
    const pr = parseSource(readFileSync(file, "utf8"))
    const raw = new Set<string | undefined>()
    // varSections -> decls -> type, which is the real AST. The first pass read a `declarations` property that
    // does not exist, so it saw nothing and reported a confident zero. A probe that cannot find its own input
    // answers every question with "none".
    const collect = (u: TopLevel): void => {
      const sections = (u as { varSections?: { decls?: { type?: TypeExpr }[] }[] }).varSections ?? []
      for (const sec of sections)
        for (const d of sec.decls ?? []) {
          let t = d.type
          // unwrap ARRAY OF / POINTER TO / REFERENCE TO to reach the named element
          for (let i = 0; i < 8 && t !== undefined; i++) {
            if (t.kind === "named_type") { raw.add(t.name?.text); break }
            t = t.kind === "array_type" ? t.element : t.kind === "pointer_type" || t.kind === "reference_type" ? t.target : undefined
          }
        }
      const ext = (u as { extends?: { text: string } }).extends
      if (ext !== undefined) raw.add(ext.text)
    }
    for (const u of pr.units) collect(u)
    const names = new Set([...raw].filter((n): n is string => typeof n === "string" && n !== ""))
    namesSeen += names.size
    for (const name of names) {
      const cands = lookupLocal(project, name).filter((s) => TYPE_KINDS.has(s.kind))
      if (cands.length < 2) continue
      multi++
      const ranks = cands.map((c) => libraryRank(project, c.uri, file))
      const best = Math.min(...ranks)
      if (ranks.filter((r) => r === best).length > 1) {
        ties++
        // THE DECIDING FACT, as with EXTENDS: a tie only MATTERS if the candidates differ. Compare the
        // declaration text of each tied candidate's file.
        const tied = cands.filter((_, i) => ranks[i] === best)
        const texts = tied.map((c) => readFileSync(c.uri, "utf8").split(String.fromCharCode(13)).join("").trim())

        const identical = texts.every((t) => t === texts[0])
        console.log(
          `TIE  ${name}  ${tied.length} candidates  ${identical ? "IDENTICAL" : "*** DIFFER ***"}  in ${relative(CORPUS, file)}`,
        )
        if (!identical) for (const c of tied) console.log(`       ${relative(CORPUS, c.uri)}`)
      }
    }
  }
}
console.log(`
project files: ${projectFiles} · named types seen: ${namesSeen} · with >1 candidate: ${multi} · tied: ${ties}`)
