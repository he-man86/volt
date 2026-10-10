/**
 * The declarations that make a frame's slots: the variables with their initial values, a CONSTANT's wide slot, the
 * VAR_IN_OUT parameters and an `ARRAY[*]`'s hidden bounds.
 */

import { type Lowering, zeroInit } from "../core/lowering.js"
import { nested } from "../core/nested.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import type { Expr, VarDecl, VarSection } from "../../../frontend/syntax/index.js"
import { bindAddress } from "./addresses.js"
import { holdsInstance, storageOf } from "./layout.js"
import { aggregateInit, aliasInit, type DynamicLeaves, elementDefaults, runnableInit, scalarInit } from "../init/initial-values.js"
import {
  constantSlotType,
  elementaryRef,
  elementaryTypeRef,
  elemOf,
  enumDefault,
  inlineEnumDefault,
  promoteForRuntime,
  type Type,
} from "../../../frontend/types/index.js"
import { enumeratorValue } from "../values/enums.js"
import type { IrInit, IrSlot } from "../../ir/index.js"
import { stored } from "../values/convert.js"
import { foldConstant, foldsToConstant } from "../values/fold.js"
import { boundName, openDims } from "../places/bounds.js"
import { initFrame, type PendingInit } from "../init/state.js"

/**
 * `deferInit`: an initializer that is not a constant becomes an INIT-STEP statement instead of a refusal — or, for a
 * VAR_TEMP and a ROUTINE's VAR/VAR_TEMP, a statement of the per-run reset (`resetTemps`).
 *
 * Only a caller that RUNS them asks for it: the POU's own frame and an FB's layout (the init step, `__INIT`), a METHOD's
 * or FUNCTION's locals (`routines.ts`, every call). Defaulting to `false` is what keeps every other declaration — a
 * GVL, a VAR_OUTPUT scratch, a PROPERTY's locals — refusing rather than silently taking the default, which is the bug
 * the refusal was added for.
 */
export function declareVars(lw: Lowering, sections: readonly VarSection[], deferInit = false): void {
  // a VAR_EXTERNAL declares no storage: its name is the global's (`globalPlace`) — a slot here would be a local copy
  for (const sec of sections.filter((s) => s.sectionKind !== "VAR_EXTERNAL"))
    for (const written of sec.decls) declareOne(lw, sec, written, deferInit)
}

