/**
 * THE CORPUS — 29,359 files of real customer code, and the three things they can tell us that no fixture can.
 *
 * A fixture is a question somebody thought to ask. This is the other half: code nobody wrote for a test, which
 * therefore contains what engineers actually write rather than what an adversary would. It is the ONLY input that
 * can find a gap nobody has imagined, and the only one that cannot answer what anything MEANS — there is no oracle
 * here except the IDE's own recorded build.
 *
 * THREE QUESTIONS, ONE WALK:
 *
 *   1. THE LSP CAN READ IT      every file parses, every ST body materializes into statements, every graphical
 *                               body parses as network text, the binder links EXTENDS across files, and the
 *                               formatter round-trips (`parse(format(x)) ≡ parse(x)`).
 *   2. THE LSP INVENTS NOTHING  every error and warning it emits is one the IDE's own build also emitted; every
 *                               code is a valid identity; no document carries a duplicate (range, code).
 *   3. LOWERING IS TOTAL        nothing throws — `src/transpile/index.ts` states that invalid input ends in a
 *                               `LowerDiagnostic`, never a throw and never an invented meaning — and the reach
 *                               figures that contract quotes are what is measured.
 *
 * WHY ONE FILE. This was four (`corpus`, `build-conformance`, `warning-conformance`, `lowering-totality`) and they
 * walked the corpus four times, the first of them five times within itself — a fresh `parseSource` of all 29k files
 * per assertion. The parse is now done ONCE per project and every question asked of it; only the heavy LSP
 * diagnostic pass was already shared (`support/diagnostics.ts`), and it still is.
 *
 * It was five, and the fifth is the reason this rule is written down. `ir-coverage.test.ts` walked the corpus a
 * SECOND time to ask which IR the suite builds — the same files, the same symbol tables, the same `lowerUnit`
 * call, for a different tally. Two walks is not only slow: under load the second one blew its own 240s timeout
 * while passing in 66s alone, which reads as a failure in whatever test happened to be running. It was folded
 * into `lowering-totality`'s walk, and that walk is now folded into this one.
 *
 * WHAT THE CORPUS CANNOT PROVE. It contains no invalid code and only the constructs its authors happened to use, so
 * a pass here is EVIDENCE, not proof. Two throws found by review are unreachable from it and are pinned beside the
 * code that answers them (`src/transpile/lower/totality.test.ts`); whether enough is being ASKED at all is
 * `test/conformance/suite.test.ts`.
 *
 * MEMORY, deliberately. The walk holds ONE project's parse results at a time and accumulates only counts and
 * failure strings. Holding all 29k at once is what a naive "parse everything first" would do.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import {
  declarationAttributes,
  isGraphicalBody,
  isTrivia,
  memberAttributes,
  parseSource,
  parseStatements,
  unitAttributes,
  type BodySpan,
  type TopLevel,
} from "../../src/syntax/index.js"
import { buildSymbolTable, scopeForUnit } from "../../src/symbols/index.js"
import { lowerUnit } from "../../src/transpile/index.js"
import { LOWER_CODES, LOWER_CODE_PREFIXES } from "../../src/transpile/ir/codes.js"
import type { IrPou, IrRoutine, IrStmt } from "../../src/transpile/ir/index.js"
import { allowedCode } from "../../src/server/diagnostic-codes.js"
import { formatDocument } from "../../src/services/index.js"
import { parseNetworkText } from "../../src/network/index.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"
import { scanLibraryManifests } from "../../src/workspace-refs.js"
import { projectDocuments } from "./support/diagnostics.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { assembleFixture } from "../conformance/support/fixture-units.js"
import { STANDARD_LIBRARY } from "../conformance/support/standard-library.js"
import { lowerSource } from "../../src/transpile/lower/index.js"

const CORPUS = join(import.meta.dir, "..", "..", "test-corpus")
const hasCorpus = existsSync(CORPUS)

// Per-pass budget. Kept at 120s: this was adequate until `checkDataRecursion` regressed to rebuilding the whole
// project composition graph per file (O(files × project size)) — it pushed the diagnostic passes past 120s and
// TIMED OUT, which read as a spurious failure while `scripts/corpus-fp.ts` (no timeout) stayed green. Root-caused
// and fixed (the graph is memoized per project). If it times out again, suspect a new O(n²) and profile per check
// (PROFILE_CHECKS=1) rather than raising this.
const CORPUS_TIMEOUT = 120_000
/** The lowering walk is the slow one — 29k files parsed, bound and lowered. Measured ~80s. */
const LOWERING_TIMEOUT = 240_000

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

