/**
 * A CALL'S CALLEE — the function, method or FB instance a call names, with its formal parameters in binding order.
 * Shared by signature help and the call-argument check.
 */
import { extendsChain, extendsCycle, hasUnresolvedBase, isLibrarySymbol, lookupLocal, type Scope, type Symbol } from "../../symbols/index.js"
import type {
  CallExpr,
  Identifier,
  Method,
  TypeExpr,
  VarSection,
} from "../../syntax/index.js"
import { resolveMemberChain } from "./member.js"
import { inferExprType } from "./expr.js"

export interface CalleeInfo {
  /** The resolved callable symbol (FB / function / method). */
  sym: Symbol
  /** VAR_INPUT parameters in declared order, base-first through the EXTENDS chain. `hasDefault` marks the ones a
   *  call may leave out — for a FUNCTION, every input WITHOUT one is required. */
  params: { name: Identifier; type: TypeExpr; hasDefault: boolean }[]
  /** Positionally-bindable parameters (VAR_INPUT + VAR_IN_OUT) in binding order, base-first, each tagged with
   *  whether it is a VAR_IN_OUT (which must receive a writable variable). `positional.length` === `positionalArity`. */
  positional: { name: Identifier; type: TypeExpr; inOut: boolean; constant: boolean }[]
  /** Count of positionally-bindable parameters (VAR_INPUT + VAR_IN_OUT; VAR_OUTPUT is never bound by
   *  position) across the whole chain — the upper bound for the too-many-arguments check. */
  positionalArity: number
  /** Every declared parameter name (VAR_INPUT/OUTPUT/IN_OUT) across the chain, lowercased. */
  paramNames: Set<string>
  /** The callee's member scope (FB-instance calls only). A named argument may also bind a PROPERTY, which
   *  isn't a var-section param — resolving the name through this scope + its EXTENDS chain catches those.
   *  Undefined for a direct function/method/program call (no members beyond its params). */
  scope?: Scope
  /** True iff the entire EXTENDS chain resolved to project (non-library) FBs, so `params`/`positionalArity`/
   *  `paramNames` are COMPLETE. When false (an unresolved or library base), a consumer must not treat a
   *  count/unknown-name as an error — inherited params it can't see may cover it. */
  complete: boolean
}

/**
 * Resolve a call's callee to its callable symbol, ordered VAR_INPUT parameters (base-first across EXTENDS),
 * positional arity, and parameter-name set — the ONE resolution signature-help and the call-argument check
 * share. Handles a DIRECT callable (function / method / program owns its var sections) and an FB-INSTANCE
 * call (`fbInst(…)`: sections come from the FB type and its base chain). Undefined when the callee doesn't
 * resolve to a callable — both consumers then skip (zero false positives).
 */
export function resolveCallee(call: CallExpr, scope: Scope, project: Scope): CalleeInfo | undefined {
  const sym = resolveMemberChain(call.callee, scope, project)
  if (sym === undefined) return undefined
  // Direct callable — a function/method/program declares its own var sections (no inheritance).
  const direct = (sym.ast as Partial<Method>).varSections
  if (Array.isArray(direct)) return calleeInfo(sym, direct, true, undefined)
  // Instance call — the callee is a variable typed as an FB; gather the FB declaration's sections plus every
  // base's via the EXTENDS chain (so inherited inputs count and resolve), and carry the member scope for
  // property-name binding.
  const t = inferExprType(call.callee, scope, project)
  if (t.kind === "function_block" && t.scope?.parent !== undefined) {
    const fbSym = lookupLocal(t.scope.parent, t.name).find((s) => s.kind === "function_block")
    if (fbSym !== undefined && (fbSym.ast as { kind: string }).kind === "function_block") {
      const chain = fbChainSections(t.scope)
      return calleeInfo(fbSym, chain.sections, chain.complete, t.scope)
    }
  }
  return undefined
}

/**
 * The var sections of an FB and its EXTENDS base chain, BASE-FIRST (matching positional-binding order), plus
 * whether the chain is fully resolved to project source. The chain is the one the symbol table LINKED (`extendsChain`
 * — by precedence among same-named candidates, rule H8); it was looked up by NAME, which under a project FB shadowing a
 * library's is the library's. `complete` goes false on a cycle (one the chain runs into included), an unresolvable base,
 * or a base from a referenced library (whose flattened signature can't be trusted for arity) — the chain is cut at the
 * first such base.
 */