/** One declaration: its address, its slot type, its initial value or the init-step statement that will set it. */
function declareOne(lw: Lowering, sec: VarSection, written: VarDecl, deferInit: boolean): void {
  // A refused ADDRESS is the same cascade as a refused initializer: the name is still DECLARED, and skipping
  // the slot only makes every later use report `place-not-local` about the wrong thing. Under a quiet attempt
  // it is skipped for the reason above — a hardware-mapped variable left as ordinary storage, un-diagnosed,
  // is worse than the cascade.
  if (written.at !== undefined) bindAddress(lw, written)
  // resolved ONCE: a refusal `resolve` makes (`string-capacity`) is made once per declaration, and `startValue` asks the
  // same resolved type for its enum default
  const resolved = lw.resolve(written.type)
  const { type, widened } = constantSlot(lw, sec, written, storageOf(lw, resolved, written.type.span))
  // A variable with no initializer of its own starts at its ALIAS type's: `TYPE T : INT := 42;` makes `x : T` 42
  // (conformance `type_dut_alias_with_init`, 43 after `x := x + 1`). It started at 0 — `resolve` sees through the
  // alias to INT and the alias's initializer went with it.
  const decl = { ...written, init: written.init ?? aliasInit(lw, written.type) }
  // AN INITIAL VALUE THAT IS NOT CONSTANT IS NOT A REFUSAL — it is the INIT STEP's. The slot takes its default
  // and the expression is queued in declaration order (`InitFrame.pendingInits`), which is what `ADR(x)`, `THIS`
  // and a call to a user FUNCTION are.
  //
  // WHICH IT IS, IS DECIDED BEFORE ANYTHING IS BUILT. `foldsToConstant` reads the AST and the scope; it lowers
  // nothing. The first version instead ATTEMPTED the fold and treated its failure as "defer", which meant
  // lowering speculatively and discarding the diagnostics — and lowering MEMOIZES, so the discarded refusal
  // left a half-built global or layout in the cache that nothing would ever re-report. That is gone: every
  // path here either folds and reports, or defers without trying.
  //
  // A GLOBAL is not deferred: the init step walks the POU's frame, and a GVL frame is not walked yet (task 5.7).
  // `deferInit` is the caller saying it RUNS them (an init step or a per-run reset); without it, deferring would queue
  // a statement nothing ever emits — the slot silently at its default again.
  // A REFERENCE DECLARATION BINDS, WHICHEVER OPERATOR WAS WRITTEN — measured, not assumed.
  //
  // The first version keyed this on `initOp === "REF="` alone. `declarations/reference-binding.ts` then asked
  // CODESYS what `ref_ : REFERENCE TO INT := v` does, and it BINDS: `refdecl_assign_spelling_write` writes 41
  // through it and reads `v = 41` back. Keying on the operator would have refused a declaration the vendor
  // accepts. The TYPE is what decides; `initOp` survives only so the formatter can print back the spelling
  // the engineer wrote.
  //
  // And it is never a constant either way: it names a place to bind, not a value to fold, so the constant
  // path would answer "not a compile-time constant" about a declaration that is perfectly ordinary.
  const binds = type.kind === "reference" || decl.initOp === "REF="
  const steps = deferInit && !lw.globalMode
  const deferrable = steps && decl.init !== undefined && runnableInit(decl.init) && (binds || !foldsToConstant(lw, decl.init))
  // AN AGGREGATE'S DYNAMIC ELEMENTS RUN TOO (transpile-restructure 5.5): the static part is the slot's initial value, each
  // element or field that is not a constant a statement after it, in element order (`var_temp_dynamic_aggregate_init`:
  // `[k, 0 + F(k), g]` and `(a := k, c := F(g))` re-evaluated per call). Only the declaration's own initializer.
  const dynamic: DynamicLeaves | undefined = steps && written.init?.kind === "aggregate_init" ? { leaves: [] } : undefined
  const before = lw.diagnostics.length
  const init = deferrable ? undefined : startValue(lw, sec, written, decl, resolved, type, dynamic)
  const deferred = deferrable
  // A DROPPED INITIALIZER MUST HAVE SAID SO. `attempt()` answering undefined means the declaration's initial
  // value did not become the slot's — and the ONLY acceptable version of that is a refusal the caller can see.
  // The comment below used to assert this ("the refusal IS recorded"); nothing enforced it, and four separate
  // defects were that assertion being false: a global left at 0 instead of 41, a struct field and a derived
  // FB's base fields left at their defaults, each in a POU that lowered clean. The outcome is silent by
  // construction — a slot at its default is indistinguishable from a slot initialized TO its default — so it
  // cannot be caught downstream by comparing values, only prevented here by making the drop speak.
  if (decl.init !== undefined && !deferred && init === undefined && lw.diagnostics.length === before)
    lw.bail("init-dropped", `${decl.names[0]?.text ?? "a variable"}'s initial value did not lower and nothing said why`, decl.span)
  // A DECLARATION THAT FAILED STILL DECLARES ITS NAME. Skipping the slot made every later USE report a second
  // diagnostic naming the wrong thing — one real refusal, then N `place-not-local` about a name that is right
  // there in the source. The coverage report counts blockers PER POU, so a cascade files the POU under the
  // wrong construct, and the work list is how the next thing to build gets chosen.
  //
  // Nothing is at risk from the slot existing: the refusal IS recorded — nothing discards diagnostics any more
  // — and `lowerUnit` returns diagnostics rather than a POU whenever any exist. The LSP made this same fix for
  // its own cascade (`ParseResult.failedDeclarations`).
  const failed = !deferred && decl.init !== undefined && init === undefined
  declareNames(lw, sec, decl, type, { init, deferred, failed, binds, leaves: failed ? [] : (dynamic?.leaves ?? []), widened })
}

/** A declaration's initial value: its initializer folded or built, or — with none — its type's (an enum's at its measured
 *  default). */
