/**
 * The declarations that make a frame's slots: the variables with their initial values, a CONSTANT's wide slot, the
 * VAR_IN_OUT parameters and an `ARRAY[*]`'s hidden bounds.
 */

import type { Lowering } from "../core/lowering.js"
import { nested } from "../core/nested.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import type { Expr, VarDecl, VarSection } from "../../../frontend/syntax/index.js"
import { bindAddress } from "./addresses.js"
import { holdsInstance, storageOf } from "./layout.js"
import { aggregateInit, aliasInit, elementDefaults, runnableInit, scalarInit } from "../init/initial-values.js"
import {
  constantSlotType,
  elementaryRef,
  elementaryTypeRef,
  elemOf,
  enumDefault,
  inlineEnumDefault,
  type Type,
  typeZero,
} from "../../../frontend/types/index.js"
import { enumeratorValue } from "../values/enums.js"
import type { IrInit } from "../../ir/index.js"
import { stored } from "../values/convert.js"
import { foldConstant, foldsToConstant } from "../values/fold.js"
import { boundName, openDims } from "../places/bounds.js"
import { initFrame } from "../init/state.js"

/**
 * `deferInit`: an initializer that is not a constant becomes an INIT-STEP statement instead of a refusal.
 *
 * Only the POU'S OWN FRAME asks for it, because only the POU's own init step can run one. This function is also
 * how a LAYOUT's fields and a ROUTINE's locals are declared, and neither has an init step of its own: an FB
 * instance's field initializer runs per instance, which is the same machinery the FB_Init calls use and a larger
 * change than this. Defaulting to `false` is what keeps those refusing rather than silently taking the default —
 * which is the bug the refusal was added for.
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
  const type = constantSlot(lw, sec, written, storageOf(lw, lw.resolve(written.type), written.type.span))
  // A variable with no initializer of its own starts at its ALIAS type's: `TYPE T : INT := 42;` makes `x : T` 42
  // (conformance `type_dut_alias_with_init`, 43 after `x := x + 1`). It started at 0 — `resolve` sees through the
  // alias to INT and the alias's initializer went with it.
  const decl = { ...written, init: written.init ?? aliasInit(lw, written.type) }
  const attempt = (): IrInit | undefined => startValue(lw, sec, written, decl, type)
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
  // A GLOBAL or a ROUTINE's local is not deferred: the init step walks the POU's frame, and whether either
  // would run there is not measured.
  // `deferInit` is the caller saying it HAS an init step. A layout's fields and a routine's locals do not, so
  // deferring there would queue a statement nothing ever emits — the slot silently at its default again.
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
  const deferrable =
    deferInit && decl.init !== undefined && runnableInit(decl.init) && !lw.globalMode && !lw.routineMode && (binds || !foldsToConstant(lw, decl.init))
  const before = lw.diagnostics.length
  const init = deferrable ? undefined : attempt()
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
  declareNames(lw, sec, decl, type, { init, deferred, failed, binds })
}

/** A declaration's initial value: its initializer folded or built, or — with none — its type's (an enum's at its measured
 *  default). */
function startValue(lw: Lowering, sec: VarSection, written: VarDecl, decl: VarDecl, type: Type): IrInit | undefined {
  // ONLY a variable that takes the TYPE's default asks where that default is, and for an ENUM that is not always
  // zero — `enumDefault` carries the measured rule. A variable WITH an initializer never asks; neither does
  // folding a VALUE of the same enum, which is a constant its declaration states.
  const enumStart =
    decl.init === undefined
      ? (enumDefault(lw.project, lw.resolve(written.type), enumeratorValue(lw)) ?? inlineEnumDefault(written.type, enumeratorValue(lw)))
      : undefined
  if (decl.init === undefined) return enumStart === undefined ? elementDefaults(lw, written.type, type) : stored(enumStart, type)
  return decl.init.kind === "aggregate_init" ? aggregateInit(lw, decl.init, type) : scalarInit(lw, decl.init, type, sec.constant === true)
}

