/**
 * infer — the ONE expression type-inference engine (Layer C, C.4). `inferExprType` is the frontend's
 * public entry point (architecture invariant). Bottom-up and total: every arm returns a rich `Type`,
 * collapsing to `UNKNOWN` on any unresolved sub-part so consumers act only on fully-known types (C.6).
 *
 * The rich `Type` carries element/target/scope inline, so `index`/`deref`/`member` read the sub-type
 * off the node instead of re-resolving a `TypeExpr` (the win of the folded model).
 */
import type { Scope, Symbol } from "../symbols/index.js"
import { childScopesByName, lookup, lookupLocal, isLibrarySymbol } from "../symbols/index.js"
import type {
  BinaryExpr,
  CallExpr,
  Expr,
  FunctionBlock,
  Identifier,
  Literal,
  Method,
  TypeExpr,
  VarSection,
} from "../syntax/index.js"
import { canonicalElem, elementaryType, isDatetime, isDuration } from "./elementary.js"
import { resolveTypeExpr } from "./resolve.js"
import { elementaryTypeRef, UNKNOWN, type Type } from "./type.js"

/** Infer the type of an ST expression. `unknown` on any unresolved sub-part (conservative). */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr)
    case "ident_expr": {
      // THIS denotes the enclosing FB instance — resolve to its member scope so `THIS^.field` navigates.
      if (expr.name.toUpperCase() === "THIS") return thisType(scope)
      const sym = lookup(scope, expr.name)?.symbol
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project)
      // Static base: the name denotes a GVL/enum/namespace/POU scope (`E_State.Idle`), not a typed var.
      return staticScopeType(project, expr.name) ?? UNKNOWN
    }
    case "member": {
      const sym = resolveMemberChain(expr, scope, project)
      return sym?.typeExpr !== undefined ? resolveTypeExpr(sym.typeExpr, project) : UNKNOWN
    }
    case "index": {
      const base = inferExprType(expr.base, scope, project)
      return base.kind === "array" ? base.element : UNKNOWN
    }
    case "deref": {
      const base = inferExprType(expr.base, scope, project)
      if (base.kind === "pointer" || base.kind === "reference") return base.target
      // `THIS^` / a ref already resolved to its target: dereffing a scoped value is identity.
      return base.kind === "function_block" || base.kind === "struct" || base.kind === "enum" ? base : UNKNOWN
    }
    case "call":
      return callReturnType(expr, scope, project)
    case "unary":
      // NOT/-/+ preserve the operand's type (NOT on WORD is a bitwise complement, not BOOL).
      return inferExprType(expr.operand, scope, project)
    case "binary":
      return binaryResultType(expr, scope, project)
    case "paren":
      return inferExprType(expr.inner, scope, project)
    case "assign_expr":
      return inferExprType(expr.value, scope, project)
  }
}

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
      const memberScope = scopeOf(base)
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

export interface CalleeInfo {
  /** The resolved callable symbol (FB / function / method). */
  sym: Symbol
  /** VAR_INPUT parameters in declared order, base-first through the EXTENDS chain (name + declared type). */
  params: { name: Identifier; type: TypeExpr }[]
  /** Positionally-bindable parameters (VAR_INPUT + VAR_IN_OUT) in binding order, base-first, each tagged with
   *  whether it is a VAR_IN_OUT (which must receive a writable variable). `positional.length` === `positionalArity`. */
  positional: { name: Identifier; type: TypeExpr; inOut: boolean }[]
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
      const chain = fbChainSections(fbSym.ast as FunctionBlock, fbSym.owner)
      return calleeInfo(fbSym, chain.sections, chain.complete, t.scope)
    }
  }
  return undefined
}

/**
 * The var sections of an FB and its EXTENDS base chain, BASE-FIRST (matching positional-binding order), plus
 * whether the chain is fully resolved to project source. `complete` goes false on a cycle, an unresolvable
 * base, or a base from a referenced library (whose flattened signature can't be trusted for arity).
 */
function fbChainSections(fb: FunctionBlock, definedIn: Scope): { sections: VarSection[]; complete: boolean } {
  const chain: (readonly VarSection[])[] = []
  const seen = new Set<string>()
  let cur: FunctionBlock | undefined = fb
  let where: Scope = definedIn
  let complete = true
  while (cur !== undefined) {
    chain.push(cur.varSections)
    const baseName: string | undefined = cur.extends?.text
    if (baseName === undefined) break
    if (seen.has(baseName.toLowerCase())) {
      complete = false // cycle
      break
    }
    seen.add(baseName.toLowerCase())
    const baseSym: Symbol | undefined = lookup(where, baseName)?.symbol
    // A library base's uri sits under "Library Manager"; its signature flattens sections, so it can't be
    // trusted for arity. `isLibrarySymbol` normalizes the `%20` the live server sends (a raw match missed it).
    if (baseSym === undefined || isLibrarySymbol(baseSym) || baseSym.ast.kind !== "function_block") {
      complete = false
      break
    }
    cur = baseSym.ast
    where = baseSym.owner
  }
  const sections: VarSection[] = []
  for (let i = chain.length - 1; i >= 0; i--) sections.push(...chain[i]) // base-first
  return { sections, complete }
}