const projectDirs = (): string[] =>
  hasCorpus ? readdirSync(CORPUS).filter((p) => statSync(join(CORPUS, p)).isDirectory()) : []

// ─── question 1 + 3: one parse of every file, every question asked of it ─────────────────────────────────────

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

/** A body is graphical (network text) — not ST — when its first meaningful token is `NETWORK`. */
function isGraphical(body: BodySpan): boolean {
  const first = body.tokens.find((t) => !isTrivia(t.kind))
  return first !== undefined && first.text.toUpperCase() === "NETWORK"
}

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

/** Every `kind` and every builtin `name` anywhere in a value, however nested. */
function collect(node: unknown, kinds: Set<string>, builtins: Set<string>): void {
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

function fromPou(pou: IrPou, kinds: Set<string>, builtins: Set<string>): void {
  collect(pou.body as readonly IrStmt[], kinds, builtins)
  collect((pou.init ?? []) as readonly IrStmt[], kinds, builtins)
  for (const r of (pou.routines ?? []) as readonly IrRoutine[]) collect(r.body, kinds, builtins)
  for (const l of pou.layouts ?? []) collect(l.body ?? [], kinds, builtins)
}

// the same set `lower-completeness.ts` counts, so the gate and the ratchet walk identical ground
const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

interface Pass {
  files: number
  /** question 1 */
  parseFailures: string[]
  stBodies: number
  materializeFailures: string[]
  graphicalBodies: number
  networkFailures: string[]
  formatFailures: string[]
  extendsBases: number
  /** question 3 */
  bodies: number
  lowered: number
  routines: number
  routinesFromRunning: number
  throws: string[]
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
function pass(): Pass {
  if (cached !== undefined) return cached
  const p: Pass = {
    files: 0,
    parseFailures: [],
    stBodies: 0,
    materializeFailures: [],
    graphicalBodies: 0,
    networkFailures: [],
    formatFailures: [],
    extendsBases: 0,
    bodies: 0,
    lowered: 0,
    routines: 0,
    routinesFromRunning: 0,
    throws: [],
    codes: new Set(),
    kinds: new Set(),
    builtins: new Set(),
  }
  const STRUCTURAL = new Set(["NETWORK_PARSE", "NETWORK_NOT_CLOSED"])
  /** The METHOD/ACTION bodies a lowering POU actually LOWERS, and the subset reached from one that RUNS. The
   *  contract said "none reachable" until this measured it; a routine lowers when a lowering POU calls it. */
  const routines = new Set<string>()
  const routinesFromRunning = new Set<string>()

  for (const projectName of projectDirs()) {
    const dir = join(CORPUS, projectName)
    const parsed = walk(dir).map((file) => {
      const source = readFileSync(file, "utf8")
      return { file, source, parseResult: parseSource(source) }
    })
    p.files += parsed.length

    for (const { file, source, parseResult } of parsed) {
      // ── every file parses with zero declaration errors ──
      if (parseResult.errors.length > 0) p.parseFailures.push(`${file}: ${parseResult.errors[0]?.message}`)

      // ── every ST body materializes; every graphical body parses as network text ──
      for (const u of parseResult.units)
        for (const body of bodiesOf(u)) {
          if (body.tokens.length === 0) continue
          if (isGraphical(body)) {
            // Layer F: every graphical body in the corpus is valid IDE-exported FBD/LD, so the network-text parser
            // must find its networks and emit ZERO structural errors. Duplicate name/network warnings are not
            // structural parse failures and are not counted.
            p.graphicalBodies += 1
            const vg = parseNetworkText(body)
            if (vg.networks.length === 0) p.networkFailures.push(`${file}: no networks parsed`)
            for (const d of vg.diagnostics) if (STRUCTURAL.has(d.code)) p.networkFailures.push(`${file} [${d.code}] ${d.message}`)
            continue
          }
          p.stBodies += 1
          const bp = parseStatements(body)
          if (!bp.ok) p.materializeFailures.push(`${file}: ${bp.firstError}`)
        }

      // ── the formatter re-emits valid ST that re-parses to an EQUIVALENT AST ──
      // Proves the formatter never changes meaning (span/token-free, body statements embedded, key-order-insensitive).
      const formatted = formatDocument({ uri: file, source, parseResult })
      const reparsed = parseSource(formatted)
      if (reparsed.errors.length > 0) p.formatFailures.push(`${file}: formatted output has parse errors`)
      else if (astKey(parseResult.units) !== astKey(reparsed.units)) p.formatFailures.push(`${file}: AST changed after formatting`)
    }

    // ── ONE symbol table, two questions: the binder links EXTENDS across files, and lowering runs against it ──
    // Built from the files that PARSED. A parse gap is question 1's to report, not lowering's — a unit built from
    // a broken parse would fail there for a reason that has nothing to do with the transpiler. While question 1 is
    // green this is every file, so the binder sees exactly what it always did; if it ever is not, question 1 fails
    // first and names the file.
    const clean = parsed.filter((x) => x.parseResult.errors.length === 0)
    const lowerProject = buildSymbolTable(
      clean.map(({ file, source, parseResult }) => ({ uri: file, parseResult, source })),
      scanLibraryManifests(dir),
    )
    p.extendsBases += lowerProject.children.filter((c) => c.baseScope !== undefined).length
    const attributes = new Map<object, Set<string>>(
      clean.flatMap(({ source, parseResult }) => [
        ...unitAttributes(parseResult, source),
        ...memberAttributes(parseResult, source),
        ...declarationAttributes(parseResult, source),
      ]),
    )
    for (const { file, parseResult } of clean)
      for (const unit of parseResult.units.filter(isRunnable)) {
        const scope = scopeForUnit(lowerProject, unit)
        if (scope === undefined) continue
        if (isGraphicalBody(unit.body)) continue // a graphical body is not ST; the network pipeline owns it
        // the reach denominator is a body with STATEMENTS — a declaration-only POU lowers trivially and executes
        // nothing, so counting it would flatter the figure
        const hasCode = parseStatements(unit.body).statements.length > 0
        if (hasCode) p.bodies++
        try {
          const { pou, diagnostics } = lowerUnit(unit, scope, lowerProject, attributes)
          if (hasCode && pou !== undefined) p.lowered++
          for (const r of pou?.routines ?? []) {
            routines.add(`${file}:${r.key}`)
            if (hasCode) routinesFromRunning.add(`${file}:${r.key}`)
          }
          for (const d of diagnostics ?? []) p.codes.add(d.code)
          if (pou !== undefined) fromPou(pou, p.kinds, p.builtins)
        } catch (error) {
          const name = "name" in unit && unit.name !== undefined ? String((unit.name as { text: string }).text) : "?"
          p.throws.push(`${relative(CORPUS, file)} :: ${name} — ${(error as Error).message}`)
        }
      }
  }
  p.routines = routines.size
  p.routinesFromRunning = routinesFromRunning.size
  cached = p
  return p
}

// ─── question 1: the LSP can read it ─────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasCorpus)("1. the LSP can read real code", () => {
  test("the corpus is present and non-trivial", () => {
    expect(pass().files).toBeGreaterThanOrEqual(1500)
  }, LOWERING_TIMEOUT)

  test("every ST-source file parses with zero declaration errors", () => {
    expect(pass().parseFailures).toEqual([])
  }, LOWERING_TIMEOUT)

  test("every ST body materializes fully into the statement tree (100%)", () => {
    expect(pass().stBodies).toBeGreaterThan(2000)
    expect(pass().materializeFailures).toEqual([])
  }, LOWERING_TIMEOUT)

  test("the network-text parser finds every graphical body's networks, with no structural error", () => {
    expect(pass().graphicalBodies).toBeGreaterThan(0)
    expect(pass().networkFailures).toEqual([])
  }, LOWERING_TIMEOUT)

  test("the binder links EXTENDS bases across files", () => {
    // Real PLC projects use inheritance — some EXTENDS must have resolved across files.
    expect(pass().extendsBases).toBeGreaterThan(0)
  }, LOWERING_TIMEOUT)

  test("the formatter round-trips every file (parse(format(x)) ≡ parse(x))", () => {
    expect(pass().formatFailures).toEqual([])
  }, LOWERING_TIMEOUT)
})

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
const norm = (m: string): string =>
  m
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, ";")
    .trim()

