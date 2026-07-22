/**
 * Real-project corpus gate for the syntax layer (A.3). Runs over this package's committed
 * 5-project corpus (`test-corpus/`, moved here from the legacy package). Two hard gates:
 *   1. Every ST-source file parses with ZERO declaration errors.
 *   2. Every ST (non-graphical) POU body materializes fully into the statement tree.
 * Graphical (FBD/LD) bodies — a `NETWORK …` token stream — are layer F's job, not ST.
 *
 * Note: the format-roundtrip half of the A.3 gate (`parse(format(x)) ≡ parse(x)`) lands
 * with the formatter (E.3); the fuzz gate lives in fuzz.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { isTrivia, parseSource, parseStatements, type BodySpan, type TopLevel } from "../../src/syntax/index.js"
import { buildSymbolTable } from "../../src/symbols/index.js"
import {
  computeSemanticDiagnostics,
  deadPous,
  deadMemberSpans,
  inDeadMember,
  messagesFor,
  ownerPou,
  resolveConfig,
} from "../../src/analysis/index.js"
import { loadWorkspaceRefs, loadTaskRoots } from "../../src/workspace-refs.js"
import { WorkspaceStore } from "../../src/server/workspace-store.js"
import { documentDiagnostics } from "../../src/server/diagnostics.js"
import { allowedCode } from "../lsp/diagnostic-codes.js"
import { formatDocument } from "../../src/services/index.js"
import { parseVgBody, computeVgDiagnostics } from "../../src/graphical/index.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"

const CORPUS_ROOT = join(import.meta.dir, "..", "..", "test-corpus")

// Per-test budget for the full-corpus passes (O(files × checks)). Kept at 120s: this budget was adequate
// until `checkDataRecursion` regressed to rebuilding the whole-project composition graph per file (O(files ×
// project size) — it silently pushed the diagnostic passes past 120s and TIMED OUT, which read as a spurious
// failure while `scripts/corpus-fp.ts` — no timeout — stayed green. Root-caused + fixed (the graph is now
// memoized per project); a full pass is back to ~30s, so 120s holds with headroom. If it times out again,
// suspect a new O(n²) — profile per check (PROFILE_CHECKS=1) rather than raising this.
const CORPUS_TIMEOUT = 120_000

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

/** Every declaration body held by a unit (POU body + property accessors + nested namespace units). */
function bodiesOf(u: TopLevel): BodySpan[] {
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

/** A body is graphical (VG) — not ST — when its first meaningful token is `NETWORK`. */
function isGraphical(body: BodySpan): boolean {
  const first = body.tokens.find((t) => !isTrivia(t.kind))
  return first !== undefined && first.text.toUpperCase() === "NETWORK"
}

const hasCorpus = existsSync(CORPUS_ROOT)

describe.skipIf(!hasCorpus)("real-project corpus (referenced from volt-lsp-iec)", () => {
  const files = hasCorpus ? walk(CORPUS_ROOT) : []

  test("corpus is present and non-trivial", () => {
    expect(files.length).toBeGreaterThanOrEqual(1500)
  })

  test("every ST-source file parses with zero declaration errors", () => {
    const failures: string[] = []
    for (const f of files) {
      const errs = parseSource(readFileSync(f, "utf8")).errors
      if (errs.length > 0) failures.push(`${f}: ${errs[0]?.message}`)
    }
    expect(failures).toEqual([])
  }, CORPUS_TIMEOUT)

  test("every ST body materializes fully into the statement tree (100%)", () => {
    let bodies = 0
    const failures: string[] = []
    for (const f of files) {
      for (const u of parseSource(readFileSync(f, "utf8")).units) {
        for (const body of bodiesOf(u)) {
          if (body.tokens.length === 0 || isGraphical(body)) continue
          bodies += 1
          const bp = parseStatements(body)
          if (!bp.ok) failures.push(`${f}: ${bp.firstError}`)
        }
      }
    }
    expect(bodies).toBeGreaterThan(2000)
    expect(failures).toEqual([])
  }, CORPUS_TIMEOUT)

  // Layer F (F.2): every graphical (VG) body in the corpus is valid IDE-exported FBD/LD, so the VG parser
  // must find its networks and emit ZERO structural errors (VG_PARSE / VG_NETWORK_NOT_CLOSED). Duplicate
  // name/network warnings aren't structural parse failures and aren't counted here.
  test("VG parser: zero structural errors across every graphical corpus body", () => {
    let vgBodies = 0
    const failures: string[] = []
    const STRUCTURAL = new Set(["VG_PARSE", "VG_NETWORK_NOT_CLOSED"])
    for (const f of files) {
      for (const u of parseSource(readFileSync(f, "utf8")).units) {
        for (const body of bodiesOf(u)) {
          if (body.tokens.length === 0 || !isGraphical(body)) continue
          vgBodies += 1
          const vg = parseVgBody(body)
          if (vg.networks.length === 0) failures.push(`${f}: no networks parsed`)
          for (const d of vg.diagnostics)
            if (STRUCTURAL.has(d.code)) failures.push(`${f} [${d.code}] ${d.message}`)
        }
      }
    }
    expect(vgBodies).toBeGreaterThan(0)
    expect(failures).toEqual([])
  }, CORPUS_TIMEOUT)

  // Layer B: the binder must survive real workspace input at scale, per project (cross-indexed),
  // link EXTENDS bases, and never throw.
  test("binder ingests each corpus project and links EXTENDS bases", () => {
    let totalBases = 0
    for (const project of readdirSync(CORPUS_ROOT)) {
      const dir = join(CORPUS_ROOT, project)
      if (!statSync(dir).isDirectory()) continue
      const inputs = walk(dir).map((uri) => ({ uri, parseResult: parseSource(readFileSync(uri, "utf8")), source: "" }))
      const scope = buildSymbolTable(inputs)
      expect(scope.children.length).toBeGreaterThan(0)
      totalBases += scope.children.filter((c) => c.baseScope !== undefined).length
    }
    // Real PLC projects use inheritance — some EXTENDS must have resolved across files.
    expect(totalBases).toBeGreaterThan(0)
  }, CORPUS_TIMEOUT)

  // RETIRED — superseded by `build-conformance.test.ts`, the ground-truth oracle (LSP errors+warnings ⊆ the
  // real IDE build, per project). Two tests lived here and both encoded the FALSE "corpus compiles clean"
  // premise ([[corpus-not-clean-build-oracle]]): (1) "zero error-severity false positives" — the projects are
  // NOT clean (they carry real build errors/warnings and typo'd attributes), and it lacked the library-file
  // gate the server applies, so it flagged precompiled-library patterns; (2) "pragma catalog covers every
  // attribute (0 hits)" — real projects legitimately contain attribute TYPOS (`noe`/`qualified_oly`/`strit`),
  // which SHOULD hit. build-conformance subsumes both: an LSP diagnostic the build never emitted (a catalog-gap
  // FP, or a spurious error) shows up there as a false positive, with the whitespace/truncation/library-gate
  // handling those blanket assertions never had.

  // Diagnostic-identity invariants over the FULL LSP wire path (documentDiagnostics — the exact bytes a
  // client receives), folded into the corpus so every real file is checked, not just synthetic cases:
  //   1. every code is a Cnnnn / VG_* / parse (no code) / KNOWN_UNMAPPED (see test/lsp/diagnostic-codes.ts)
  //   2. no two diagnostics on one document share (range, code) — the duplicate PR #86 fixed can't recur
  test("every corpus diagnostic has a valid code identity and no (range,code) duplicates", () => {
    const messages = messagesFor("codesys")
    const offenders: string[] = []
    const dupes: string[] = []
    for (const project of readdirSync(CORPUS_ROOT)) {
      const dir = join(CORPUS_ROOT, project)
      if (!statSync(dir).isDirectory()) continue
      const projFiles = walk(dir)
      if (projFiles.length === 0) continue
      const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
      store.workspaceRefs = loadWorkspaceRefs(dir)
      store.taskRoots = loadTaskRoots(dir)
      store.seedDisk(projFiles.map((p) => ({ uri: p, source: readFileSync(p, "utf8") })))
      for (const d of store.workspace()) {
        const seen = new Set<string>()
        for (const diag of documentDiagnostics(store, messages, d)) {
          if (!allowedCode(diag.code)) offenders.push(`${project}${d.uri.slice(dir.length)} [${String(diag.code)}]`)
          const r = diag.range
          const key = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}|${String(diag.code)}`
          if (seen.has(key)) dupes.push(`${project}${d.uri.slice(dir.length)} ${key}`)
          seen.add(key)
        }
      }
    }
    expect(offenders).toEqual([])
    expect(dupes).toEqual([])
  }, CORPUS_TIMEOUT) // heavy: full LSP diagnostic pass over every corpus file

  // A.3 format-roundtrip gate: `parse(format(x)) ≡ parse(x)` across the whole corpus. Formatting must
  // re-emit valid ST that re-parses to an EQUIVALENT AST (span/token-free, body statements embedded,
  // object-key-order-insensitive). Proves the formatter never changes meaning.
  test("formatter round-trips every corpus file (parse(format(x)) ≡ parse(x))", () => {
    const failures: string[] = []
    for (const f of files) {
      const source = readFileSync(f, "utf8")
      const parseResult = parseSource(source)
      const formatted = formatDocument({ uri: f, source, parseResult })
      const reparsed = parseSource(formatted)
      if (reparsed.errors.length > 0) {
        failures.push(`${f}: formatted output has parse errors`)
      } else if (astKey(parseResult.units) !== astKey(reparsed.units)) {
        failures.push(`${f}: AST changed after formatting`)
      }
    }
    expect(failures).toEqual([])
  }, CORPUS_TIMEOUT)
})

/** A span/token-free, key-sorted, body-statement-embedded string key for AST equivalence. */
function astKey(value: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm)
    if (x !== null && typeof x === "object") {
      const obj = x as Record<string, unknown>
      if (obj.kind === "body") return { kind: "body", st: norm(parseStatements(obj as never).statements) }
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
