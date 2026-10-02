/**
 * ENUMS — the facts an enum type carries beyond its members: the base type it converts as, and where an uninitialized
 * variable of it starts. The enumerators' VALUES are folded by the caller (`EnumeratorValue`): lowering and the LSP
 * fold with different rules today (conformance 4.6.1 makes them one), and this rule must not pick one of them.
 */
import { isLibrarySymbol, lookupUnit, type Scope, type Symbol } from "../symbols/index.js"
import type { EnumBody, Expr, TypeDecl } from "../syntax/index.js"
import { elementaryType } from "./elementary.js"
import { elementaryTypeRef, type ElementaryTypeRef, type Type } from "./type.js"

/** How an enumerator's written value (`Running := 3`) is folded — a bigint, or undefined when it does not fold. */
export type EnumeratorValue = (e: Expr) => bigint | undefined

/**
 * The base type an enum converts as: a project enum with no base type written converts as INT (conformance
 * `cc_enum_into_*`, `cc_enum_var_into_*`). A written base type is unmeasured, and so is a LIBRARY enum: two real builds
 * (bakon-nano, pro2193) store one into a WORD with no warning — both stay without a base, so they convert as before.
 */
export function enumBase(body: EnumBody, sym: Symbol): ElementaryTypeRef | undefined {
  const measured = body.baseType === undefined && !isLibrarySymbol(sym)
  return measured ? elementaryTypeRef(elementaryType("INT")!) : undefined
}

/**
 * WHERE AN UNINITIALIZED VARIABLE OF AN ENUM STARTS — measured on CODESYS 3.5.21.40, 2026-09-18.
 *
 * **Zero if zero is one of the values; otherwise the FIRST enumerator.** Neither half was guessable:
 *
 *   (Forward := 1, Reverse := 2)              -> 1   `type_enum_default_first_nonzero`
 *   (Reverse := -1, Neutral := 0, Forward := 1) -> 0   `type_enum_default_first_negative`   (Neutral, NOT first)
 *   (High := 10, None := 0)                   -> 0   `type_enum_default_gap_then_zero`     (None, NOT first)
 *   (Idle, Busy)                              -> 0   `type_enum_default_first_implicit_zero`
 *
 * So the storage is zero-initialised like everything else, and the vendor only moves off zero when zero would not be
 * a value of the type at all. This was refused while unmeasured — rightly: lowering used to start EVERY enum at 0,
 * which for the middle two is correct and for the first is a value the type does not have. 446 corpus enum types
 * declare a non-zero first enumerator, 21 of them in project source.
 */
export function enumDefault(project: Scope, t: Type, valueOf: EnumeratorValue): bigint | undefined {
  if (t.kind !== "enum" || t.name === "(implicit)") return undefined
  const sym = lookupUnit(project, t.name)?.symbol
  const body = sym?.kind === "type" ? (sym.ast as TypeDecl).body : undefined
  return body?.kind === "enum" ? defaultOfValues(body.values, body.init, valueOf) : undefined
}

/**
 * The same rule for an INLINE enum — `e : (Forward := 1, Reverse := 2)` — whose values live on the DECLARATION and
 * never reach a named type, so `enumDefault` cannot see them. Measured the same way
 * (`type_enum_inline_default_first_nonzero`, recorded 1).
 */
export function inlineEnumDefault(
  type: { kind: string; values?: readonly { name: { text: string }; value?: Expr }[] },
  valueOf: EnumeratorValue,
): bigint | undefined {
  return type.kind === "implicit_enum_type" && type.values !== undefined ? defaultOfValues(type.values, undefined, valueOf) : undefined
}

/** Zero when zero is one of the values, else the FIRST — or the member a type-level `:= Name` default names. */
function defaultOfValues(
  values: readonly { name: { text: string }; value?: Expr }[],
  init: { kind: string; name?: unknown } | undefined,
  valueOf: EnumeratorValue,
): bigint | undefined {
  let next = 0n
  let first: bigint | undefined
  let hasZero = false
  const byName = new Map<string, bigint>()
  for (const v of values) {
    const written = v.value === undefined ? undefined : valueOf(v.value)
    if (v.value !== undefined && typeof written !== "bigint") return undefined // a value that does not fold
    const value = typeof written === "bigint" ? written : next
    if (first === undefined) first = value
    if (value === 0n) hasZero = true
    byName.set(v.name.text.toUpperCase(), value)
    next = value + 1n
  }
  // A TYPE-LEVEL default names one of its own members: `TYPE E : (Idle, Busy) := Busy` starts every E at Busy
  // (`type_enum_type_level_default`, recorded 1). Read from the value list rather than resolved as an expression —
  // the name is a member of THIS enum, and a bare one does not resolve in the declaring scope.
  if (init !== undefined) return init.kind === "ident_expr" && typeof init.name === "string" ? byName.get(init.name.toUpperCase()) : undefined
  return hasZero ? 0n : first
}