/** Each name of a declaration becomes a slot — a duplicate refused by name — and a deferred initializer its init-step entry. */
function declareNames(
  lw: Lowering,
  sec: VarSection,
  decl: VarDecl,
  type: Type,
  { init, deferred, failed, binds }: { init: IrInit | undefined; deferred: boolean; failed: boolean; binds: boolean },
): void {
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
      const slot = lw.slots.length
      lw.slot(name, type, sec.sectionKind, deferred || failed ? undefined : init)
      // THE BIND TRAVELS WITH THE VALUE. A reference declaration is a BIND, not an assignment, and the init
      // sequence lowers these through `lowerStmt` — which reads `op` to decide. Dropping it made the bind a
      // store through an unbound reference.
      if (deferred) {
        const pending = { name, type, expr: decl.init as Expr, span: decl.span, slot, ...(binds ? { op: "REF=" as const } : {}) }
        // a VAR_TEMP's runs on every run of its body, not once before the first (`resetTemps`)
        if (sec.sectionKind === "VAR_TEMP") initFrame(lw).tempInits.set(slot, pending)
        else initFrame(lw).pendingInits.push(pending)
      }
    }
  }
}

/**
 * A CONSTANT's slot is wide enough for its value: an initializer that is a constant EXPRESSION is not narrowed to the
 * declared type (`constantSlotType`), so `D : SINT := K + 1` (K = 127) holds 128 and every read of it is 128
 * (conformance `named_const_expression_keeps`, recorded; transpile-review-2026-09-29 task 2.3).
 */
function constantSlot(lw: Lowering, sec: VarSection, decl: VarDecl, type: Type): Type {
  const init = decl.init
  const elem = elemOf(type)
  if (sec.constant !== true || sec.sectionKind === "VAR_INPUT" || sec.sectionKind === "VAR_IN_OUT") return type
  if (elem === undefined || init === undefined || init.kind === "aggregate_init" || init.kind === "literal") return type
  const folded = foldConstant(lw, init, true)
  const wide = typeof folded === "bigint" ? constantSlotType(folded, elem) : undefined
  return wide === undefined ? type : elementaryTypeRef(wide)
}

/** An FB body's VAR_IN_OUT parameters — not storage: each names the caller's variable for the call. */
export function declareInOuts(lw: Lowering, sections: readonly VarSection[]): void {
  for (const sec of sections)
    for (const decl of sec.decls) {
      const type = storageOf(lw, lw.resolve(decl.type), decl.type.span)
      for (const name of decl.names) {
        lw.inoutByName.set(name.text.toUpperCase(), lw.inoutSlots.length)
        const constant = sec.constant === true ? { constant: true, ...(holdsInstance(lw, type) ? {} : { readOnly: true }) } : {}
        lw.inoutSlots.push({ name: name.text, type, section: "VAR_IN_OUT", init: typeZero(type), ...constant })
      }
    }
}

/**
 * An `ARRAY[*]` VAR_IN_OUT's bounds, two per dimension — hidden slots its caller fills with the bounds of the array it
 * binds: a routine's as inputs, an FB's as fields of the instance (design §26). DINT, as measured
 * (`callshape_array_star_bound_width`: `UPPER_BOUND(values, 1) * 40000` wraps at 70002).
 */
export function declareOpenBounds(lw: Lowering, sections: readonly VarSection[], section: "VAR_INPUT" | "VAR"): void {
  for (const decl of sections.flatMap((s) => s.decls))
    for (const name of decl.names)
      for (let dim = 1; dim <= openDims(lw.resolve(decl.type)); dim++)
        for (const which of ["lower", "upper"] as const) lw.slot({ kind: "identifier", text: boundName(name.text, which, dim), span: name.span }, elementaryRef("DINT"), section)
}

/**
 * A section's variables made the APPLICATION'S storage — a GVL's, an FB's VAR_STAT, a METHOD's VAR_STAT: declared in
 * `scope` (where their types and bounds fold), each keyed by `prefix` and its name (a `qualified_only` list's), in a
 * scratch lowering whose diagnostics are drained into `into`. True when it declared them without one.
 */
export function declareGlobals(into: Lowering, scope: Scope, section: VarSection, prefix = ""): boolean {
  return !nested(into, scope, { globalMode: true, globalPrefix: prefix }, (global) => declareVars(global, [section])).drained
}