/** The LSP messages the build did NOT emit — the false positives. Normalized message-set ⊆. */
export function buildFalsePositives(lspMessages: readonly string[], buildMessages: Iterable<string>): string[] {
  const build = new Set<string>([...buildMessages].map(norm))
  return lspMessages.filter((m) => !build.has(norm(m)))
}

interface BuildRecording {
  recorded?: { at: string; vendor: string; buildSuccess?: boolean; count: number }
  diagnostics: { severity: string; message: string; line: number }[]
}

// CODESYS truncates its message list at 100 warnings (emits a "More than 100 warnings occured" marker). Past that
// point the build is an INCOMPLETE oracle: an LSP warning absent from it may be a real one that was cut, not a
// false positive — so the ⊆ check is unsound and the project must be re-recorded with the cap raised.
const isTruncated = (msgs: readonly string[]): boolean => msgs.some((m) => /More than \d+ warnings/i.test(m))

// Per-project compiler-warning settings come from the project's own `.projectsettings`, which `volt pull`
// materializes from the IDE's Compiler Warnings dialog — the same file the running server reads. This used to be a
// hand-kept table (pro2193 and lenze-mid, both "C0371 off, confirmed by its owner"), which was true and
// unmaintainable: it had to be rediscovered per project and could not be checked against anything.

