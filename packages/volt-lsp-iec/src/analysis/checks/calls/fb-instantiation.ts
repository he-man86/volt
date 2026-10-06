/**
 * fb-instantiation (calls/). A function block (C0080) or interface (C0199) reached through its TYPE name instead of
 * through a declared instance — both must be instantiated to be accessed. Invoked directly (`FB()`, `ITF()`) or
 * reached into for a member (`FB.Method()` — conformance `cc2_fb_not_instantiated`), or stored as an assignment's VALUE
 * (`txt := FB_x`, `txt := I_x`: the store is refused too, naming the type upper-cased — `dt_static_base_fb_type`,
 * `dt_interface_static_base`, CODESYS 2026-10-03; rule DT8).
 *
 * Zero-FP: fires only when the callee is a bare identifier that resolves to a PROJECT symbol of kind
 * `function_block` / `interface` (the type itself). An instance variable resolves to a `var`/`gvl_var`
 * (skipped), functions/programs to their own kinds (skipped), and a LIBRARY symbol is skipped — a library name
 * can collide with a standard function (e.g. `DELETE`), where the call is the function, not a type invocation.
 */
import { walkStatements, type Expr } from "../../../frontend/syntax/index.js"
import { bodies, forEachExpr, isLibrarySymbol, lookup, type Scope } from "../../../frontend/symbols/index.js"
import { inferExprType, resolveMemberChain } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkFbInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    // the type NAME, whether it is called or merely reached into for a member
    const name = e.kind === "call" && e.callee.kind === "ident_expr" ? e.callee : e.kind === "member" && e.base.kind === "ident_expr" ? e.base : undefined
    if (name === undefined) return
    const kind = typeNamed(name, scope)
    if (kind !== undefined) out.push(notInstantiated(kind, name, ctx))
    // CALLING an interface says so twice: it must be instantiated, and an interface is not a thing you call at all
    // (conformance `cc5_type_invoked_directly`). Reaching into one for a member says only the first.
    if (kind === "interface" && e.kind === "call")
      out.push({ severity: "error", span: name.span, source: SOURCE, code: "invalid-call-target", message: ctx.messages.cannotCallObjectOfType("INTERFACE") })
    // …and the type name passed as a call's ARGUMENT (`calls_fb_type_as_argument`, `calls_itf_type_as_argument`, both
    // vendors 2026-10-06; `op_sys_queryinterface` names an interface as an operand the same way)
    // — of a routine (FUNCTION, METHOD, FB) or __QUERYINTERFACE: the operators that TAKE a type (`__NEW(FB_X)`,
    // `INDEXOF(FB_X)`, `SIZEOF`) are other questions (`newdel_*`, `operand_indexof`)
    if (e.kind === "call" && (takesArguments(e.callee, scope, ctx) || (e.callee.kind === "ident_expr" && e.callee.name.toUpperCase() === "__QUERYINTERFACE")))
      for (const arg of e.args) {
        if (arg.value?.kind !== "ident_expr" || arg.output) continue
        const argKind = typeNamed(arg.value, scope)
        if (argKind !== undefined) out.push(notInstantiated(argKind, arg.value, ctx))
      }
  })
  // …and the type name stored as an assignment's value
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.value.kind !== "ident_expr") return
      const kind = typeNamed(s.value, scope)
      if (kind !== undefined) out.push(notInstantiated(kind, s.value, ctx))
    })
}

/** The kind of type a bare name is — a PROJECT function block or interface — or undefined. */
function typeNamed(name: Extract<Expr, { kind: "ident_expr" }>, scope: Scope): "function_block" | "interface" | undefined {
  const sym = lookup(scope, name.name)?.symbol
  if (sym === undefined || isLibrarySymbol(sym)) return undefined
  return sym.kind === "function_block" || sym.kind === "interface" ? sym.kind : undefined
}

function notInstantiated(kind: "function_block" | "interface", name: Extract<Expr, { kind: "ident_expr" }>, ctx: CheckContext): DiagnosticItem {
  return kind === "function_block"
    ? { severity: "error", span: name.span, source: SOURCE, code: "fb-not-instantiated", message: ctx.messages.fbMustBeInstantiated(name.name) } // C0080
    : { severity: "error", span: name.span, source: SOURCE, code: "interface-not-instantiated", message: ctx.messages.interfaceMustBeInstantiated(name.name) } // C0199
}

/** Does the callee resolve to a routine whose arguments are values — a FUNCTION, a METHOD or an FB instance? */
function takesArguments(callee: Expr, scope: Scope, ctx: CheckContext): boolean {
  const sym = resolveMemberChain(callee, scope, ctx.project)
  if (sym === undefined) return false
  if (sym.kind === "function" || sym.kind === "method" || sym.kind === "interface_method") return true
  const t = inferExprType(callee, scope, ctx.project)
  return t.kind === "function_block"
}
