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
import {
  declarationAttributes,
  isGraphicalBody,
  memberAttributes,
  parseSource,
  parseActive,
  type Span,
  type TopLevel,
  unitAttributes,
} from "../../syntax/index.js"
import { buildSymbolTable, lookup, lookupMember, type Scope, scopeForUnit } from "../../symbols/index.js"
import { stored } from "./convert.js"
import { resolveNamedType, type Type, UNKNOWN } from "../../types/index.js"
import { type IrPou, type IrRoutine, type IrStmt, type LoweredPou, peelArray, type Place } from "../ir/index.js"
import { Lowering, newShared } from "./lowering.js"
import { declareVars, storageOf } from "./storage.js"
import { lowerBlock } from "./statements.js"
import { calledLayout, calledRoutine } from "./calls.js"

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
  attributes: ReadonlyMap<object, ReadonlySet<string>> = new Map(),
): LoweredPou {
  if (unit.kind !== "program" && unit.kind !== "function_block")
    return { diagnostics: [{ code: "unit-kind", message: `${unit.kind} is not lowered yet`, span: unit.span }] }

  // A graphical body holds no statements, so `parseActive` returns an empty list rather than an error —
  // which would lower to a POU that "succeeds" and does nothing. Refuse it explicitly; FBD/LD reach the
  // backend through network text, not through here.
  if (isGraphicalBody(unit.body))
    return { diagnostics: [{ code: "graphical-body", message: "a graphical body is not lowered here", span: unit.span }] }

  const lowering = new Lowering(scope, project, newShared(attributes, unit.name.text))
  lowering.isRoot = true
  lowering.frameContext = `POU:${unit.name.text.toUpperCase()}`
  let body: IrStmt[]
  if (unit.kind === "function_block") body = rootInstance(lowering, unit)
  else {
    declareVars(lowering, unit.varSections)
    const parsed = parseActive(unit.body)
    if (!parsed.ok)
      return { diagnostics: [{ code: "parse", message: parsed.firstError ?? "body did not parse", span: unit.span }] }
    body = lowerBlock(lowering, parsed.statements)
  }
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
  const init = initStep(lowering, unit.span)
  if (init === undefined || lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }
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

  // an FB's own struct already carries its name, so the POU that holds one instance of it is named apart
  const name = unit.kind === "function_block" ? `${unit.name.text}__root` : unit.name.text
  const pou: IrPou = { name, slots: lowering.frame, body, layouts, routines, globals: lowering.globals, ...(init.length > 0 ? { init } : {}), span: unit.span }
  return { pou, diagnostics: [] }
}

const INIT_ATTRIBUTE = "call_after_global_init_slot"

/**
 * The init step: each instance's `call_after_global_init_slot` METHOD, run once before the first scan (conformance
 * `state_call_after_global_init_counts` — once per instance, however many scans follow). Instances are found through the
 * frame, nested instances and struct fields included, and the method is resolved by the instance's own type. One the walk
 * does not reach — an array element, a global, a routine's local — is refused: whether and when it would run is not
 * measured. Neither is the order between instances; the frame's is taken, as no recorded case can tell them apart.
 */
