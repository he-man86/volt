/**
 * THE CORPUS WALK — each project's files parsed once and every question asked of that one parse before the next project
 * is read (`corpus.test.ts` explains why there is one walk), shared by the three corpus suites.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import {
  isPlainStNetworkBody,
  isStBody,
  parseDocument,
  sourceStatements,
  type BodySpan,
  type TopLevel,
  type TypeExpr,
  type ParseResult,
} from "../../../src/frontend/syntax/index.js"
import { isLibrarySymbol, lookupLocal, scopeForUnit, type Scope } from "../../../src/frontend/symbols/index.js"
import { libraryRank } from "../../../src/frontend/symbols/index.js"
import { lowerUnit } from "../../../src/transpile/index.js"
import type { IrPou, IrRoutine, IrStmt } from "../../../src/transpile/ir/index.js"
import { formatDocument } from "../../../src/services/index.js"
import { corpusVendor, loweringProject, walkSources } from "./project.js"
import { misplaced } from "../../../src/transpile/lower/diagnostics/diagnostic.js"
import type { Vendor } from "../../../src/analysis/index.js"

export const CORPUS = join(import.meta.dir, "..", "..", "..", "test-corpus")

export const hasCorpus = existsSync(CORPUS)

/** The lowering walk is the slow one — 29k files parsed, bound and lowered. Measured ~80s. */
export const LOWERING_TIMEOUT = 240_000

/** Sorted for the same reason as `walk`: the projects are walked in this order into one shared tally. */
export const projectDirs = (): string[] =>
  hasCorpus
    ? readdirSync(CORPUS)
        .filter((p) => statSync(join(CORPUS, p)).isDirectory())
        .sort()
    : []

// ─── question 1 + 3: one parse of every file, every question asked of it ─────────────────────────────────────

/** Every declaration body held by a unit (POU body + property accessors + nested namespace units). */
export function bodiesOf(u: TopLevel): BodySpan[] {
  const out: BodySpan[] = []
  const anyU = u as unknown as Record<string, unknown>
  // Only a token BodySpan (POU body) — NOT TypeDecl's structured DutBody, which also lives on `.body`.
  const b = anyU.body as { kind?: string } | undefined
  if (b?.kind === "body") out.push(b as BodySpan)
  if (u.kind === "property") {
    if (u.getter) out.push(u.getter.body)
    if (u.setter) out.push(u.setter.body)
  }
  if (u.kind === "namespace") for (const child of u.units) out.push(...bodiesOf(child))
  return out
}

/** A span/token-free, key-sorted, body-statement-embedded string key for AST equivalence. */
export function astKey(value: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm)
    if (x !== null && typeof x === "object") {
      const obj = x as Record<string, unknown>
      // A body's `%LANGUAGE` line and a member's `%FOLDER` stand outside its tokens, so they are compared here too:
      // comparing the statements alone passed a printer that deleted both from every file.
      if (obj.kind === "body") {
        // So is what stands between the declaration and the line (`leading`), out of the tokens for the same reason (its
        // line endings are layout, which the printer writes as `\n`).
        const line = (obj as { noSlot?: unknown; languageLine?: { statement: unknown; folder?: string; leading?: string } }).languageLine
        return {
          kind: "body",
          noSlot: norm((obj as { noSlot?: unknown }).noSlot ?? null),
          languageLine: line === undefined ? null : norm({ statement: line.statement, folder: line.folder ?? null, leading: line.leading?.replace(/\r\n/g, "\n") ?? null }),
          st: norm(sourceStatements(obj as never).statements), // as written: every conditional branch
        }
      }
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(obj).sort()) {
        if (k === "span" || k === "tokens") continue
        out[k] = norm(obj[k])
      }
      return out
    }
    return typeof x === "bigint" ? `#${x}` : x
  }
  return JSON.stringify(norm(value))
}

/** Every `kind` and every builtin `name` anywhere in a value, however nested. */
export function collect(node: unknown, kinds: Set<string>, builtins: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, kinds, builtins)
    return
  }
  if (node === null || typeof node !== "object") return
  const record = node as Record<string, unknown>
  if (typeof record.kind === "string") kinds.add(record.kind)
  if (record.kind === "builtin" && typeof record.name === "string") builtins.add(record.name)
  for (const [key, child] of Object.entries(record)) {
    if (key === "type" || key === "span") continue // a Type has its own `kind`, which is not an IR node's
    collect(child, kinds, builtins)
  }
}