describe.skipIf(!hasCorpus)("2. the LSP invents nothing", () => {
  for (const project of projectDirs()) {
    const dir = join(CORPUS, project)
    const recPath = join(dir, "expected-build.codesys.json")
    const has = existsSync(recPath)

    test.skipIf(!has)(`${project}: every LSP error and warning is a real CODESYS build diagnostic`, () => {
      const rec = JSON.parse(readFileSync(recPath, "utf8")) as BuildRecording
      const buildMsgs = rec.diagnostics.map((d) => d.message)
      // A TRUNCATED recording is reported, not thrown. `build-conformance.test.ts` threw here — and that is right
      // when the whole gate depends on completeness, which it no longer does: the ERROR half below is sound
      // against a truncated recording (the cap is on WARNINGS), so throwing would refuse to check the half that
      // still works. What truncation costs is the warning half, and that is what `complete` below withholds.
      if (isTruncated(buildMsgs))
        console.log(
          `  [corpus]   ${project}: build recording is TRUNCATED at CODESYS's 100-warning cap — re-record with the cap raised (Compiler Warnings → max) to gate warnings here.`,
        )

      const ours = projectDocuments(dir, "codesys")
        .flatMap((d) => d.diagnostics)
        .filter((d) => d.severity === DiagnosticSeverity.Error || d.severity === DiagnosticSeverity.Warning)
        .map((d) => d.message)

      // THE COVERAGE REPORT, warnings only — informational. A build that did not compile clean never reaches the
      // warning (typify) phase, so its warning set is incomplete; awa-palletizer carries 129 library-not-found
      // errors. Reported either way, because the list of warnings still to implement is the actionable half.
      const buildWarnings = new Set(rec.diagnostics.filter((d) => d.severity === "warning").map((d) => norm(d.message)))
      const ourWarnings = new Set(
        projectDocuments(dir, "codesys")
          .flatMap((d) => d.diagnostics)
          .filter((d) => d.severity === DiagnosticSeverity.Warning)
          .map((d) => norm(d.message)),
      )
      const missing = [...buildWarnings].filter((m) => !ourWarnings.has(m))
      const buildFailed = rec.recorded?.buildSuccess === false || rec.diagnostics.some((d) => d.severity === "error")
      console.log(
        `  [corpus] ${project} — warnings ours:${ourWarnings.size} build:${buildWarnings.size} · missing(coverage):${missing.length}${buildFailed ? " · BUILD-FAILED" : ""}`,
      )
      if (missing.length > 0) console.log(`  [corpus]   MISSING (build warns, we don't):`, missing.slice(0, 8))

      // THE HARD GATE, and WHICH SEVERITIES it covers depends on whether the build is a complete oracle.
      //
      // An ERROR we emit that the build never emitted is a false positive whatever phase the build stopped in —
      // that half is always gated. A WARNING is different: a build that did not compile clean never reaches the
      // warning (typify) phase, and a capped one cut its list at 100, so in both cases a warning of ours absent
      // from the recording may be a REAL warning the build never got to rather than an invention.
      //
      // `build-conformance.test.ts` gated both severities unconditionally and `warning-conformance.test.ts`
      // skipped the warning half exactly here; merging them is what made the disagreement visible. The sound
      // one wins. It changes nothing today — awa-palletizer is the only build-failed project and the LSP emits
      // no warning on it — but the unsound version fails falsely the first time that stops being true.
      const complete = !buildFailed && !isTruncated(buildMsgs)
      const gated = complete
        ? ours
        : projectDocuments(dir, "codesys")
            .flatMap((d) => d.diagnostics)
            .filter((d) => d.severity === DiagnosticSeverity.Error)
            .map((d) => d.message)
      if (!complete) console.log(`  [corpus]   warning FPs UNCONFIRMED here — the build is an incomplete oracle`)
      expect(buildFalsePositives(gated, buildMsgs)).toEqual([])
    }, CORPUS_TIMEOUT)
  }

  /**
   * Diagnostic-identity invariants over the FULL LSP wire path (`documentDiagnostics` — the exact bytes a client
   * receives), folded into the corpus so every real file is checked rather than synthetic cases:
   *   1. every code is a Cnnnn / NETWORK_* / parse (no code) / KNOWN_UNMAPPED (see `server/diagnostic-codes.ts`)
   *   2. no two diagnostics on one document share (range, code) — the duplicate PR #86 fixed cannot recur
   */
  test("every diagnostic has a valid code identity, and no document repeats a (range, code)", () => {
    const offenders: string[] = []
    const dupes: string[] = []
    for (const project of projectDirs()) {
      const dir = join(CORPUS, project)
      for (const { uri, diagnostics } of projectDocuments(dir, "codesys")) {
        const seen = new Set<string>()
        for (const diag of diagnostics) {
          if (!allowedCode(diag.code)) offenders.push(`${project}${uri.slice(dir.length)} [${String(diag.code)}]`)
          const r = diag.range
          const key = `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}|${String(diag.code)}`
          if (seen.has(key)) dupes.push(`${project}${uri.slice(dir.length)} ${key}`)
          seen.add(key)
        }
      }
    }
    expect(offenders).toEqual([])
    expect(dupes).toEqual([])
  }, CORPUS_TIMEOUT)
})