function initStep(lw: Lowering, span: Span): IrStmt[] | undefined {
  type Fb = Extract<Type, { kind: "function_block" }>
  const initMethod = (fb: Fb) => {
    for (let s = fb.scope; s !== undefined; s = s.baseScope)
      for (const list of s.symbols.values())
        for (const sym of list)
          if (sym.kind === "method" && lw.attributes.get(sym.ast as TopLevel)?.has(INIT_ATTRIBUTE)) return lookupMember(fb.scope!, sym.name)
    return undefined
  }
  // {attribute 'instance-path'} (user decision 2026-09-15): the STRING holds the instance's path from the project tree —
  // the device folder (before `Plc Logic`), the application folder (after it), then the instance hierarchy from the POU.
  // The simulator's own reads `Device.Sim.Device.Application…`, a segment the tree does not hold.
  const root = lookup(lw.project, lw.shared.root)?.symbol
  const tree = (root?.uri ?? "").split(/[\\/]/)
  const logic = tree.findIndex((segment) => segment.toLowerCase() === "plc logic")
  const application = logic > 0 && logic + 2 < tree.length ? `${tree[logic - 1]}.${tree[logic + 1]}` : undefined
  const pathFields = (fb: Fb): string[] => {
    const names: string[] = []
    for (let unit = lw.bodies.get(fb.name.toUpperCase())?.unit; unit !== undefined; ) {
      for (const section of unit.varSections)
        for (const decl of section.decls) if (lw.attributes.get(decl)?.has("instance-path")) names.push(...decl.names.map((n) => n.text))
      const base = unit.kind === "function_block" ? unit.extends : undefined
      unit = base === undefined ? undefined : lw.bodies.get(base.text.toUpperCase())?.unit
    }
    return names
  }
  const known = new Map<string, boolean>()
  const reaches = (t: Type): boolean => {
    const array = peelArray(t)
    if (array !== undefined) return reaches(array.element)
    if (t.kind !== "function_block" && t.kind !== "struct") return false
    const key = t.name.toUpperCase()
    if (known.has(key)) return known.get(key)!
    known.set(key, false)
    const own = t.kind === "function_block" && (initMethod(t) !== undefined || pathFields(t).length > 0)
    const result = own || (lw.layouts.get(key)?.fields ?? []).some((f) => reaches(f.type))
    known.set(key, result)
    return result
  }
  const unreached = (where: string): undefined =>
    lw.bail("attr-init-unreached", `an instance with a ${INIT_ATTRIBUTE} method or an instance-path in ${where}, which the init step does not reach`, span)
  const out: IrStmt[] = []
  const visit = (place: Place): boolean => {
    const t = place.type
    if (!reaches(t)) return true
    if (peelArray(t) !== undefined) return unreached("an array") ?? false
    if (t.kind !== "function_block" && t.kind !== "struct") return true
    const paths = t.kind === "function_block" ? pathFields(t) : []
    if (paths.length > 0) {
      if (application === undefined) return lw.bail("attr-instance-path", `${t.name}'s instance-path needs the project tree (Device/Plc Logic/Application), which this source is not in`, span) ?? false
      if (root?.kind !== "program") return lw.bail("attr-instance-path", `an FB lowered on its own has no instance path`, span) ?? false
      const hierarchy = [lw.frame[place.slot]!.name, ...place.path.flatMap((step) => (step.kind === "field" ? [step.name] : []))]
      const text = [application, root.name, ...hierarchy].join(".")
      for (const name of paths) {
        const field = lw.layouts.get(t.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === name.toUpperCase())
        if (field === undefined || field.type.kind !== "elementary" || field.type.elem.family !== "string")
          return lw.bail("attr-instance-path", `${name} carries instance-path but is not a STRING`, span) ?? false
        const target: Place = { ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }
        out.push({ kind: "assign", target, value: { kind: "const", value: stored(text, field.type), type: field.type, span }, span })
      }
    }
    const sym = t.kind === "function_block" ? initMethod(t) : undefined
    if (t.kind === "function_block" && sym !== undefined) {
      const routine: IrRoutine | undefined = calledRoutine(lw, sym, t, span)
      if (routine === undefined) return false
      if (routine.inputs.length > 0 || routine.inouts.length > 0) return lw.bail("attr-init-inputs", `${sym.name} takes arguments`, span) ?? false
      out.push({ kind: "eval", value: { kind: "invoke", routine: routine.key, instance: place, inputs: [], inouts: [], type: UNKNOWN, span }, span })
    }
    for (const field of lw.layouts.get(t.name.toUpperCase())?.fields ?? [])
      if (!visit({ ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type })) return false
    return true
  }
  for (const [slot, frameSlot] of lw.frame.entries()) if (!visit({ slot, path: [], type: frameSlot.type, span })) return undefined
  if (lw.globals.some((g) => reaches(g.type))) return unreached("the globals")
  for (const r of lw.routines.values()) if (r.state === "lowered" && r.routine.locals.some((l) => reaches(l.type))) return unreached(`${r.routine.name}'s locals`)
  return out
}

/**
 * An FB lowered on its own runs as what it only ever is — an instance: the POU holds one, named as the FB, and each scan
 * calls it. Its body then sees THIS^, its bases' fields, SUPER^ and its own methods exactly as a called instance's does
 * (phase 3½). It was lowered as if it were a PROGRAM, where none of those exist, so every derived FB the corpus holds
 * stopped at its `SUPER^()` (128 of them). An FB with VAR_IN_OUT is refused: only a caller binds one.
 */
function rootInstance(lw: Lowering, unit: Extract<TopLevel, { kind: "function_block" }>): IrStmt[] {
  const type = storageOf(lw, resolveNamedType(unit.name.text, lw.project))
  const layout = type.kind === "function_block" ? calledLayout(lw, type.name, unit.span) : undefined
  if (layout === undefined) return []
  if ((layout.inouts ?? []).length > 0) {
    lw.bail("root-inout", `${unit.name.text} has VAR_IN_OUT, which only a caller binds`, unit.span)
    return []
  }
  lw.slot(unit.name, type, "VAR")
  return [{ kind: "call", instance: { slot: lw.frame.length - 1, path: [], type, span: unit.span }, fb: layout.name, inouts: [], span: unit.span }]
}

/** A referenced library's materialized declaration file — `uri` must keep its `Library Manager/<library>/` path. */
export interface LibraryFile {
  uri: string
  source: string
}

/** Parse, bind and lower one source string, against the library files a project would reference. The test/CLI path.
 *  `uri` places the source in a project tree — where an `instance-path` takes its device and application from. */
export function lowerSource(source: string, name?: string, libraries: readonly LibraryFile[] = [], uri = "transpile://source"): LoweredPou {
  const parseResult = parseSource(source)
  if (parseResult.errors.length > 0) {
    const first = parseResult.errors[0]!
    return { diagnostics: [{ code: "parse", message: first.message, span: first.span }] }
  }
  const project = buildSymbolTable([
    { uri, parseResult, source },
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
  return lowerUnit(unit, scope, project, new Map<object, Set<string>>([...unitAttributes(parseResult, source), ...memberAttributes(parseResult, source), ...declarationAttributes(parseResult, source)]))
}
