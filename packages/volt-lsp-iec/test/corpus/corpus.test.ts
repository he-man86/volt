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
import { formatDocument } from "../../src/services/index.js"
import { parseVgBody, computeVgDiagnostics } from "../../src/graphical/index.js"

const CORPUS_ROOT = join(import.meta.dir, "..", "..", "test-corpus")
const ST_EXTS = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (ST_EXTS.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

/** Every declaration body held by a unit (POU body + property accessors + nested namespace units). */
function bodiesOf(u: TopLevel): BodySpan[] {
  const out: BodySpan[] = []
  const anyU = u as Record<string, unknown>
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
  }, 120_000)

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
  }, 120_000)

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
  }, 120_000)

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
  }, 120_000)

  // Layer D (D.3): the analysis checks must produce ZERO error-severity diagnostics on the corpus.
  // The corpus compiles clean in the IDE, so every error-severity diagnostic here is a false positive.
  // (Warnings — narrowing, author message pragmas — are legitimate and not counted.)
  test("semantic checks emit zero error-severity false positives on the corpus", () => {
    const config = resolveConfig({ vendor: "codesys" })
    const falsePositives: string[] = []
    for (const project of readdirSync(CORPUS_ROOT)) {
      const dir = join(CORPUS_ROOT, project)
      if (!statSync(dir).isDirectory()) continue
      const inputs = walk(dir).map((uri) => {
        const source = readFileSync(uri, "utf8")
        return { uri, source, parseResult: parseSource(source) }
      })
      const scope = buildSymbolTable(inputs)
      const references = loadWorkspaceRefs(dir)
      const messages = messagesFor("codesys")
      // Dead code rides through in the corpus now (the bridge no longer omits it); the LSP suppresses its
      // diagnostics structurally by default, so match the server and skip a file whose owner POU is dead.
      const dead = deadPous(inputs, loadTaskRoots(dir))
      const deadMembers = deadMemberSpans(inputs, dead)
      for (const f of inputs) {
        const owner = ownerPou(f.parseResult)
        if (owner !== undefined && dead.has(owner)) continue
        const dm = deadMembers.get(f.uri) // spans of this file's excluded/uncalled methods
        for (const d of computeSemanticDiagnostics({
          parseResult: f.parseResult,
          source: f.source,
          project: scope,
          config,
          references,
        })) {
          if (d.severity === "error" && !inDeadMember(d.span, dm))
            falsePositives.push(`${project}${f.uri.slice(dir.length)} [${d.code}] ${d.message}`)
        }
        // VG code-correctness checks (sink type-checks) must also be false-positive-free on real graphical code.
        for (const d of computeVgDiagnostics(f, scope, messages, references)) {
          if (d.severity === "error" && !d.code.startsWith("VG_") && !inDeadMember(d.span, dm))
            falsePositives.push(`${project}${f.uri.slice(dir.length)} [${d.code}] ${d.message}`)
        }
      }
    }
    expect(falsePositives).toEqual([])
  }, 120_000) // heavy: all checks (incl. member-access inference) over every corpus file

  // The opt-in unknown-attribute lint is only as complete as the pragma catalog. Enable it across the corpus
  // and require ZERO hits: every attribute real projects use must be catalogued, else it would false-positive.
  test("unknown-attribute lint: pragma catalog covers every attribute in the corpus (0 hits)", () => {
    const config = resolveConfig({ vendor: "codesys", lints: { unknownAttribute: true } })
    const hits: string[] = []
    for (const project of readdirSync(CORPUS_ROOT)) {
      const dir = join(CORPUS_ROOT, project)
      if (!statSync(dir).isDirectory()) continue
      const inputs = walk(dir).map((uri) => {
        const source = readFileSync(uri, "utf8")
        return { uri, source, parseResult: parseSource(source) }
      })
      const scope = buildSymbolTable(inputs)
      for (const f of inputs) {
        for (const d of computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project: scope, config }))
          if (d.code === "unknown-attribute") hits.push(`${project}${f.uri.slice(dir.length)} ${d.message}`)
      }
    }
    expect(hits).toEqual([])
  }, 120_000) // heavy: a second full-corpus diagnostic pass with the lint enabled

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
  }, 120_000)
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
