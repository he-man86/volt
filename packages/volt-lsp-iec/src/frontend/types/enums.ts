/**
 * ENUMS — the facts an enum type carries beyond its members: the base type it converts as, and where an uninitialized
 * variable of it starts. The enumerators' VALUES are folded by the caller (`EnumeratorValue`): lowering and the LSP
 * fold with different rules today (conformance 4.6.1 makes them one), and this rule must not pick one of them.
 */
import { isLibrarySymbol, lookupLocal, type Scope, type Symbol } from "../symbols/index.js"
import { hasFrontendAttribute, type EnumBody, type Expr, type TypeDecl } from "../syntax/index.js"
import { elementaryType } from "./elementary.js"
import { elementaryTypeRef, type ElementaryTypeRef, type Type } from "./type.js"

/** How an enumerator's written value (`Running := 3`) is folded — a bigint, or undefined when it does not fold. */
export type EnumeratorValue = (e: Expr) => bigint | undefined

/**
 * The base type a PROJECT enum converts as, both ways: the base written after its list (`(Off, On) BYTE`), else INT
 * (conformance `cc_enum_into_*`, `cc_enum_var_into_*`; for a written base `cv_enum_base_<base>_into_scalars` over eight
 * bases and `cv_scalars_into_enum_with_base`, CODESYS 2026-10-03 — exactly the elementary rule of that base). A LIBRARY
 * enum has none: the materialized declaration carries no base (StringUtils' EDATETIMEPLACEHOLDER converts as an
 * unsigned 8-bit type, Util's WEEKDAY as INT — `cv_library_enum_255_into_scalars`, `cv_library_enum_into_scalars` — and
 * both are written `(…);` in the materialization), so its conversions stay unjudged. A written base that is no
 * elementary type is no fact either.
 */
export function enumBase(body: EnumBody, sym: Symbol): ElementaryTypeRef | undefined {
  if (isLibrarySymbol(sym)) return undefined
  const written = body.baseType
  if (written === undefined) return elementaryTypeRef(elementaryType("INT")!)
  const facts = written.kind === "named_type" && written.qualifiers === undefined ? elementaryType(written.name.text) : undefined
  return facts === undefined ? undefined : elementaryTypeRef(facts)
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
  const body = enumDeclaration(project, t)?.body
  return body?.kind === "enum" ? defaultOfValues(body.values, body.init, valueOf) : undefined
}

/**
 * THE DECLARATION AN ENUM TYPE RESOLVED TO, by its scope's file — undefined for an implicit enum or one not resolved. A
 * bare `lookupUnit` lost who asked and which namespace: `v : B.E` took the first `E` by URI (another library's).
 */
export function enumDeclaration(project: Scope, t: Type): TypeDecl | undefined {
  if (t.kind !== "enum" || t.name === "(implicit)") return undefined
  const uri = t.scope?.defUri
  const sym = uri === undefined ? undefined : lookupLocal(project, t.name).find((s) => s.kind === "type" && s.uri === uri)
  return sym?.kind === "type" && (sym.ast as TypeDecl).body.kind === "enum" ? (sym.ast as TypeDecl) : undefined
}

/**
 * A `{attribute 'strict'}` ENUM (P14, `prag_strict_enum_*`, `cv_*_strict_enum*`, both vendors 2026-10-02/03): its declared
 * name and the values its members hold — undefined when `t` is no strict enum, or a member's value does not fold (the
 * values are then no fact). A strict enum takes only its own values: a variable of any other type, another enum's value,
 * or a literal no member holds is "'<text>' is not a valid value for strict ENUM type '<name>'", and arithmetic on it is
 * refused; it converts OUT exactly as a plain enum (`cv_strict_enum_into_scalars`).
 */
export function strictEnum(project: Scope, t: Type, valueOf: EnumeratorValue): { name: string; values: ReadonlySet<bigint> } | undefined {
  const decl = enumDeclaration(project, t)
  if (decl === undefined || decl.body.kind !== "enum" || !hasFrontendAttribute(decl, "strict")) return undefined
  const values = memberValues(decl.body.values, valueOf)
  return values === undefined ? undefined : { name: decl.name.text, values: new Set(values.values()) }
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

/** Each member's value by its upper-cased name, in declaration order — a written one folded, an unwritten one the
 *  previous plus one (the first 0); undefined when a written value does not fold. */
function memberValues(values: readonly { name: { text: string }; value?: Expr }[], valueOf: EnumeratorValue): Map<string, bigint> | undefined {
  let next = 0n
  const byName = new Map<string, bigint>()
  for (const v of values) {
    const written = v.value === undefined ? undefined : valueOf(v.value)
    if (v.value !== undefined && typeof written !== "bigint") return undefined // a value that does not fold
    const value = typeof written === "bigint" ? written : next
    byName.set(v.name.text.toUpperCase(), value)
    next = value + 1n
  }
  return byName
}

/** Zero when zero is one of the values, else the FIRST — or the member a type-level `:= Name` default names. */
function defaultOfValues(
  values: readonly { name: { text: string }; value?: Expr }[],
  init: { kind: string; name?: unknown } | undefined,
  valueOf: EnumeratorValue,
): bigint | undefined {
  const byName = memberValues(values, valueOf)
  if (byName === undefined) return undefined
  const first = byName.values().next().value
  const hasZero = [...byName.values()].includes(0n)
  // A TYPE-LEVEL default names one of its own members: `TYPE E : (Idle, Busy) := Busy` starts every E at Busy
  // (`type_enum_type_level_default`, recorded 1). Read from the value list rather than resolved as an expression —
  // the name is a member of THIS enum, and a bare one does not resolve in the declaring scope.
  if (init !== undefined) return init.kind === "ident_expr" && typeof init.name === "string" ? byName.get(init.name.toUpperCase()) : undefined
  return hasZero ? 0n : first
}
