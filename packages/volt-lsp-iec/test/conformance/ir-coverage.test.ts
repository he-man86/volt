/**
 * WHICH IR THE TESTS ACTUALLY BUILD — axis (a) of the coverage measurement.
 *
 * Every other gate asks whether the two backends AGREE, or whether a program lowers. None of them asks which IR the
 * suite has ever produced, and that is a different question with a sharper answer: a node kind or a builtin nothing
 * constructs is a path both backends implement and neither has been shown to implement CORRECTLY. `emit.ts` and
 * `interp.ts` each carry a `switch` over these; an arm no test reaches is an arm free to be wrong.
 *
 * This walks every conformance fixture and every corpus body, lowers it, and counts the node kinds and builtin names
 * that come out. The uncovered ones are NAMED in the output rather than summarised, because the list is the work.
 *
 * Floors, not exact figures — a new fixture may legitimately cover one more. They only go up, so a refactor that
 * quietly stops producing a node kind fails here.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { declarationAttributes, isGraphicalBody, memberAttributes, parseSource, parseStatements, type TopLevel, unitAttributes } from "../../src/syntax/index.js"
import { buildSymbolTable, scopeForUnit } from "../../src/symbols/index.js"
import { lowerSource, lowerUnit } from "../../src/transpile/lower/index.js"
import type { IrPou, IrRoutine, IrStmt } from "../../src/transpile/ir/index.js"
import { scanLibraryManifests } from "../../src/workspace-refs.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"

/** Every node kind the IR defines — `IrExpr` and `IrStmt`, from `ir.ts`. Kept by hand so ADDING one shows up here. */
const EXPR_KINDS = ["const", "load", "binary", "unary", "convert", "builtin", "invoke", "dispatch"] as const
const STMT_KINDS = ["assign", "if", "switch", "loop", "break", "continue", "return", "call", "eval"] as const
const BUILTINS = [
  "max", "min", "limit", "sel", "trunc", "abs", "expt", "shl", "shr", "rol", "ror", "mux",
  "sqrt", "ln", "log", "exp", "sin", "cos", "tan", "asin", "acos", "atan",
  "len", "left", "right", "mid", "concat", "insert", "delete", "replace", "find",
] as const

/**
 * Floors, measured 2026-09-18: EVERY node kind and EVERY builtin is built by something. That is the good outcome and
 * it is worth pinning at full — there is no arm of either backend's `switch` that no test has ever reached.
 */
const COVERED_EXPR_KINDS = 8
const COVERED_STMT_KINDS = 9
const COVERED_BUILTINS = 31

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

const isRunnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
  u.kind === "program" || u.kind === "function_block"

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

function census(): { kinds: Set<string>; builtins: Set<string> } {
  const kinds = new Set<string>()
  const builtins = new Set<string>()

  for (const t of ALL_TESTS) {
    const fixtures = withDependencies(t, ALL_TESTS).filter((f) => f.source !== "")
    const gvls = fixtures.filter((f) => f.kind === "gvl").map((f) => ({ uri: `${f.pouName}.gvl`, source: f.source }))
    const source = [...fixtures.filter((f) => f.kind !== "gvl").map((f) => f.source), plcPrgSource(t)].join("\n")
    try {
      const { pou } = lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls])
      if (pou !== undefined) fromPou(pou, kinds, builtins)
    } catch {
      // a throw is `lowering-totality`'s to report
    }
  }

  const CORPUS = join(import.meta.dir, "..", "..", "test-corpus")
  for (const projectDir of readdirSync(CORPUS).filter((n) => statSync(join(CORPUS, n)).isDirectory())) {
    const files = walk(join(CORPUS, projectDir)).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      try {
        const parseResult = parseSource(source)
        return parseResult.errors.length > 0 ? [] : [{ file, source, parseResult }]
      } catch {
        return []
      }
    })
    const project = buildSymbolTable(
      files.map(({ file, source, parseResult }) => ({ uri: file, parseResult, source })),
      scanLibraryManifests(join(CORPUS, projectDir)),
    )
    const attributes = new Map<object, Set<string>>(
      files.flatMap(({ source, parseResult }) => [
        ...unitAttributes(parseResult, source),
        ...memberAttributes(parseResult, source),
        ...declarationAttributes(parseResult, source),
      ]),
    )
    for (const { parseResult } of files)
      for (const unit of parseResult.units.filter(isRunnable)) {
        const scope = scopeForUnit(project, unit)
        if (scope === undefined || isGraphicalBody(unit.body)) continue
        if (parseStatements(unit.body).statements.length === 0) continue
        try {
          const { pou } = lowerUnit(unit, scope, project, attributes)
          if (pou !== undefined) fromPou(pou, kinds, builtins)
        } catch {
          // likewise
        }
      }
  }
  return { kinds, builtins }
}

let cached: ReturnType<typeof census> | undefined
const result = (): ReturnType<typeof census> => (cached ??= census())

describe("which IR the suite actually builds", () => {
  test("EXPRESSION kinds — an arm no test reaches is an arm free to be wrong", () => {
    const { kinds } = result()
    const missing = EXPR_KINDS.filter((k) => !kinds.has(k))
    console.log(`  [ir] expressions ${EXPR_KINDS.length - missing.length}/${EXPR_KINDS.length}${missing.length ? ` — never built: ${missing.join(", ")}` : ""}`)
    expect(EXPR_KINDS.length - missing.length).toBeGreaterThanOrEqual(COVERED_EXPR_KINDS)
  }, 240_000)

  test("STATEMENT kinds", () => {
    const { kinds } = result()
    const missing = STMT_KINDS.filter((k) => !kinds.has(k))
    console.log(`  [ir] statements ${STMT_KINDS.length - missing.length}/${STMT_KINDS.length}${missing.length ? ` — never built: ${missing.join(", ")}` : ""}`)
    expect(STMT_KINDS.length - missing.length).toBeGreaterThanOrEqual(COVERED_STMT_KINDS)
  }, 240_000)

  test("BUILTINS — each is a switch arm in BOTH backends", () => {
    const { builtins } = result()
    const missing = BUILTINS.filter((b) => !builtins.has(b))
    console.log(`  [ir] builtins ${BUILTINS.length - missing.length}/${BUILTINS.length}${missing.length ? ` — never built: ${missing.join(", ")}` : ""}`)
    expect(BUILTINS.length - missing.length).toBeGreaterThanOrEqual(COVERED_BUILTINS)
  }, 240_000)
})
