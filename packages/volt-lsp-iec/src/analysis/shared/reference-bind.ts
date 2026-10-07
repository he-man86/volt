/**
 * reference-bind — what binding a value to a REFERENCE TO T converts, the one rule two checks apply: a `REF=` statement
 * (`checks/types/reference-assign`) and a VAR_IN_OUT field of an FB instance's initializer (`checks/oop/fb-init-inout`,
 * whose parameter IS a reference — "Cannot convert type 'BOOL' to type 'REFERENCE TO INT'", analysis-conformance 3.6).
 *
 * The rule is EXACT TYPE, not range: an untyped integer literal takes the smallest type that holds it — 7 is SINT, 314 is
 * INT — and the bind demands that type BE the referenced one (`cc3_reference_assign`, `cc6_reference_assign_literal`); a
 * variable of another type is refused the same way, named as itself (`dt_ref_assign_wrong_type`, `cv_pointer_to_reference`,
 * `cv_reference_to_other_reference`, `dt_ref_assign_struct_mismatch`, CODESYS 2026-10-03). A SUBRANGE variable binds a
 * reference to its base (`dt_subrange_ref_bind`). Only the kinds whose compiler rendering is measured are compared.
 */
import type { Expr } from "../../frontend/syntax/index.js"
import type { Scope } from "../../frontend/symbols/index.js"
import { inferExprType, literalErrorType, literalOwnType, renderType, withoutSubrange, type Type } from "../../frontend/types/index.js"

/** The two types a bind of `value` to `reference` (a REFERENCE TO T) fails to convert — `from` the value's, `to` the
 *  reference's, each rendered as the compiler names it — or undefined where it binds or the rule does not decide it. */
type BindMismatch = { from: string; to: string }

/**
 * A LITERAL bound to `reference`: its own type must BE the referenced one. `exact` when it is (the bind is accepted and a
 * `REF=` goes on to its write-access rule), else the mismatch, or undefined when the literal has no type to name.
 */
export function literalBind(value: Expr & { kind: "literal" }, reference: Type): BindMismatch | "exact" | undefined {
  const referenced = reference.kind === "reference" ? reference.target : undefined
  const own = literalOwnType(value)
  if (own !== undefined && referenced?.kind === "elementary" && referenced.elem.name === own.name) return "exact"
  const from = literalErrorType(value, reference)
  return from === undefined ? undefined : { from: renderType(from), to: renderType(reference) }
}

/** A VARIABLE bound to `reference`: the mismatch where its type is another (comparable) one, else undefined. */
export function variableBind(value: Expr & { kind: "ident_expr" }, reference: Type & { kind: "reference" }, scope: Scope, project: Scope): BindMismatch | undefined {
  const written = inferExprType(value, scope, project)
  const bound = written.kind === "reference" ? written.target : written
  if (!comparable(bound) || !comparable(reference.target)) return undefined
  if (sameExactType(bound, reference.target)) return undefined
  if (written.kind !== "reference" && sameExactType(withoutSubrange(bound), reference.target)) return undefined
  return { from: renderType(written, { form: "compiler" }), to: renderType(reference, { form: "compiler" }) }
}

/** A type whose compiler rendering is measured — elementary, enum, pointer, array of one whose bounds fold — so two
 *  compare. A string is not: its capacity is written or the default, and `STRING` against `STRING(80)` was never asked. */
function comparable(t: Type): boolean {
  if (t.kind === "array") return t.bounds !== undefined && comparable(t.element)
  if (t.kind === "pointer") return comparable(t.target)
  return (t.kind === "elementary" && t.elem.family !== "string") || t.kind === "enum"
}

/** Two `comparable` types are the same type: an array by its folded bounds and element, a pointer by its target, the
 *  rest by the compiler's rendering. */
function sameExactType(a: Type, b: Type): boolean {
  if (a.kind === "array" && b.kind === "array")
    return (
      a.bounds!.length === b.bounds!.length &&
      a.bounds!.every((d, i) => d.lower === b.bounds![i]!.lower && d.upper === b.bounds![i]!.upper) &&
      sameExactType(a.element, b.element)
    )
  if (a.kind === "pointer" && b.kind === "pointer") return sameExactType(a.target, b.target)
  return renderType(a, { form: "compiler" }) === renderType(b, { form: "compiler" })
}
