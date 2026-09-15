/**
 * AST → IR. The ONLY place ST semantics are decided; every backend downstream is a printer.
 *
 * Lowering is **total**: it never throws. A construct it cannot represent becomes a `LowerDiagnostic` with a
 * stable code and the POU lowers to nothing — so an untestable POU is reported, never silently wrong, and
 * `scripts/lower-completeness.ts` can count exactly what blocks the corpus.
 *
 * Its input is code CODESYS COMPILES (the contract in `../index.ts`): a rule here exists for valid programs only.
 *
 * It resolves names and types by CONSUMING the frontend, never by re-deriving:
 *   names   → `symbols/` (`lookup`) decides what an identifier IS; lowering decides only where it lives
 *   types   → `types/` (`resolveTypeExpr`, `inferExprType`) — the IR carries the resulting `Type` itself
 *   consts  → `types/` (`constEval`) folds initializers and CASE labels
 *   IEC facts → `types/elementary` (bits · signed · family · rank), the source of truth a backend maps from
 *
 * One file per concern, each a set of `function f(lw: Lowering, …)` over the frame being built:
 *   lower.ts        the entry points (this file)
 *   lowering.ts     the shared state and the `Lowering` frame — bail, slots, temps, type resolution
 *   storage.ts      a type's storage and layout; declarations          constants.ts  literals, enums, folding
 *   places.ts       where a name, field, element or bit lives          convert.ts    conversion nodes
 *   expressions.ts  operators and their promotion                      builtins.ts   value functions, strings
 *   statements.ts   assignment, IF, CASE, loops                        calls.ts      FB bodies, routines, in-outs
 *   pointers.ts     POINTER / REFERENCE (design §9 form 1)             bytes.ts      SIZEOF, ADR differences
 */
import { isGraphicalBody, parseSource, parseStatements, type TopLevel, unitAttributes } from "../../syntax/index.js"
import { buildSymbolTable, type Scope, scopeForUnit } from "../../symbols/index.js"
import type { Type } from "../../types/index.js"
import { type IrPou, type LoweredPou, peelArray } from "../ir/index.js"
import { Lowering, newShared } from "./lowering.js"
import { declareVars } from "./storage.js"
import { lowerBlock } from "./statements.js"

/** A type a backend can store: elementary, a laid-out struct or FB instance, or a sized array of those. */
function representable(t: Type): boolean {
  // a pointer or reference holds its one target's index (design §9 form 1) — a plain integer in both backends
  if (t.kind === "elementary" || t.kind === "struct" || t.kind === "function_block" || t.kind === "pointer" || t.kind === "reference") return true
  const array = peelArray(t)
  return array !== undefined && representable(array.element)
}

/** Lower one already-bound unit. The workspace path: the caller owns the project scope and its index. */
export function lowerUnit(
  unit: TopLevel,
  scope: Scope,
  project: Scope,
  /** Each POU's `{attribute '…'}` names (`syntax/unitAttributes`), for the ones lowering must refuse. */
  attributes: ReadonlyMap<TopLevel, ReadonlySet<string>> = new Map(),
): LoweredPou {
  if (unit.kind !== "program" && unit.kind !== "function_block")
    return { diagnostics: [{ code: "unit-kind", message: `${unit.kind} is not lowered yet`, span: unit.span }] }

  // A graphical body holds no statements, so `parseStatements` returns an empty list rather than an error —
  // which would lower to a POU that "succeeds" and does nothing. Refuse it explicitly; FBD/LD reach the
  // backend through network text, not through here.
  if (isGraphicalBody(unit.body))
    return { diagnostics: [{ code: "graphical-body", message: "a graphical body is not lowered here", span: unit.span }] }

  const lowering = new Lowering(scope, project, newShared(attributes, unit.name.text))
  lowering.isRoot = true
  lowering.frameContext = `POU:${unit.name.text.toUpperCase()}`
  declareVars(lowering, unit.varSections)
  const parsed = parseStatements(unit.body)
  if (!parsed.ok)
    return { diagnostics: [{ code: "parse", message: parsed.firstError ?? "body did not parse", span: unit.span }] }

  const body = lowerBlock(lowering, parsed.statements)
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  // Every construct lowered — but every SLOT (and every field of a layout) also needs a runtime representation. An unused
  // `p : POINTER TO INT` lowered cleanly, then the Rust emitter threw on its type: a backend must accept whatever lowering
  // accepts (transpiler review 2026-09-14). Checked only here, so a POU another construct blocks keeps that blocker's
  // category in the coverage report.
  const layouts = [...lowering.layouts.values()]
  const routines = [...lowering.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine] : []))
  const unrepresentable = [
    ...lowering.frame,
    ...layouts.flatMap((l) => [...l.fields, ...(l.inouts ?? [])]),
    ...routines.flatMap((r) => [...r.locals, ...r.inouts]),
    ...lowering.globals,
  ].find((s) => !representable(s.type))
  if (unrepresentable !== undefined) {
    const kind = unrepresentable.type.kind
    return { diagnostics: [{ code: `slot-${kind}`, message: `${unrepresentable.name} is a ${kind} variable, which has no runtime representation yet`, span: unit.span }] }
  }

  const pou: IrPou = { name: unit.name.text, slots: lowering.frame, body, layouts, routines, globals: lowering.globals, span: unit.span }
  return { pou, diagnostics: [] }
}

/** A referenced library's materialized declaration file — `uri` must keep its `Library Manager/<library>/` path. */
export interface LibraryFile {
  uri: string
  source: string
}

/** Parse, bind and lower one source string, against the library files a project would reference. The test/CLI path. */
export function lowerSource(source: string, name?: string, libraries: readonly LibraryFile[] = []): LoweredPou {
  const parseResult = parseSource(source)
  if (parseResult.errors.length > 0) {
    const first = parseResult.errors[0]!
    return { diagnostics: [{ code: "parse", message: first.message, span: first.span }] }
  }
  const project = buildSymbolTable([
    { uri: "transpile://source", parseResult, source },
    ...libraries.map((l) => ({ uri: l.uri, parseResult: parseSource(l.source), source: l.source })),
  ])
  const runnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
    u.kind === "program" || u.kind === "function_block"
  const unit = parseResult.units
    .filter(runnable)
    .find((u) => name === undefined || u.name.text.toUpperCase() === name.toUpperCase())
  if (unit === undefined) {
    const span = parseResult.units[0]?.span ?? { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
    return { diagnostics: [{ code: "no-unit", message: `no PROGRAM or FUNCTION_BLOCK${name === undefined ? "" : ` named ${name}`}`, span }] }
  }
  const scope = scopeForUnit(project, unit)
  if (scope === undefined)
    return { diagnostics: [{ code: "no-scope", message: `${unit.name.text} did not bind`, span: unit.span }] }
  return lowerUnit(unit, scope, project, unitAttributes(parseResult, source))
}