// The comparison logic is pure and is verified whether or not any recording exists yet.
test("buildFalsePositives: an LSP message absent from the build is a false positive; a present one is not", () => {
  const build = ["'x' is no input of 'FB'", "Cannot convert type 'INT' to type 'BOOL'"]
  expect(buildFalsePositives(["'x' is no input of 'FB'"], build)).toEqual([])
  expect(buildFalsePositives(["No such label 'A'…"], build)).toEqual(["No such label 'A'…"]) // C0371-class: caught
  expect(buildFalsePositives([], build)).toEqual([])
})

test("an embedded source snippet compares equal however it was spaced", () => {
  const build = ["The code 'x.Status.InPosition;' has no effect. Is this the intent?"]
  const lsp = ["The code 'x.Status.InPosition\t\t\t\t\t;' has no effect. Is this the intent?"] // tabs from source
  expect(buildFalsePositives(lsp, build)).toEqual([])
  expect(norm("The code 'a.b\t\t\t;' has\n no effect")).toBe("The code 'a.b;' has no effect")
  expect(norm("The code 'a.b;\r\n' has no effect")).toBe("The code 'a.b;' has no effect")
})

// ─── question 3: lowering is total ───────────────────────────────────────────────────────────────────────────

/**
 * THE DOCUMENTED REACH, from `src/transpile/index.ts`. When a change moves these, update BOTH — the number in
 * `index.ts` is the contract a reader sees, and this is what keeps it true. They are exact rather than a floor on
 * purpose: a floor lets the documented figure rot quietly upward while still "passing".
 */
