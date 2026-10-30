/**
 * What a variable is stored as: a type's storage and the layout of a struct or FB, its fields laid out and its body
 * queued.
 */

import { fbContext, routineContext } from "../core/keys.js"
import { resolveNamedType, type Type } from "../../../frontend/types/index.js"
import { Lowering } from "../core/lowering.js"
import { sharedState } from "../core/shared.js"
import { baseOf } from "../core/chain.js"
import type { Span, VarSection } from "../../../frontend/syntax/index.js"
import { enumStorage } from "../values/enums.js"
import { lookup, scopeUri } from "../../../frontend/symbols/index.js"
import { declareOpenBounds, declareVars } from "./declare.js"
import { overlayBytes, unionsOf } from "./unions.js"
import { declareStatics } from "./statics.js"
import { buildInitSequence } from "../init/sequence.js"
import { drain } from "../core/nested.js"

/** The layouts being built right now, by upper-cased name — a type reached again while its own layout is being laid
 *  out CONTAINS itself, which has no size (`buildLayout`). */
const buildingOf = sharedState(() => new Set<string>())

/**
 * The FB variable sections that get a FRAME SLOT — a field of the instance. VAR_IN_OUT does not: it aliases the caller's
 * variable. Nor does VAR_STAT, which is shared by every instance (`declareStatics`). Nor does VAR_TEMP (transpile-restructure
 * 7.6.4): it is per-run storage, a LOCAL of the body's run (`Lowering.perRun`), declared with the frame (`buildLayout`)
 * and started over at its initial value on every run — not a field the instance carries between runs. `bytes.ts` skips
 * VAR_TEMP and VAR_STAT when it lays an instance out, so SIZEOF and the frame now agree. **What CODESYS answers for SIZEOF
 * of an FB holding a VAR_TEMP is not measured** — `mem_sizeof_fb_with_temp` and `mem_sizeof_fb_with_stat` record it against
 * a baseline that has neither.
 */
const INSTANCE_STORAGE: ReadonlySet<string> = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT"])

/**
 * The type a variable is STORED as: a sizeless string with its capacity, a struct or FB under its DECLARED name (ST is
 * case-insensitive and Rust is not, so `fb_x : fb_conveyor` and `FB_Conveyor` must be one struct), an array of
 * those. Building it builds the layout of every composite type it reaches, dependencies first.
 */
export function storageOf(lw: Lowering, t: Type, at: Span, atUri: string | undefined = lw.uri): Type {
  if (t.kind === "array") return { ...t, element: storageOf(lw, t.element, at) }
  if (t.kind === "enum") return enumStorage(lw, t)
  // A POINTEE's type is not one `Lowering.resolve` returned — a `POINTER TO STRING`'s target is resolved with the
  // pointer, sizeless — so a string reached through one is sized here, by the same rule (`Lowering.sized`: the default,
  // or `string-capacity` when its stated capacity does not fold)
  if (t.kind === "elementary" && (t.name === "STRING" || t.name === "WSTRING") && t.length === undefined) return lw.sized(t, at)
  if (t.kind !== "struct" && t.kind !== "function_block") return t
  const sym = lookup(lw.project, t.name)?.symbol
  const name = sym?.name ?? t.name
  const key = name.toUpperCase()
  // WHERE A REFUSAL POINTS: the type's own declaration, or — for a compiler struct the project does not declare
  // (`VERSION`, an `ANY` input's struct; frontend-conformance TY14/TY15) — the place that USES it. It pointed at 0:0.
  const where: At = sym === undefined ? { span: at, uri: atUri } : { span: sym.span, uri: sym.uri }
  // A TYPE THAT CONTAINS ITSELF HAS NO SIZE, and saying so beats running out of stack. `FUNCTION_BLOCK FB_R VAR rv :
  // FB_R; END_VAR` — or any longer cycle through a struct — sent `storageOf` and `buildLayout` into each other until
  // the process died with a RangeError, where the rule for this component is that invalid input ends in a
  // LowerDiagnostic and never a throw. CODESYS rejects the shape too, so nothing is lost by refusing it; what was
  // lost was the difference between "refused" and "crashed". The corpus has no self-referential type, which is why
  // `TOTALITY` never saw it — found by aiming at `calls.ts`'s uncovered refusals (0.7).
  // (a type whose layout is SET while its build finishes — its init sequence lowering `THIS` — is laid out, not recursive)
  if (buildingOf(lw).has(key) && !lw.layouts.has(key)) {
    lw.bail("layout-recursive", `${name} contains itself, so it has no size`, where.span, where.uri)
    return { ...t, name }
  }
  if (!lw.layouts.has(key)) {
    buildingOf(lw).add(key)
    try {
      buildLayout(lw, { ...t, name }, sym, where)
    } finally {
      buildingOf(lw).delete(key)
    }
  }
  return { ...t, name }
}

