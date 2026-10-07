/**
 * ENUM VALUES AS IR — an enum's storage type and an enumerator as the constant of that type. The numbering and the default
 * value are the front-end's (`types/enums`).
 */

import type { Lowering } from "../lowering.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import { bareEnumMember, findChildScope, lookup, lookupMember } from "../../../frontend/symbols/index.js"
import type { Expr, TypeDecl } from "../../../frontend/syntax/index.js"
import { enumValueOf } from "./fold.js"
import type { IrExpr } from "../../ir/index.js"
import { stored } from "./convert.js"
import { withStringCapacity } from "../storage/layout.js"

/**
 * An enum is stored as its base type: the one written after the value list (`) BYTE`), else INT — how a project enum
 * without one converts, as measured (conformance `cc_enum_into_*`). An inline enum (`state : (Idle, Running)`) holds INT.
 */
export function enumStorage(lw: Lowering, t: Extract<Type, { kind: "enum" }>): Type {
  const sym = t.name === "(implicit)" ? undefined : lookup(lw.project, t.name)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  if (body?.kind === "enum" && body.baseType !== undefined) return withStringCapacity(lw.resolve(body.baseType, lw.project))
  return elementaryRef("INT")
}

/** How lowering folds an enumerator's written value — the evaluator `types/enums.ts` numbers the enumerators with. */
export const enumeratorValue = (lw: Lowering) => (e: Expr): bigint | undefined => {
  const v = enumValueOf(lw, e, 0)
  return typeof v === "bigint" ? v : undefined
}

/**
 * An enum value — `E_Mode.Busy`, or a bare `Busy` when its enum is not qualified_only — as the constant it is: its written
 * `:= n`, else one more than the value before it, starting at 0 (conformance `type_dut_enum_simple`: `Running` is 1;
 * `type_dut_enum_explicit_values`), typed as its enum's storage. Undefined for anything that is not one.
 */
export function enumConstant(lw: Lowering, e: Expr, depth = 0): IrExpr | undefined {
  let sym: ReturnType<typeof bareEnumMember>
  if (e.kind === "member" && e.base.kind === "ident_expr") {
    const owner = lookup(lw.scope, e.base.name)?.symbol
    const scope = owner?.kind === "type" ? findChildScope(lw.project, owner.name) : undefined
    sym = scope === undefined ? undefined : lookupMember(scope, e.member.name)
  } else if (e.kind === "member" && e.base.kind === "member" && e.base.base.kind === "ident_expr") {
    // `Ns.Enum.Value` — a referenced library's namespace over the units it materialized (`bindLibraryNamespaces`):
    // pro2193's `enumErrorSeverity` takes every one of its values from `L_IE1P.L_IE1P_SeverityLevel`
    const ns = lookup(lw.scope, e.base.base.name)?.symbol
    const nsScope = ns?.kind === "namespace" ? findChildScope(lw.project, ns.name) : undefined
    const owner = nsScope === undefined ? undefined : lookupMember(nsScope, e.base.member.name)
    const scope = owner?.kind === "type" && nsScope !== undefined ? findChildScope(nsScope, owner.name) : undefined
    sym = scope === undefined ? undefined : lookupMember(scope, e.member.name)
  } else if (e.kind === "ident_expr") {
    const found = lookup(lw.scope, e.name)?.symbol
    sym = found?.kind === "enum_value" ? found : found === undefined ? bareEnumMember(lw.scope, e.name) : undefined
  }
  if (sym?.kind !== "enum_value") return undefined
  // an implicit enumeration's value (`eState : (Idle, Running)`) lives in the POU's scope, its declaration the variable's;
  // it is numbered as a TYPE enum's is and held as an INT (conformance `type_implicit_enum_inline`, `var_inline_enum_decl`)
  // …and through an ARRAY OF one, whose elements are of it (`decl_implicit_enum_in_array`: `a[1] := ia_b` runs as 1)
  type Declared = { kind: string; element?: Declared; values?: readonly { name: { text: string }; value?: Expr }[] }
  let declared = (sym.ast as { type?: Declared }).type
  while (declared?.kind === "array_type") declared = declared.element
  const implicit = sym.owner.kind !== "enum" && declared?.kind === "implicit_enum_type" ? declared.values : undefined
  const decl = sym.owner.kind === "enum" ? lookup(lw.project, sym.owner.name)?.symbol : undefined
  const body = decl?.kind === "type" ? (decl.ast as TypeDecl).body : undefined
  const values = implicit ?? (body?.kind === "enum" ? body.values : undefined)
  if (values === undefined) return undefined
  const type = implicit !== undefined ? enumStorage(lw, { kind: "enum", name: "(implicit)" }) : enumStorage(lw, { kind: "enum", name: sym.owner.name, scope: sym.owner })
  let next = 0n
  for (const v of values) {
    const written = v.value === undefined ? undefined : enumValueOf(lw, v.value, depth)
    if (v.value !== undefined && typeof written !== "bigint") return lw.bail("enum-value", `${v.name.text}'s value does not fold`, e.span)
    const value = typeof written === "bigint" ? written : next
    if (v.name.text.toUpperCase() === sym.name.toUpperCase()) return { kind: "const", value: stored(value, type), type, span: e.span }
    next = value + 1n
  }
  return undefined
}