// 55 -> 56 and 543/14 -> 549/20 on 2026-09-20: a declaration-level `REF=` (`r : REFERENCE TO T REF= x`) now binds
// its target. The parser accepted the operator and did not record WHICH one it was, so every such declaration
// reached lowering as a plain assignment and every read of the reference was refused `pointer-order` — 72 corpus
// POUs stopped hitting that refusal at all (reach 177 -> 105).
const REACH = { bodies: 304, lowered: 56 }
/**
 * The METHOD/ACTION half of the same contract, measured 2026-09-19. `index.ts` said **none reachable** and that was
 * never true: a routine lowers when a POU that lowers calls it, and 543 do. Only 14 come from a POU that RUNS —
 * the rest are lifecycle methods (`FB_Init`, `call_after_global_init_slot`) reached from declaration-only POUs,
 * which is why the claim survived: nobody counted the half that was not zero.
 */
// 549 -> 558 the same day: `declarations/reference-binding.ts` measured that CODESYS binds a reference declared
// with `:=` exactly as it binds one declared with `REF=` (`refdecl_assign_spelling_write` writes 41 through it
// and reads it back from the target), so the TYPE decides rather than the operator — and nine more routines lower.
const ROUTINES = { routines: 558, routinesFromRunning: 20 }

/** Every node kind the IR defines — `IrExpr` and `IrStmt`, from `ir.ts`. Kept by hand so ADDING one shows up here. */
const EXPR_KINDS = ["const", "load", "binary", "unary", "convert", "builtin", "invoke", "dispatch"] as const
const STMT_KINDS = ["assign", "if", "switch", "loop", "break", "continue", "return", "call", "eval"] as const
const BUILTINS = [
  "max", "min", "limit", "sel", "trunc", "abs", "expt", "shl", "shr", "rol", "ror", "mux",
  "sqrt", "ln", "log", "exp", "sin", "cos", "tan", "asin", "acos", "atan",
  "len", "left", "right", "mid", "concat", "insert", "delete", "replace", "find",
] as const

/**
 * Floors, measured 2026-09-18: EVERY node kind and EVERY builtin is built by something. That is the good outcome
 * and it is worth pinning at full — there is no arm of either backend's `switch` that no test has ever reached.
 */
const COVERED_EXPR_KINDS = 8
const COVERED_STMT_KINDS = 9
const COVERED_BUILTINS = 31

/**
 * HOW MANY REGISTERED REFUSAL CODES ANY REAL PROGRAM ACTUALLY PRODUCES.
 *
 * `codes.test.ts` gates the registry STATICALLY — it greps `lower/` for the slugs and checks each resolves. That
 * proves a code is WRITTEN, not that it can be REACHED, and those are different claims: a refusal nothing can
 * produce is either dead code or a construct no test covers, and the registry cannot tell them apart.
 *
 * This walks the conformance fixtures and the whole corpus and records every code that actually comes out. It is a
 * FLOOR, not an exact figure — a new fixture may legitimately reach one more — but it only ever goes up, so a
 * refactor that quietly makes a refusal unreachable fails here.
 */
// 80 -> 79 because a refusal was RETIRED, not because one became unreachable: `var-temp-composite` refused a
// composite VAR_TEMP as "starting it over is not built", and `declarations/section-semantics.ts` measured that it
// behaves exactly as a scalar does (an ARRAY in VAR_TEMP counts 1 after three scans, a VAR one counts 3). The code
// is gone from the registry, so both totals drop by one. The floor only ever goes UP for a code that stops being
// produced; it comes down only when a code stops existing.
// 79 -> 78 for the same reason again: `value-string-order` refused MAX/MIN/LIMIT over a STRING because nothing
// recorded what the vendor orders two strings by. `strings/ordering.ts` recorded it — UNSIGNED, byte by byte, a
// prefix losing — so the refusal is retired and both totals drop by one.
const REACHED_CODES = 78

