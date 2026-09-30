/**
 * WHAT A NAME DENOTES — a reference chain (`x`, `a.b.c`, `a.b()`) to its symbol, and the scope a type's members live
 * in. It cannot move to `symbols/`: resolving `a.b` needs the TYPE of `a` to find the next scope (design.md "Why no
 * member resolution in symbols").
 */
import {
  childScopesByName,
  enclosingPou,
  lookup,
  lookupLocal,
  resolveBareEnumMember,
  resolveGvlMember,
  type Scope,
  type Symbol,
} from "../../symbols/index.js"
import type { Expr } from "../../syntax/index.js"
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
    case "member": {
      // Static GVL member `GVL.field`: GVL vars are flat at project scope, tagged by block uri.
      const gvlMember = resolveGvlMember(expr, scope, project)
      if (gvlMember !== undefined) return gvlMember
      const base = inferExprType(expr.base, scope, project)
      const memberScope = memberScopeOf(base)
      return memberScope !== undefined ? lookupLocal(memberScope, expr.member.name)[0] : undefined
    }
    case "paren":
      return resolveMemberChain(expr.inner, scope, project)
    case "call":
      return resolveMemberChain(expr.callee, scope, project)
    default:
      return undefined
  }
}

/** The member scope of a scoped type (enum, struct, FB, interface), or undefined. Completion kept a copy. */
export function memberScopeOf(t: Type): Scope | undefined {
  return t.kind === "enum" || t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" ? t.scope : undefined
}

/**
 * An enum VALUE's type: its enum, resolved by name so it carries the base type (`EnumType.base`). Only a value owned by
 * a real enum scope counts — an inline enum's values live in the enclosing POU's scope, and typing them would name the
 * POU. Inference returned UNKNOWN for every enum value, so assignment, narrowing and call arguments each re-resolved one —
 * and the call-argument copy never learned the base type (consolidate-lsp-structure B6).
 */
export function enumValueType(sym: Symbol, project: Scope): Type | undefined {
  if (sym.kind !== "enum_value" || sym.owner.kind !== "enum") return undefined
  const resolved = resolveNamedType(sym.owner.name, project)
  return resolved.kind === "enum" ? resolved : { kind: "enum", name: sym.owner.name, scope: sym.owner }
}

/** True when an expression names an enum VALUE (`Busy`, `E_Mode.Busy`) rather than a variable of an enum type — they
 *  compare differently in CODESYS (conformance `cc_enum_compare_two_enums`, `cc_enum_compare_two_enum_values`). */
export function isEnumValueRef(expr: Expr, scope: Scope, project: Scope): boolean {
  const sym =
    expr.kind === "ident_expr"
      ? (lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name))
      : expr.kind === "member"
        ? resolveMemberChain(expr, scope, project)
        : undefined
  return sym?.kind === "enum_value"
}

/** `THIS` — the enclosing FB carrying its member scope. */
export function thisType(scope: Scope): Type {
  const pou = enclosingPou(scope)
  return pou !== undefined ? { kind: "function_block", name: pou.name, scope: pou } : UNKNOWN
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