function fbChainSections(fbScope: Scope): { sections: VarSection[]; complete: boolean } {
  const chain = extendsChain(fbScope) // base-first
  // a chain whose most basic scope still HAS a base stopped where it closed on itself — a cycle the FB is on, or one its
  // chain runs into (X → A → B → A), which `extendsCycle(fbScope)` does not report (it finds only a path back to X)
  let complete = !hasUnresolvedBase(fbScope) && extendsCycle(fbScope) === undefined && chain[0]?.baseScope === undefined
  const sections: VarSection[] = []
  // from the FB outward, so a library BASE (`isLibrarySymbol` normalizes the `%20` the live server sends) cuts it
  const kept: (readonly VarSection[])[] = []
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = chain[i]!
    const sym = s.parent === undefined ? undefined : lookupLocal(s.parent, s.name).find((x) => x.declarationSpan === s.span)
    if (sym === undefined || (i < chain.length - 1 && isLibrarySymbol(sym)) || sym.ast.kind !== "function_block") {
      complete = false
      break
    }
    kept.push(sym.ast.varSections)
  }
  for (let i = kept.length - 1; i >= 0; i--) sections.push(...kept[i]!)
  return { sections, complete }
}

const POSITIONAL_SECTIONS = new Set(["VAR_INPUT", "VAR_IN_OUT"]) // VAR_OUTPUT is never bound by position
const PARAM_SECTIONS = new Set(["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"]) // the name-bindable formal params

/** A FUNCTION, or a METHOD stating `: <type>`, whose name is its result variable (rule Y20). */
const hasResultVariable = (sym: Symbol): boolean => sym.kind === "function" || (sym.kind === "method" && sym.typeExpr !== undefined)

function calleeInfo(
  sym: Symbol,
  sections: readonly VarSection[],
  complete: boolean,
  scope: Scope | undefined,
): CalleeInfo {
  const paramNames = new Set<string>()
  const params: { name: Identifier; type: TypeExpr; hasDefault: boolean }[] = []
  const positional: { name: Identifier; type: TypeExpr; inOut: boolean; constant: boolean }[] = []
  for (const sec of sections) {
    if (!PARAM_SECTIONS.has(sec.sectionKind)) continue // VAR/VAR_TEMP/VAR_STAT locals aren't parameters
    for (const d of sec.decls)
      for (const id of d.names) {
        // a FUNCTION's or METHOD's name is its result variable (rule Y20): an input of that name is a duplicate of it,
        // not an input — both vendors count it out of the signature ("Function 'M' requires exactly '0' inputs",
        // `sym_function_input_named_as_function`, `sym_method_input_named_as_method`, 2026-10-02). A METHOD with no
        // `: <type>` has no result variable: pro2193's `METHOD PUBLIC Rollover` takes `rollover := 5` and builds
        if (hasResultVariable(sym) && id.text.toLowerCase() === sym.name.toLowerCase()) continue
        paramNames.add(id.text.toLowerCase())
        if (POSITIONAL_SECTIONS.has(sec.sectionKind))
          positional.push({ name: id, type: d.type, inOut: sec.sectionKind === "VAR_IN_OUT", constant: sec.constant === true })
        if (sec.sectionKind === "VAR_INPUT") params.push({ name: id, type: d.type, hasDefault: d.init !== undefined })
      }
  }
  // AN FB TAKES NO POSITIONAL ARGUMENTS AT ALL. Not "as many as it has inputs" — none. `target(1, 2, mark)` on an FB
  // with two VAR_INPUTs is three separate "Assignment to input missing for parameter" errors, one per argument, and
  // `target(5)` on an FB with one input is the same (`calls/call-grid.ts` and `refuse_fb_called_positionally`,
  // measured 2026-09-19). A FUNCTION and a METHOD take them positionally, named, mixed and in any named order.
  //
  // This said `positional.length` for every callee kind, so an FB's positional call looked legal up to its input
  // count and only an EXCESS argument was reported — which is why `refuse_fb_called_positionally` sat as an
  // lsp-gap. `positional` itself keeps every parameter: it is what the VAR_IN_OUT and writability checks bind by.
  const arity = sym.kind === "function_block" ? 0 : positional.length
  return { sym, params, positional, positionalArity: arity, paramNames, scope, complete }
}
