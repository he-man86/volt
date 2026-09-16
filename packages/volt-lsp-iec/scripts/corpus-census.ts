/**
 * What the CORPUS contains that the FIXTURE catalog does not — the work list for new fixtures.
 *
 *   bun run scripts/corpus-census.ts
 *
 * The corpus is the LAST check, not the specification (user, 2026-09-16): a construct real projects use belongs in a
 * fixture, where it is recorded from the IDE and replayed by the LSP and both transpiler backends, rather than merely
 * compiled once. This walks both sides with the same parser and the same coarse feature keys — a statement or expression
 * kind, an operator, a literal kind, a called ALL-CAPS name, a declared type or section, an `{attribute '…'}` — and
 * prints what only the corpus has, then what the corpus writes often and the fixtures barely.
 *
 * The keys are deliberately coarse, so a gap names a CONSTRUCT and not a spelling. A name it reports that turns out to
 * be a library FB instance (`TON1`, `R_TRIG1`) is not a language gap; everything else is.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { parseSource, parseStatements, isGraphicalBody, type ParseResult } from "../src/syntax/index.js"
import { SOURCE_EXTENSION_SET } from "../src/source-extensions.js"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : SOURCE_EXTENSION_SET.has(extname(p).toLowerCase()) ? [p] : []
  })

/** Every feature key a source shows — deliberately coarse, so a gap is a construct and not a spelling. */
function featuresOf(source: string, result: ParseResult, into: Map<string, number>): void {
  const bump = (k: string) => into.set(k, (into.get(k) ?? 0) + 1)
  const walkNode = (node: unknown, inStatements: boolean): void => {
    if (Array.isArray(node)) return node.forEach((n) => walkNode(n, inStatements))
    if (node === null || typeof node !== "object") return
    const n = node as Record<string, unknown>
    const kind = n.kind
    if (typeof kind === "string") {
      if (inStatements) bump(`stmt/expr:${kind}`)
      if (kind === "literal" && typeof n.literalKind === "string") bump(`literal:${n.literalKind}`)
      if (kind === "binary" && typeof n.op === "string") bump(`op:${n.op}`)
      if (kind === "unary" && typeof n.op === "string") bump(`unary:${n.op}`)
      if (kind === "call") {
        const callee = n.callee as { kind?: string; name?: string } | undefined
        if (callee?.kind === "ident_expr" && typeof callee.name === "string" && /^[A-Z_0-9]+$/.test(callee.name)) bump(`call:${callee.name.toUpperCase()}`)
      }
      if (kind === "named_type" && typeof (n.name as { text?: string })?.text === "string") {
        const t = (n.name as { text: string }).text.toUpperCase()
        if (/^(ANY|ANY_\w+|__U?X(INT|WORD)|LWORD|LTIME|LDATE|LTOD|LDT|BIT)$/.test(t)) bump(`type:${t}`)
        if (n.subrange !== undefined) bump("type:SUBRANGE")
      }
      if (kind === "array_type" && Array.isArray(n.dims)) bump(`array:${n.dims.length}d`)
      if (kind === "pointer_type") bump("type:POINTER")
      if (kind === "reference_type") bump("type:REFERENCE")
    }
    for (const [key, child] of Object.entries(n)) if (key !== "span" && key !== "tokens") walkNode(child, inStatements)
  }
  for (const unit of result.units) {
    bump(`unit:${unit.kind}`)
    const u = unit as unknown as Record<string, unknown>
    if (u.extends !== undefined) bump("decl:EXTENDS")
    if (Array.isArray(u.implements) && u.implements.length > 1) bump("decl:IMPLEMENTS_MANY")
    else if (Array.isArray(u.implements) && u.implements.length === 1) bump("decl:IMPLEMENTS")
    for (const s of (u.varSections as { sectionKind: string; constant?: boolean; retain?: boolean; persistent?: boolean }[] | undefined) ?? []) {
      bump(`section:${s.sectionKind}`)
      if (s.constant) bump("section:CONSTANT")
      if ((s as { retain?: boolean }).retain) bump("section:RETAIN")
      if ((s as { persistent?: boolean }).persistent) bump("section:PERSISTENT")
    }
    walkNode(u.varSections, false)
    const body = u.body as { kind?: string } | undefined
    if (body?.kind === "body") {
      if (isGraphicalBody(body as never)) bump("body:graphical")
      else walkNode(parseStatements(body as never).statements, true)
    }
    for (const accessor of ["getter", "setter"]) {
      const a = u[accessor] as { body?: unknown; varSections?: unknown } | undefined
      if (a?.body !== undefined) walkNode(parseStatements(a.body as never).statements, true)
    }
  }
  for (const m of source.matchAll(/\{attribute\s+'([\w-]+)'/gi)) bump(`attribute:${m[1]!.toLowerCase()}`)
}

const corpus = new Map<string, number>()
for (const project of readdirSync(CORPUS).filter((n) => statSync(join(CORPUS, n)).isDirectory()))
  for (const file of walk(join(CORPUS, project))) {
    const source = readFileSync(file, "utf8")
    try {
      const result = parseSource(source)
      if (result.errors.length === 0) featuresOf(source, result, corpus)
    } catch {
      continue
    }
  }

const fixtures = new Map<string, number>()
for (const t of ALL_TESTS) {
  if (t.source === "") continue
  try {
    featuresOf(t.source, parseSource(t.source), fixtures)
  } catch {
    continue
  }
}

const missing = [...corpus].filter(([k]) => !fixtures.has(k)).sort((a, b) => b[1] - a[1])
console.log(`corpus features: ${corpus.size} · fixtures: ${fixtures.size} · IN CORPUS, NOT IN FIXTURES: ${missing.length}\n`)
for (const [k, n] of missing) console.log(`  ${String(n).padStart(6)}  ${k}`)
const thin = [...corpus].filter(([k, n]) => n >= 200 && (fixtures.get(k) ?? 0) <= 2).sort((a, b) => b[1] - a[1])
console.log(`\ncommon in the corpus (>=200) but barely in the fixtures (<=2):`)
for (const [k, n] of thin.slice(0, 30)) console.log(`  ${String(n).padStart(6)}  ${k.padEnd(28)} fixtures: ${fixtures.get(k) ?? 0}`)