/** Where a type's refusal points: its declaration in its own file, or the place that uses it (`storageOf`). */
type At = { span: Span; uri: string | undefined }

/** The symbol a laid-out type is declared by, when lowering found one. */
type LayoutSymbol = ReturnType<typeof lookup> extends infer R ? (R extends { symbol: infer S } ? S : never) | undefined : never

/** A struct's fields or an FB instance's storage, lowered in the type's own scope — a base type's fields first. */
function buildLayout(lw: Lowering, t: Extract<Type, { kind: "struct" | "function_block" }>, sym: LayoutSymbol, where: At): void {
  // its refusals are in the file of the declaration it lays out — `sym`, whose fields these are
  const nested = new Lowering(t.scope ?? lw.project, lw.project, lw.shared, sym?.uri ?? scopeUri(t.scope))
  nested.selfType = t
  nested.codeOwner = t.scope
  nested.frameContext = fbContext(t.name)
  // its body's VAR_TEMP are the run's locals, keyed as a routine's are (a pointer's key, an instance handle's context)
  nested.routineContext = routineContext(nested.frameContext)
  const statics: { name: string; global: number }[] = []
  const base = (name: string | undefined): void => inheritBase(lw, nested, t, sym, where, statics, name)
  const ast = sym?.ast
  if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "struct") {
    base(ast.body.extends?.text)
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
  } else if (t.kind === "struct" && ast?.kind === "type_decl" && ast.body.kind === "union") {
    // A struct of its members, kept overlaid by the store (`unions.ts`) — either every member's bytes are measured, or
    // EVERY member is a pointer, which is one integer in this model (design §9 form 1), so the overlay is a plain copy.
    // A union of pointers is how an ANY input's `pValue` is read at the width its `diSize` selects (conformance
    // `state_any_int_pointer_increment`).
    declareVars(nested, [{ sectionKind: "VAR", decls: ast.body.fields } as unknown as VarSection])
    const pointers = nested.slots.length > 0 && nested.slots.every((f) => f.type.kind === "pointer")
    // Two refusals, a code each (transpile-refusal-classification 2.1): a member whose overlaid bytes no recording measured
    // is `union-overlay`, not measured (19 corpus POUs); a member declared with an initial value builds
    // (`rk_union_member_initial_value`: w 16#0100, b 0) and is `layout-union`, not modelled.
    const unmeasured = !(pointers || nested.slots.every((f) => overlayBytes(f.type) !== undefined))
    if (unmeasured || ast.body.fields.some((f) => f.init !== undefined)) {
      lw.bail(unmeasured ? "union-overlay" : "layout-union", `${t.name} has a member whose overlaid bytes are not measured, or an initial value`, where.span, where.uri)
      return
    }
    unionsOf(lw).add(t.name.toUpperCase())
  } else if (t.kind === "function_block" && (ast?.kind === "function_block" || ast?.kind === "program")) {
    // The compiler acts on these whether or not the FB is ever called, and `lowerUnit`'s init step models them: an
    // `instance-path` STRING holds the instance's path from the project tree, and a `call_after_global_init_slot` method
    // runs once per instance before the first scan; `call_after_init`'s and `call_after_online_change_slot`'s did not run
    // at all in a started application (measured).
    base(baseOf(ast)?.text)
    // An instance's field may have an initial value that is not a constant — `p : POINTER TO X := ADR(y)` and
    // `THIS` are how the corpus writes 300 of them. Deferred like a POU's own (`declareVars`'s third argument):
    // the field takes its default and `initStep` runs the expression PER INSTANCE, which is what the measured
    // declaration-order rule needs (`declarations/init-sequence.ts`).
    declareVars(nested, ast.varSections.filter((s) => INSTANCE_STORAGE.has(s.sectionKind)), true)
    // its VAR_TEMP: the body's per-run locals, declared with the frame so its initializers' types fold in the FB's scope
    declareVars(nested, ast.varSections.filter((s) => s.sectionKind === "VAR_TEMP"), true)
    // an `ARRAY[*]` in-out's bounds are the instance's: each call stores them, and the body reads them there
    declareOpenBounds(nested, ast.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"), "VAR")
    for (const section of ast.varSections.filter((s) => s.sectionKind === "VAR_STAT")) declareStatics(lw, nested, t.name, section, statics)
    nested.displayName = ast.name.text
    lw.bodies.set(t.name.toUpperCase(), { lowering: nested, unit: ast, state: "pending", ...(sym?.uri === undefined ? {} : { uri: sym.uri }) })
  } else {
    lw.bail(`layout-${t.kind}`, `${t.name} has no declaration lowering can lay out`, where.span, where.uri)
    return
  }
  drain(lw, nested)
  // the live frame: temps the FB's body adds when a call lowers it are fields of the instance too
  lw.layouts.set(t.name.toUpperCase(), { name: t.name, kind: t.kind, fields: nested.slots, ...(statics.length > 0 ? { statics } : {}) })
  // Built HERE, though it RUNS in the init step: a field initializer may store an address (`p : POINTER TO X :=
  // ADR(y)`), and a body that dereferences that pointer is only allowed to once the store is known. The body lowers
  // later — on the first call — so this has to come first; and AFTER the layout is set, so an initializer naming the
  // instance itself (`self : POINTER TO X := THIS`, `THIS^.n`) finds its type laid out rather than being built
  // (`tr_22_fb_init_reads_this_field`, `init_this_in_initializer`; it was `layout-recursive`).
  if (lw.bodies.get(t.name.toUpperCase())?.lowering === nested) {
    const before = nested.diagnostics.length
    buildInitSequence(nested)
    drain(lw, nested, before)
  }
}