const POSITIONAL_SECTIONS = new Set(["VAR_INPUT", "VAR_IN_OUT"]) // VAR_OUTPUT is never bound by position
const PARAM_SECTIONS = new Set(["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"]) // the name-bindable formal params

function calleeInfo(
  sym: Symbol,
  sections: readonly VarSection[],
  complete: boolean,
  scope: Scope | undefined,
): CalleeInfo {
  const paramNames = new Set<string>()
  const params: { name: Identifier; type: TypeExpr }[] = []
  const positional: { name: Identifier; type: TypeExpr; inOut: boolean }[] = []
  for (const sec of sections) {
    if (!PARAM_SECTIONS.has(sec.sectionKind)) continue // VAR/VAR_TEMP/VAR_STAT locals aren't parameters
    for (const d of sec.decls)
      for (const id of d.names) {
        paramNames.add(id.text.toLowerCase())
        if (POSITIONAL_SECTIONS.has(sec.sectionKind))
          positional.push({ name: id, type: d.type, inOut: sec.sectionKind === "VAR_IN_OUT" })
        if (sec.sectionKind === "VAR_INPUT") params.push({ name: id, type: d.type })
      }
  }
  return { sym, params, positional, positionalArity: positional.length, paramNames, scope, complete }
}

/** The member scope of a scoped type (enum/struct/FB), or undefined. */
function scopeOf(t: Type): Scope | undefined {
  return t.kind === "enum" || t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" ? t.scope : undefined
}

/** `GVL.field` → the flat project-level `gvl_var` sharing the block's uri, or undefined. */
function resolveGvlMember(
  expr: { base: Expr; member: { name: string } },
  scope: Scope,
  project: Scope,
): Symbol | undefined {
  if (expr.base.kind !== "ident_expr") return undefined
  const block = lookup(scope, expr.base.name)?.symbol
  if (block?.kind !== "gvl_block") return undefined
  for (const sym of lookupLocal(project, expr.member.name)) {
    if (sym.kind === "gvl_var" && sym.uri === block.uri) return sym
  }
  return undefined
}

/** The enclosing POU scope (walking out through method/accessor scopes) — the home of `THIS`. */
function enclosingPou(scope: Scope): Scope | undefined {
  let s: Scope | undefined = scope
  while (s !== undefined) {
    if (s.kind === "pou") return s
    s = s.parent
  }
  return undefined
}

/** `THIS` — the enclosing FB carrying its member scope. */
function thisType(scope: Scope): Type {
  const pou = enclosingPou(scope)
  return pou !== undefined ? { kind: "function_block", name: pou.name, scope: pou } : UNKNOWN
}

/** A bare name that names a GVL/enum/namespace/POU/struct scope (a static member base like `E.Idle`). */
function staticScopeType(project: Scope, name: string): Type | undefined {
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

function literalType(lit: Literal): Type {
  switch (lit.literalKind) {
    case "string":
      return elem("STRING")
    case "wstring":
      return elem("WSTRING")
    case "bool":
      return elem("BOOL")
    case "time":
      return elem("TIME")
    case "date":
      return elem("DATE")
    case "tod":
      return elem("TOD")
    case "datetime":
      return elem("DT")
    case "typed": {
      // `BYTE#170` / `INT#5` → the type prefix. `16#FF` (numeric base) has no type prefix → skip.
      const prefix = lit.prefix ?? ""
      return /^[A-Za-z_]/.test(prefix) ? elem(prefix) : UNKNOWN
    }
    default:
      // int / real / address literals are context-dependent width — skip (conservative).
      return UNKNOWN
  }
}

/** An elementary Type by name, or UNKNOWN if the name isn't elementary. */
function elem(name: string): Type {
  const e = elementaryType(name)
  return e !== undefined ? elementaryTypeRef(e) : UNKNOWN
}

const COMPARISON_OPS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

// IEC temporal arithmetic: DT − DT = TIME, DT ± TIME = DT. Names are canonical (DT/TOD/…).
const durationFor = (name: string): string => (name.startsWith("L") ? "LTIME" : "TIME")

function temporalArithResult(op: string, l: string, r: string): string | undefined {
  if (op === "-") {
    if (isDatetime(l) && l === r) return durationFor(l)
    if (isDatetime(l) && isDuration(r)) return l
  }
  if (op === "+") {
    if (isDatetime(l) && isDuration(r)) return l
    if (isDuration(l) && isDatetime(r)) return r
  }
  return undefined
}

function binaryResultType(e: BinaryExpr, scope: Scope, project: Scope): Type {
  if (COMPARISON_OPS.has(e.op)) return elem("BOOL")
  const l = inferExprType(e.left, scope, project)
  const r = inferExprType(e.right, scope, project)
  if (l.kind === "elementary" && r.kind === "elementary") {
    const temporal = temporalArithResult(e.op, canonicalElem(l.name), canonicalElem(r.name))
    if (temporal !== undefined) return elem(temporal)
    // Conservative: commit only when both operands are the same elementary type.
    if (canonicalElem(l.name) === canonicalElem(r.name)) return l
  }
  return UNKNOWN
}

function callReturnType(call: CallExpr, scope: Scope, project: Scope): Type {
  const sym = resolveMemberChain(call.callee, scope, project)
  return sym?.typeExpr !== undefined ? resolveTypeExpr(sym.typeExpr, project) : UNKNOWN
}
