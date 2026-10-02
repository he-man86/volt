/**
 * WHAT A NAME DENOTES — a reference chain (`x`, `a.b.c`, `a.b()`) to its symbol, and the scope a type's members live
 * in. It cannot move to `symbols/`: resolving `a.b` needs the TYPE of `a` to find the next scope (design.md "Why no
 * member resolution in symbols").
 */
import {
  childScopesByName,
  enclosingPou,
  lookup,
  lookupGlobal,
  lookupMember,
  lookupLocal,
  bareEnumMember,
  resolveGvlMember,
  rootOf,
  type Scope,
  type Symbol,
} from "../../symbols/index.js"
import { selfRefKind, type Expr, type TypeExpr } from "../../syntax/index.js"
import { resolveNamedType } from "../resolve.js"
import { UNKNOWN, type Type } from "../type.js"
import { inferExprType } from "./expr.js"

/**
 * The symbol a reference chain denotes — `x`, `a.b.c`, `a.b()` — or undefined. Feeds inference and
 * (later) navigation. Uses `inferExprType` for the base then a structural member lookup.
 */
export function resolveMemberChain(expr: Expr, scope: Scope, project: Scope): Symbol | undefined {
  switch (expr.kind) {
    case "ident_expr":
      return lookup(scope, expr.name)?.symbol
    // `.g` — the global namespace only, every local scope passed over (rule E33, `GlobalExpr`)
    case "global_expr":
      return lookupGlobal(project, expr.name.name)
    case "member": {
      // Static GVL member `GVL.field`: GVL vars are flat at project scope, tagged by block uri.
      const gvlMember = resolveGvlMember(expr, scope, project)
      if (gvlMember !== undefined) return gvlMember
      // `THIS.v`, `SUPER.Get` — the pointers themselves have no members (`expr_this_member_without_deref`)
      if (expr.base.kind === "ident_expr" && selfRefKind(expr.base.name) !== undefined) return undefined
      const base = inferExprType(expr.base, scope, project)
      const memberScope = memberScopeOf(base)
      // the member scope AND what it inherits (rule H2): `inst.baseMember` is the base FB's member, an interface's base's
      // member the derived interface's (`callshape_inout_base_method_from_outside_derived`, `inh_interface_extends_member`)
      return memberScope !== undefined ? lookupMember(memberScope, expr.member.name) : undefined
    }
    case "paren":
      return resolveMemberChain(expr.inner, scope, project)
    case "call":
      return resolveMemberChain(expr.callee, scope, project)
    default:
      return undefined
  }
}

/** The member scope of a scoped type (enum, struct, FB, interface), or undefined. Completion kept a copy. A REFERENCE TO
 *  one is read through: `r.M(a := 1)` with `r : REFERENCE TO FB` calls the FB's method (`inh_override_reference_only`,
 *  both vendors build it and refuse only the override). */
export function memberScopeOf(written: Type): Scope | undefined {
  const t = written.kind === "reference" ? written.target : written
  return t.kind === "enum" || t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" ? t.scope : undefined
}

/**
 * An enum VALUE's type: its enum, resolved by name so it carries the base type (`EnumType.base`). Inference returned
 * UNKNOWN for every enum value, so assignment, narrowing and call arguments each re-resolved one — and the
 * call-argument copy never learned the base type (consolidate-lsp-structure B6).
 *
 * An IMPLICIT enum's value lives in the enclosing POU's scope (typing it by its owner would name the POU) and is of the
 * implicit enum, which is what the variable declared with it resolves to (`resolve`): `decl_implicit_enum_*`,
 * frontend-conformance 2.3.6 — they were UNKNOWN. That gives the value A type, not its own: every implicit enum is the one
 * `(implicit)` type, with no base and no name of its own, so a store of one is still unchecked — the vendors' "Cannot
 * convert type 'IMPLICIT_ENUM__…' to type 'BYTE'" and their enum-to-enum warning between two implicit enums are not said
 * (`decl_implicit_enum_into_byte`, `_with_base_into_byte`, `_cross_assign`; the name is `IMPLICIT_ENUM_TYPE_NAME`'s).
 */
export function enumValueType(sym: Symbol, project: Scope): Type | undefined {
  if (sym.kind !== "enum_value") return undefined
  if (sym.owner.kind !== "enum") return implicitEnumOf(sym) !== undefined ? IMPLICIT_ENUM : undefined
  const resolved = resolveNamedType(sym.owner.name, project)
  return resolved.kind === "enum" ? resolved : { kind: "enum", name: sym.owner.name, scope: sym.owner }
}

/** The implicit enum type, as `resolve` names it. */
const IMPLICIT_ENUM: Type = { kind: "enum", name: "(implicit)" }

/** The implicit enum an enum value symbol was declared in — its declaration's type, or that type's array element. */
function implicitEnumOf(sym: Symbol): TypeExpr | undefined {
  let t = (sym.ast as { kind?: string; type?: TypeExpr } | undefined)?.type
  while (t?.kind === "array_type") t = t.element
  return t?.kind === "implicit_enum_type" ? t : undefined
}

/** True when an expression names an enum VALUE (`Busy`, `E_Mode.Busy`) rather than a variable of an enum type — they
 *  compare differently in CODESYS (conformance `cc_enum_compare_two_enums`, `cc_enum_compare_two_enum_values`). */
export function isEnumValueRef(expr: Expr, scope: Scope, project: Scope): boolean {
  const sym =
    expr.kind === "ident_expr"
      ? (lookup(scope, expr.name)?.symbol ?? bareEnumMember(scope, expr.name))
      : expr.kind === "member"
        ? resolveMemberChain(expr, scope, project)
        : undefined
  return sym?.kind === "enum_value"
}

/** `THIS` — the enclosing FB carrying its member scope; nothing in a FUNCTION or a PROGRAM, which has no instance: `THIS^.v`
 *  there is "Unknown type: 'THIS^.v'" (`expr_this_in_function`, `cc_self_this_in_program`, both vendors). */
export function thisType(scope: Scope): Type {
  const pou = enclosingPou(scope)
  if (pou === undefined || !lookupLocal(rootOf(pou), pou.name).some((s) => s.kind === "function_block")) return UNKNOWN
  return { kind: "function_block", name: pou.name, scope: pou }
}

/** `SUPER` — the enclosing FB's BASE carrying its member scope (`SUPER^.Get()`, `expr_super_deref_call`, both vendors run
 *  it), UNKNOWN where the FB extends nothing or its base did not resolve (`expr_super_without_base` is refused). */
export function superType(scope: Scope): Type {
  const base = enclosingPou(scope)?.baseScope
  return base !== undefined ? { kind: "function_block", name: base.name, scope: base } : UNKNOWN
}

/** A bare name that names a GVL/enum/namespace/POU/struct scope (a static member base like `E.Idle`). */
export function staticScopeType(project: Scope, name: string): Type | undefined {
  for (const child of childScopesByName(project, name)) {
    switch (child.kind) {
      case "enum":
        return { kind: "enum", name: child.name, scope: child }
      case "pou":
        return { kind: "function_block", name: child.name, scope: child }
      case "struct":
      case "namespace":
      case "interface":
        return { kind: "struct", name: child.name, scope: child }
    }
  }
  return undefined
}