describe.skipIf(!hasCorpus)("3. lowering is total, and its documented reach is measured", () => {
  test("NOTHING THROWS — invalid input ends in a LowerDiagnostic, never an exception", () => {
    expect(pass().throws).toEqual([])
  }, LOWERING_TIMEOUT)

  test(`REACH — the figures src/transpile/index.ts quotes are what the corpus measures`, () => {
    const p = pass()
    console.log(`  [lowering] ${p.lowered}/${p.bodies} POUs with a body lower; ${p.routines} routines, ${p.routinesFromRunning} of them from a POU that runs`)
    // If this fails after a deliberate coverage change, update BOTH these constants and the paragraph in
    // `src/transpile/index.ts`. The documented reach is a contract a reader relies on; a plan for this very
    // component once justified itself with a figure 470x the real one, which is what this exists to prevent.
    expect({ bodies: p.bodies, lowered: p.lowered }).toEqual(REACH)
    expect({ routines: p.routines, routinesFromRunning: p.routinesFromRunning }).toEqual(ROUTINES)
  }, LOWERING_TIMEOUT)

  test("REFUSAL REACH — a registered code that no real program produces is reported", () => {
    const registered = Object.keys(LOWER_CODES)
    const families = LOWER_CODE_PREFIXES.map((x) => x.prefix)
    const produced = new Set(pass().codes)

    // the fixtures too: many refusals need a shape the corpus does not happen to contain
    for (const t of ALL_TESTS) {
      // assembled exactly as `backends` does it, so both gates read the same program from a fixture
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      try {
        for (const d of lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls]).diagnostics ?? []) produced.add(d.code)
      } catch {
        // a throw is question 3's first assertion, not this one's
      }
    }

    const reached = registered.filter((c) => produced.has(c) || families.some((f) => c.startsWith(f)))
    const never = registered.filter((c) => !reached.includes(c))
    console.log(`  [refusals] ${reached.length} of ${registered.length} registered codes are produced by a real program`)
    console.log(`  [refusals] ${never.length} are not: ${never.slice(0, 8).join(", ")}${never.length > 8 ? ", …" : ""}`)
    expect(reached.length).toBeGreaterThanOrEqual(REACHED_CODES)
  }, LOWERING_TIMEOUT)

  test("IR COVERAGE — every node kind and every builtin the IR defines is built by something", () => {
    const p = pass()
    for (const t of ALL_TESTS) {
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      try {
        const { pou } = lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls])
        if (pou !== undefined) fromPou(pou, p.kinds, p.builtins)
      } catch {
        // as above
      }
    }
    const missingExprs = EXPR_KINDS.filter((k) => !p.kinds.has(k))
    const missingStmts = STMT_KINDS.filter((k) => !p.kinds.has(k))
    const missingBuiltins = BUILTINS.filter((b) => !p.builtins.has(b))
    console.log(`  [ir] expressions ${EXPR_KINDS.length - missingExprs.length}/${EXPR_KINDS.length}${missingExprs.length ? ` — never built: ${missingExprs.join(", ")}` : ""}`)
    console.log(`  [ir] statements ${STMT_KINDS.length - missingStmts.length}/${STMT_KINDS.length}${missingStmts.length ? ` — never built: ${missingStmts.join(", ")}` : ""}`)
    console.log(`  [ir] builtins ${BUILTINS.length - missingBuiltins.length}/${BUILTINS.length}${missingBuiltins.length ? ` — never built: ${missingBuiltins.join(", ")}` : ""}`)
    expect(EXPR_KINDS.length - missingExprs.length).toBeGreaterThanOrEqual(COVERED_EXPR_KINDS)
    expect(STMT_KINDS.length - missingStmts.length).toBeGreaterThanOrEqual(COVERED_STMT_KINDS)
    expect(BUILTINS.length - missingBuiltins.length).toBeGreaterThanOrEqual(COVERED_BUILTINS)
  }, LOWERING_TIMEOUT)
})
