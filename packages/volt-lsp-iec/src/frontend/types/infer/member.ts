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
import { UNKNOWN, type StaticType, type Type } from "../type.js"
import { inferExprType } from "./expr.js"
import { isSfcStepBase } from "./sfc-step.js"
import { sfcStepTypeScope } from "../system.js"

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
      // a step of an SFC chart, which no declaration in the text names (`sfc-step`): `S_Boot.x`, `PRG.S_Boot.t`
      if (isSfcStepBase(expr, scope, project)) return lookupMember(sfcStepTypeScope(), expr.member.name)
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

/** The member scope of a scoped type (enum, struct, FB, interface, a static base), or undefined. Completion kept a copy. A REFERENCE TO
 *  one is read through: `r.M(a := 1)` with `r : REFERENCE TO FB` calls the FB's method (`inh_override_reference_only`,
 *  both vendors build it and refuse only the override). */
export function memberScopeOf(written: Type): Scope | undefined {
  const t = written.kind === "reference" ? written.target : written
  return t.kind === "enum" || t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" || t.kind === "static" ? t.scope : undefined
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

/**
 * `THIS` — a POINTER TO the enclosing FB, whose target carries its member scope (`THIS^.v`); nothing in a FUNCTION or a
 * PROGRAM, which has no instance: `THIS^.v` there is "Unknown type: 'THIS^.v'" (`expr_this_in_function`,
 * `cc_self_this_in_program`, both vendors). The FB is named as the compiler names its own POU, upper-cased: "Cannot convert
 * type 'POINTER TO FB_LANG_DT_THIS_TYPE' to type 'STRING'", and `THIS^` 'FB_LANG_DT_THIS_TYPE' (rule DT7, `dt_this_type`,
 * CODESYS 2026-10-03). This typed THIS as the FB itself.
 */
export function thisType(scope: Scope): Type {
  const pou = enclosingPou(scope)
  if (pou === undefined || !lookupLocal(rootOf(pou), pou.name).some((s) => s.kind === "function_block")) return UNKNOWN
  return { kind: "pointer", target: pouNamed(pou) }
}

/** `SUPER` — a POINTER TO the enclosing FB's BASE (`SUPER^.Get()`, `expr_super_deref_call`, both vendors run it), named
 *  upper-cased as THIS is (`dt_super_type`); UNKNOWN where the FB extends nothing or its base did not resolve
 *  (`expr_super_without_base` is refused). */
export function superType(scope: Scope): Type {
  const base = enclosingPou(scope)?.baseScope
  return base !== undefined ? { kind: "pointer", target: pouNamed(base) } : UNKNOWN
}

/** A POU denoted by its NAME — THIS's FB, SUPER's base, a PROGRAM's or an FB type's name read as a value: the compiler
 *  prints it upper-cased (`dt_this_type`, `dt_static_base_program`, `dt_static_base_fb_type`), where a declared INSTANCE
 *  keeps its type's case ("Cannot convert type 'FB_LANG_dt_fb_instance_type_name_other' to type 'STRING'",
 *  `dt_fb_instance_type_name`, CODESYS 2026-10-03). Only the PRINTED type was measured so (`byName`, `render`): a
 *  member-not-found message keeps the declared name, as it did before rule DT8 — no recording asks one. */
function pouNamed(pou: Scope): Type {
  return { kind: "function_block", name: pou.name, scope: pou, byName: true }
}

/**
 * A bare name that denotes a declaration — a static member base like `E.Idle`, `GVL.x`, `Util.WEEKDAY`, or such a name read
 * as a value (rule DT8). An ENUM type is its `EnumType`; a PROGRAM or an FB type the POU (`pouNamed`); a GVL, a namespace,
 * a STRUCT type and an INTERFACE a `StaticType` — a namespace and an interface were typed "struct", a GVL not at all.
 */
export function staticScopeType(project: Scope, name: string): Type | undefined {
  for (const child of childScopesByName(project, name)) {
    switch (child.kind) {
      case "enum":
        return { kind: "enum", name: child.name, scope: child }
      case "pou":
        return pouNamed(child)
      case "struct":
      case "namespace":
      case "interface":
      case "gvl":
        return staticOf(child.kind, child.name, child)
    }
  }
  return undefined
}

/**
 * The declaration a SYMBOL's name denotes where it is read as a value (rule DT8), or undefined for a symbol that is a
 * value: a GVL's name ('GVL_LANG_…', it was untyped), and a FUNCTION's or METHOD's name where it is no call — the callable
 * itself ('F_LANG_…', 'VALUE'), except inside its own body, where the name is its result variable (rule Y20;
 * `dt_static_base_gvl`, `dt_static_base_function`, `dt_function_name_in_own_body`, `cc2_type_name_and_method_without_parens`,
 * CODESYS 2026-10-03).
 */
export function staticNameOf(sym: Symbol, scope: Scope): StaticType | undefined {
  if (sym.kind === "gvl_block") return staticOf("gvl", sym.name)
  if ((sym.kind !== "function" && sym.kind !== "method") || insideOwnBody(sym, scope)) return undefined
  return staticOf(sym.kind, sym.name)
}

/** Is `scope` inside the body of the FUNCTION or METHOD `sym` — where its name is its result variable (rule Y20)? The
 *  body is the scope `sym`'s owner holds under its name: another FB's method of the same name (`a.Value` inside this FB's
 *  own `Value`) is no result variable (step 4.7.4 review). */
export function insideOwnBody(sym: Symbol, scope: Scope): boolean {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent)
    if ((s.kind === "pou" || s.kind === "method") && s.parent === sym.owner && s.name.toLowerCase() === sym.name.toLowerCase()) return true
  return false
}

/** The `StaticType` of a declaration of `denotes` named `name`. */
export function staticOf(denotes: StaticType["denotes"], name: string, scope?: Scope): StaticType {
  return { kind: "static", denotes, name, ...(scope !== undefined ? { scope } : {}) }
}