export function fromPou(pou: IrPou, kinds: Set<string>, builtins: Set<string>): void {
  collect(pou.body as readonly IrStmt[], kinds, builtins)
  collect((pou.init ?? []) as readonly IrStmt[], kinds, builtins)
  for (const r of (pou.routines ?? []) as readonly IrRoutine[]) collect(r.body, kinds, builtins)
  for (const l of pou.layouts ?? []) collect(l.body ?? [], kinds, builtins)
}

// the same set `lower-completeness.ts` counts, so the gate and the ratchet walk identical ground
/** The symbol kinds that can answer "what type is this name?" — the same set `resolveNamedType` filters to. */
export const TYPE_SYMBOL_KINDS: ReadonlySet<string> = new Set(["function_block", "program", "interface", "type"])

/** Every NAMED type a unit's declarations reach, unwrapping ARRAY OF / POINTER TO / REFERENCE TO, plus its
 *  `EXTENDS` base. Names only — this asks which NAME was written, not what it resolves to. */
export function namedTypesIn(unit: TopLevel): Set<string> {
  const out = new Set<string>()
  const sections = (unit as { varSections?: { decls?: { type?: TypeExpr }[] }[] }).varSections ?? []
  for (const section of sections)
    for (const decl of section.decls ?? []) {
      let t = decl.type
      for (let i = 0; i < 8 && t !== undefined; i++) {
        if (t.kind === "named_type") {
          if (t.name?.text !== undefined && t.name.text !== "") out.add(t.name.text)
          break
        }
        t =
          t.kind === "array_type"
            ? t.element
            : t.kind === "pointer_type" || t.kind === "reference_type"
              ? t.target
              : undefined
      }
    }
  const base = (unit as { extends?: { text?: string } }).extends?.text
  if (base !== undefined && base !== "") out.add(base)
  return out
}

export const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

export interface Pass {
  files: number
  /** question 1 */
  parseFailures: string[]
  stBodies: number
  materializeFailures: string[]
  /** LD/FBD bodies in plain-ST network text (openspec network-text-st 2.1: the corpus is pulled through the plain-ST
   *  writer) — read by the ST parser, so each is in `stBodies` and its parse in `materializeFailures` too. */
  networkStBodies: number
  formatFailures: string[]
  extendsBases: number
  /** question 3 */
  bodies: number
  lowered: number
  routines: number
  routinesFromRunning: number
  /** `file :: name` for each PROJECT declaration whose type name has two or more candidates that tie at the
   *  best precedence rank AND do not hold the same declaration text. */
  ambiguous: string[]
  throws: string[]
  /** Each lowering diagnostic whose uri is no file of its project or whose span is not one of that file
   *  (`lower/diagnostics/diagnostic.ts` `misplaced`, openspec lowering-diagnostic-uri). */
  incoherent: string[]
  codes: Set<string>
  kinds: Set<string>
  builtins: Set<string>
}

/**
 * ONE WALK. Each project's files are parsed once, then every question is asked of that one parse before the next
 * project is read. Done on first use rather than in a `beforeAll`: a `beforeAll` has its own timeout that an
 * 80-second sweep quietly blows, and the failure it produces names no test.
 */
let cached: Pass | undefined

export function pass(): Pass {
  if (cached !== undefined) return cached
  const p: Pass = {
    files: 0,
    parseFailures: [],
    stBodies: 0,
    materializeFailures: [],
    networkStBodies: 0,
    formatFailures: [],
    extendsBases: 0,
    bodies: 0,
    lowered: 0,
    routines: 0,
    routinesFromRunning: 0,
    ambiguous: [],
    throws: [],
    incoherent: [],
    codes: new Set(),
    kinds: new Set(),
    builtins: new Set(),
  }
  /** The METHOD/ACTION bodies a lowering POU actually LOWERS, and the subset reached from one that RUNS. The
   *  contract said "none reachable" until this measured it; a routine lowers when a lowering POU calls it. */
  const routines = new Set<string>()
  const routinesFromRunning = new Set<string>()
  for (const projectName of projectDirs()) walkProject(p, join(CORPUS, projectName), routines, routinesFromRunning)
  p.routines = routines.size
  p.routinesFromRunning = routinesFromRunning.size
  cached = p
  return p
}