function startValue(lw: Lowering, sec: VarSection, written: VarDecl, decl: VarDecl, resolved: Type, type: Type, dynamic: DynamicLeaves | undefined): IrInit | undefined {
  // ONLY a variable that takes the TYPE's default asks where that default is, and for an ENUM that is not always
  // zero — `enumDefault` carries the measured rule. A variable WITH an initializer never asks; neither does
  // folding a VALUE of the same enum, which is a constant its declaration states.
  const enumStart =
    decl.init === undefined
      ? (enumDefault(lw.project, resolved, enumeratorValue(lw)) ?? inlineEnumDefault(written.type, enumeratorValue(lw)))
      : undefined
  if (decl.init === undefined) return enumStart === undefined ? elementDefaults(lw, written.type, type) : stored(enumStart, type)
  return decl.init.kind === "aggregate_init" ? aggregateInit(lw, decl.init, type, written.type, dynamic) : scalarInit(lw, decl.init, type, sec.constant === true)
}

/** Each name of a declaration becomes a slot — a duplicate refused by name — and a deferred initializer its init-step entry. */
function declareNames(
  lw: Lowering,
  sec: VarSection,
  decl: VarDecl,
  type: Type,
  { init, deferred, failed, binds, leaves, widened }: { init: IrInit | undefined; deferred: boolean; failed: boolean; binds: boolean; leaves: DynamicLeaves["leaves"]; widened: Pick<IrSlot, "readAs" | "declared"> | undefined },
): void {
  // run on every run of the body: a VAR_TEMP's, and every local of a METHOD or FUNCTION (its VAR is its temporary section)
  const perRun = sec.sectionKind === "VAR_TEMP" || lw.routineMode
  const queue = (pending: PendingInit): void => {
    if (!perRun) return void initFrame(lw).pendingInits.push(pending)
    const temps = initFrame(lw).tempInits
    temps.set(pending.slot, [...(temps.get(pending.slot) ?? []), pending])
  }
  for (const name of decl.names) {
    // A NAME DECLARED TWICE IS INVALID INPUT, and must end in a diagnostic here rather than a throw later.
    // CODESYS rejects it outright — "A local variable named 'iCounter' is already defined", "Duplicate definition
    // of variable 'shared' in function block" (`duplicate_declaration`, `cc2_duplicate_inherited_variable`) — but
    // lowering accepted it and left the two slots to the EMITTER, which either renamed one silently or, since the
    // emitted surface became a contract, threw. Neither is this component's rule: invalid input ends in a
    // LowerDiagnostic. An INHERITED name is the same fact one scope up, which is why the check reads the frame
    // rather than the section.
    if (lw.declared(name.text)) lw.bail("var-duplicate", `${name.text} is declared more than once`, decl.span)
    else {
      // a routine's local is numbered in ITS locals, as `lw.slot` files it
      const slot = lw.routineMode ? lw.localSlots.length : lw.slots.length
      lw.slot(name, type, sec.sectionKind, deferred || failed ? undefined : init, widened)
      if (sec.constant === true && !lw.routineMode && !lw.globalMode) initFrame(lw).constants.add(slot)
      // THE BIND TRAVELS WITH THE VALUE. A reference declaration is a BIND, not an assignment, and the init
      // sequence lowers these through `lowerStmt` — which reads `op` to decide. Dropping it made the bind a
      // store through an unbound reference.
      if (deferred) queue({ name, type, expr: decl.init as Expr, span: decl.span, slot, ...(binds ? { op: "REF=" as const } : {}) })
      const variable: Expr = { kind: "ident_expr", name: name.text, span: name.span }
      for (const leaf of leaves) queue({ name, type, expr: leaf.expr, span: leaf.span, slot, target: leaf.at(variable) })
    }
  }
}

/**
 * A CONSTANT's slot is wide enough for its value: an initializer that is a constant EXPRESSION is not narrowed to the
 * declared type (`constantSlotType`), so `D : SINT := K + 1` (K = 127) holds 128 (conformance `named_const_expression_keeps`,
 * recorded; transpile-review-2026-09-29 task 2.3). The slot is what the monitor shows; every READ of it is the value in the
 * declared type's run-time width (`readAs`; SIZEOF measures the `declared` type, 6Af): a SINT's 128 in DINT, but `D : DINT := K + 1` (K at DINT's max) reads
 * -2147483648 wherever it is read, as the monitor shows DINT#2147483648 (`tr_a29_dint_constant_expression_overflow`,
 * 6.A.29). A fold no 64-bit integer of the declared signedness holds is refused: CODESYS fails to generate code for it
 * and TwinCAT refuses it (`tr_a29_lint_constant_expression_overflow`, `_ulint_…`, `_dint_constant_overflow_past_lint`).
 */
