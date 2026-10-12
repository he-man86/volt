/**
 * SIZEOF's OPERAND — how many bytes the expression SIZEOF is asked about occupies, where that is known. Split from
 * `expr.ts` (openspec lsp-same-standard design.md §2.2).
 */
import { lookup, type Scope, scopeUri } from "../../symbols/index.js"
import type { Expr } from "../../syntax/index.js"
import { typeBytes } from "../layout.js"
import { resolveTypeExpr, resolveNamedType } from "../resolve.js"
import { type Type, UNKNOWN } from "../type.js"
import { VALUE_SYMBOLS } from "./builtin-call.js"
import { inferExprType } from "./expr.js"

/** A VALUE's type, as ADR addresses it — a variable, a member, an element or a dereference; anything else (a POU's
 *  name, a literal) unknown. */
export function valueOperandType(e: Expr, scope: Scope, project: Scope): Type {
  if (e.kind === "ident_expr") {
    const sym = lookup(scope, e.name)?.symbol
    return sym !== undefined && VALUE_SYMBOLS.has(sym.kind) ? inferExprType(e, scope, project) : UNKNOWN
  }
  return e.kind === "member" || e.kind === "index" || e.kind === "deref" ? inferExprType(e, scope, project) : UNKNOWN
}

/** SIZEOF's value, in bytes: of a value or a TYPE named bare, as the measured layout lays it out (`layout` `typeBytes`: a
 *  STRUCT and an FB instance too, transpile-restructure 6.A.31) — what a constant fold reads (`const/fold`). */
export function sizeofOperandBytes(e: Expr, scope: Scope, project: Scope): bigint | undefined {
  return typeBytes(sizedOperandType(e, scope, project), project)?.size
}

/**
 * The bytes of a value of `t` whose SIZEOF has a measured TYPE (`sizeofResultType`): an elementary type, an enum, an array
 * of them, a UNION of them (`layout` `typeBytes`). Undefined for one that holds a STRUCT or an FB instance — what type
 * their SIZEOF has is measured for a STRUCT alone (UINT, above), so a layout's size is a value here, never a type.
 */
export function storageBytes(t: Type, project: Scope): bigint | undefined {
  const holdsLayout = (x: Type): boolean => (x.kind === "array" ? holdsLayout(x.element) : (x.kind === "struct" && x.union !== true) || x.kind === "function_block")
  return holdsLayout(t) ? undefined : typeBytes(t, project)?.size
}

/** The declared types of a STRUCT's or UNION's fields, each resolved in its own file — undefined when its scope is not known. */
function fieldTypes(t: Extract<Type, { kind: "struct" }>, project: Scope): Type[] | undefined {
  if (t.scope === undefined) return undefined
  const out: Type[] = []
  for (const list of t.scope.symbols.values())
    for (const s of list) if (s.kind === "struct_field" && s.typeExpr !== undefined) out.push(resolveTypeExpr(s.typeExpr, project, 0, project, s.uri))
  return out
}

/**
 * An upper bound on a STRUCT's or UNION's size, when every field is sized (`storageBytes`, or a nested STRUCT bounded the
 * same way): the fields' sizes, each with the most padding an alignment of at most 8 can put before it, and the tail's.
 * Enough to know the size fits a UINT without owning the layout.
 */
export function structSizeBound(t: Extract<Type, { kind: "struct" }>, project: Scope, depth = 0): bigint | undefined {
  if (depth > 8) return undefined
  const exact = storageBytes(t, project)
  if (exact !== undefined) return exact
  const members = fieldTypes(t, project)
  if (members === undefined) return undefined
  let bound = 7n
  for (const m of members) {
    const bytes = m.kind === "struct" ? structSizeBound(m, project, depth + 1) : storageBytes(m, project)
    if (bytes === undefined) return undefined
    bound += bytes + 7n
  }
  return bound
}

/** SIZEOF's operand: a value, or a TYPE named bare (`SIZEOF(LINT)`, `ar_sizeof_type`). */
export function sizedOperandType(e: Expr, scope: Scope, project: Scope): Type {
  // a name no scope declares (an elementary type, `SIZEOF(DINT)`), or a DUT's or an FB's — a TYPE, sized as lowering's
  // `builtins/sizeof.ts` sizes one (`ct_bit_packing_sizes`: `SIZEOF(DUT_CT_p1)`; it was read as a value and had no type)
  const named = e.kind === "ident_expr" ? lookup(scope, e.name)?.symbol : undefined
  if (e.kind === "ident_expr" && (named === undefined || named.kind === "type" || named.kind === "function_block"))
    return resolveNamedType(e.name, project, scopeUri(scope))
  return valueOperandType(e, scope, project)
}