/** One project: every file read (question 1), then its one symbol table bound and lowered (questions 1 and 3). */
function walkProject(p: Pass, dir: string, routines: Set<string>, routinesFromRunning: Set<string>): void {
  const vendor = corpusVendor(dir)
  const parsed = walkSources(dir).map((file) => {
    const source = readFileSync(file, "utf8")
    return { file, source, parseResult: parseDocument(file, source, { networkText: true, unicodeIdentifiers: false }, vendor) }
  })
  p.files += parsed.length

  for (const f of parsed) readFile(p, f, vendor)

  // ── ONE symbol table, two questions: the binder links EXTENDS across files, and lowering runs against it ──
  // Built from the files that PARSED. A parse gap is question 1's to report, not lowering's — a unit built from
  // a broken parse would fail there for a reason that has nothing to do with the transpiler. While question 1 is
  // green this is every file, so the binder sees exactly what it always did; if it ever is not, question 1 fails
  // first and names the file.
  const clean = parsed.filter((x) => x.parseResult.errors.length === 0)
  // A library the repo has written runs its ST (`libraries/`); any other stays bodyless and is refused as `call-library`.
  const lowering = loweringProject(dir, parsed.map(({ file, source, parseResult }) => ({ uri: file, source, parseResult })))
  p.extendsBases += lowering.project.children.filter((c) => c.baseScope !== undefined).length
  ambiguousDeclarations(p, clean, lowering.project)
  lowerPous(p, lowering, routines, routinesFromRunning)
}

/** Question 1 over one file: it parses, its bodies materialize (ST and network text), and it formats back. */
function readFile(p: Pass, { file, source, parseResult }: { file: string; source: string; parseResult: ParseResult }, vendor: Vendor): void {
  // ── every file parses with zero declaration errors ──
  if (parseResult.errors.length > 0) p.parseFailures.push(`${file}: ${parseResult.errors[0]?.message}`)

  // ── every ST body materializes, network text included ──
  for (const u of parseResult.units)
    for (const body of bodiesOf(u)) {
      if (body.tokens.length === 0) continue
      // Which parser reads a body is what its %LANGUAGE line states (`isStBody`) — never the text's first token. A
      // read-only body (CFC/SFC/IL, LD|FBD UNSUPPORTED) is read by none and counted by none.
      if (!isStBody(body)) continue
      p.stBodies += 1
      if (isPlainStNetworkBody(body)) p.networkStBodies += 1
      // the body AS WRITTEN, every conditional branch in: what the vendor compiles depends on a world, the text
      // parsing does not — and a refused body is no excuse for a parse gap (frontend-conformance 2.7)
      const bp = sourceStatements(body)
      if (!bp.ok) p.materializeFailures.push(`${file}: ${bp.firstError}`)
    }

  // ── the formatter re-emits valid ST that re-parses to an EQUIVALENT AST ──
  // Proves the formatter never changes meaning (span/token-free, body statements embedded, key-order-insensitive).
  const formatted = formatDocument({ uri: file, source, parseResult })
  const reparsed = parseDocument(file, formatted, { networkText: true, unicodeIdentifiers: false }, vendor)
  if (reparsed.errors.length > 0) p.formatFailures.push(`${file}: formatted output has parse errors`)
  else if (astKey(parseResult.units) !== astKey(reparsed.units)) p.formatFailures.push(`${file}: AST changed after formatting`)
}

/**
 * ── ambiguity: a PROJECT declaration whose type name several libraries answer to ──────────────────
 * Same walk, same parse — this file's own rule. Library files are skipped: diagnostics never run on
 * them, and a library naming its own dependency's type is the ordinary case precedence settles.
 */
function ambiguousDeclarations(p: Pass, clean: readonly { file: string; parseResult: ParseResult }[], lowerProject: Scope): void {
  for (const { file, parseResult } of clean) {
    if (isLibrarySymbol({ uri: file })) continue
    for (const unit of parseResult.units)
      for (const name of namedTypesIn(unit)) {
        const cands = lookupLocal(lowerProject, name).filter((x) => TYPE_SYMBOL_KINDS.has(x.kind))
        if (cands.length < 2) continue
        const ranks = cands.map((c) => libraryRank(lowerProject, c.uri, file))
        const best = Math.min(...ranks)
        const tied = cands.filter((_, i) => ranks[i] === best)
        if (tied.length < 2) continue
        // A tie between IDENTICAL declarations is not ambiguity — one library re-exporting another's
        // element, which is most of them. Only a tie whose candidates DIFFER is a real coin toss.
        const texts = tied.map((c) => readFileSync(c.uri, "utf8").split(String.fromCharCode(13)).join("").trim())
        if (texts.every((t) => t === texts[0])) continue
        // FORWARD SLASHES. `relative` hands back the platform's separator, so pinning the raw string
        // made this list a Windows artefact — it matched locally and failed every Linux run with the
        // identical eleven findings spelled differently. The finding is portable; the spelling was not.
        p.ambiguous.push(`${relative(CORPUS, file).split(String.fromCharCode(92)).join("/")} :: ${name}`)
      }
  }
}