function constantSlot(lw: Lowering, sec: VarSection, decl: VarDecl, type: Type): { type: Type; widened?: Pick<IrSlot, "readAs" | "declared"> } {
  const init = decl.init
  const elem = elemOf(type)
  if (sec.constant !== true || sec.sectionKind === "VAR_INPUT" || sec.sectionKind === "VAR_IN_OUT") return { type }
  if (elem === undefined || init === undefined || init.kind === "aggregate_init" || init.kind === "literal") return { type }
  const folded = foldConstant(lw, init, true, elem)
  if (typeof folded !== "bigint" || (elem.family !== "int" && elem.family !== "bitstring") || elem.rank === undefined || fitsIn(folded, elem)) return { type }
  // a NEGATIVE fold of an unsigned type: which slot the monitor shows, and what a read of it is, are unrecorded
  if (folded < 0n && elem.signed !== true) {
    lw.bail("constant-unsigned-negative", `${decl.names[0]?.text ?? "a constant"} of the unsigned ${elem.name} folds to ${folded} (unrecorded)`, decl.span)
    return { type }
  }
  const wide = constantSlotType(folded, elem)
  if (wide === undefined) {
    lw.bail("constant-overflow", `${decl.names[0]?.text ?? "a constant"} folds to ${folded}, which no 64-bit integer of ${elem.name}'s signedness holds`, decl.span)
    return { type }
  }
  return { type: elementaryTypeRef(wide), widened: { readAs: promoteForRuntime(type), declared: type } }
}

/** Does the integer type `e` hold `value`? */
const fitsIn = (value: bigint, e: { bits: number; signed?: boolean }): boolean => (e.signed === true ? BigInt.asIntN(e.bits, value) : BigInt.asUintN(e.bits, value)) === value

/** An FB body's VAR_IN_OUT parameters — not storage: each names the caller's variable for the call. */
export function declareInOuts(lw: Lowering, sections: readonly VarSection[]): void {
  for (const sec of sections)
    for (const decl of sec.decls) {
      const type = storageOf(lw, lw.resolve(decl.type), decl.type.span)
      for (const name of decl.names) {
        lw.inoutByName.set(name.text.toUpperCase(), lw.inoutSlots.length)
        const constant = sec.constant === true ? { constant: true, ...(holdsInstance(lw, type) ? {} : { readOnly: true }) } : {}
        lw.inoutSlots.push({ name: name.text, type, section: "VAR_IN_OUT", init: zeroInit(type), ...constant })
      }
    }
}

/**
 * An `ARRAY[*]` VAR_IN_OUT's lower bounds, one per dimension — hidden slots its caller fills with the bounds of the array
 * it binds: a routine's as inputs, an FB's as fields of the instance (design §26). The upper bound is derived from the
 * array's length (`boundOf`, lean 7.7.8). DINT, as measured (`callshape_array_star_bound_width`: `UPPER_BOUND(values,
 * 1) * 40000` wraps at 70002).
 */
export function declareOpenBounds(lw: Lowering, sections: readonly VarSection[], section: "VAR_INPUT" | "VAR"): void {
  for (const decl of sections.flatMap((s) => s.decls))
    for (const name of decl.names)
      for (let dim = 1; dim <= openDims(lw.resolve(decl.type)); dim++)
        lw.slot({ kind: "identifier", text: boundName(name.text, dim), span: name.span }, elementaryRef("DINT"), section)
}

/**
 * A section's variables made the APPLICATION'S storage — a GVL's, an FB's VAR_STAT, a METHOD's VAR_STAT: declared in
 * `scope` (where their types and bounds fold), each keyed by `prefix` and its name (a `qualified_only` list's), in a
 * scratch lowering whose diagnostics are drained into `into`. True when it declared them without one.
 */
export function declareGlobals(into: Lowering, scope: Scope, section: VarSection, prefix = ""): boolean {
  return !nested(into, scope, { globalMode: true, globalPrefix: prefix }, (global) => declareVars(global, [section])).drained
}