/** The base type `name`'s fields (and its shared statics) into `nested`, laid out first — or the refusal of a base with no layout. */
function inheritBase(
  lw: Lowering,
  nested: Lowering,
  t: Extract<Type, { kind: "struct" | "function_block" }>,
  sym: LayoutSymbol,
  where: At,
  statics: { name: string; global: number }[],
  name: string | undefined,
): void {
  if (name === undefined) return
  const baseType = storageOf(lw, resolveNamedType(name, lw.project, sym?.uri), where.span, where.uri)
  const layout = baseType.kind === "struct" || baseType.kind === "function_block" ? lw.layouts.get(baseType.name.toUpperCase()) : undefined
  // A base the binder linked to an FB or a STRUCT, not on its way back to the type, whose own declaration did not lay
  // out — or a library FB lowering resolves no type for (`unit_fb_extends_qualified`: CODESYS builds it) — is
  // `layout-base`, valid ST not built. One no declaration resolves, an interface, or an EXTENDS that comes back to the
  // type is `base-unresolved`, which both vendors refuse (`inh_unresolved_base`, `oopa_extends_interface`,
  // `inh_extends_cycle`; openspec transpile-refusal-classification 2.1).
  if (layout === undefined) {
    const resolved = baseType.kind === "struct" || baseType.kind === "function_block"
    const linked = resolved
      ? !buildingOf(lw).has(baseType.name.toUpperCase())
      : baseType.kind === "unknown" && (t.scope?.baseScope?.kind === "pou" || t.scope?.baseScope?.kind === "struct")
    return void lw.bail(linked ? "layout-base" : "base-unresolved", `the base type ${name} of ${t.name} has no layout`, where.span, where.uri)
  }
  nested.inherit(layout.fields)
  for (const shared of layout.statics ?? []) {
    nested.statics.set(shared.name.toUpperCase(), shared.global)
    statics.push(shared)
  }
}