/** Question 3 over one project: the PROJECT's POUs lowered; a library element is reached when project code calls it, and
 *  is not the customer's code to count. */
function lowerPous(p: Pass, lowering: ReturnType<typeof loweringProject>, routines: Set<string>, routinesFromRunning: Set<string>): void {
  const lowerProject = lowering.project
  // every file the project is lowered from, by uri — what a diagnostic's file must be one of
  const sources = new Map(lowering.files.map((f) => [f.uri, f.source]))
  for (const { uri: file, parseResult } of lowering.files.filter((f) => !isLibrarySymbol(f)))
    for (const unit of parseResult.units.filter(isRunnable)) {
      const scope = scopeForUnit(lowerProject, unit)
      if (scope === undefined) continue
      // a body that is not ST: the network pipeline owns a graphical one (plain-ST network text included, which no lowering
      // runs yet), a read-only one has none
      if (!isStBody(unit.body) || isPlainStNetworkBody(unit.body)) continue
      // the reach denominator is a body with STATEMENTS — a declaration-only POU lowers trivially and executes
      // nothing, so counting it would flatter the figure
      const hasCode = sourceStatements(unit.body).statements.length > 0
      if (hasCode) p.bodies++
      try {
        const { pou, diagnostics } = lowerUnit(unit, scope, lowering)
        if (hasCode && pou !== undefined) p.lowered++
        for (const r of pou?.routines ?? []) {
          routines.add(`${file}:${r.key}`)
          if (hasCode) routinesFromRunning.add(`${file}:${r.key}`)
        }
        for (const d of diagnostics ?? []) p.codes.add(d.code)
        p.incoherent.push(...misplaced(diagnostics, (uri) => sources.get(uri)).map((line) => `${relative(CORPUS, file)} :: ${line}`))
        if (pou !== undefined) fromPou(pou, p.kinds, p.builtins)
      } catch (error) {
        const name = "name" in unit && unit.name !== undefined ? String((unit.name as { text: string }).text) : "?"
        p.throws.push(`${relative(CORPUS, file)} :: ${name} — ${(error as Error).message}`)
      }
    }
}


// ─── question 2: the LSP invents nothing ─────────────────────────────────────────────────────────────────────

/**
 * THE REAL ORACLE. Ground truth is `test-corpus/<project>/expected-build.<vendor>.json`, captured by
 * `scripts/record-corpus-build.ts` from a LIVE build. Until a project is recorded its gate SKIPS — the comparison
 * cannot run without the compiler's answer.
 *
 * This replaced a "zero errors on the corpus" assumption that was simply false: the projects are NOT clean, they
 * carry real build errors, warnings and typo'd attributes ([[corpus-not-clean-build-oracle]]). Two old assertions
 * encoded that false premise and both are subsumed here — a catalog-gap FP or a spurious error shows up as a false
 * positive, with the whitespace and library-gate handling those blanket assertions never had.
 *
 * BOTH SEVERITIES, BOTH DIRECTIONS. An LSP warning the build never emitted is as much a false positive as a
 * phantom error — that is how C0371 sat mislabelled as a deferred error while CODESYS warned on it 1300+ times.
 * The MISSING direction (a build warning we do not emit) is REPORTED, not failed: the LSP is deliberately a
 * curated subset of the compiler, not a re-implementation of it.
 */

/**
 * ONE NORMALIZER, and it is the stricter of the two this merge found.
 *
 * Several diagnostics EMBED the offending source line (C0139 "The code '<line>' has no effect"). The LSP keeps the
 * source whitespace (tabs between tokens), the IDE strips it — so the SAME warning renders differently
 * (`InPosition\t\t;` vs `InPosition;`). Collapsing whitespace, and treating whitespace ADJACENT to `;` as
 * insignificant, makes the identity the semantic content rather than the formatting.
 *
 * `build-conformance.test.ts` used `m.replace(/\s+/g, "")` — strip EVERY space — and `warning-conformance.test.ts`
 * used this one, on the same messages, in two gates that compared overlapping sets. Stripping all whitespace is
 * strictly more permissive: it makes `a b` and `ab` the same message. Measured across all five recorded projects
 * on 2026-09-20 the two agree exactly (0 false positives either way), so the stricter one is what survives.
 */
export const norm = (m: string): string =>
  m
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, ";")
    .trim()
