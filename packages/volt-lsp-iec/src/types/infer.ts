/**
 * infer — the ONE expression type-inference engine (Layer C, C.4). `inferExprType` is the frontend's
 * public entry point (architecture invariant). Bottom-up and total: every arm returns a rich `Type`,
 * collapsing to `UNKNOWN` on any unresolved sub-part so consumers act only on fully-known types (C.6).
 *
 * The rich `Type` carries element/target/scope inline, so `index`/`deref`/`member` read the sub-type
 * off the node instead of re-resolving a `TypeExpr` (the win of the folded model).
 */
import type { Scope, Symbol } from "../symbols/index.js"
import { childScopesByName, lookup, lookupLocal, isLibrarySymbol, resolveBareEnumMember, resolveGvlMember } from "../symbols/index.js"
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
import { checkedMeetType, checkedNegationType, exptResultType, temporalResultType } from "./arith.js"
import { canonicalElem, elementaryType, integerLiteralType, parseConversionName, REAL_LITERAL_TYPE } from "./elementary.js"
import { resolveNamedType, resolveTypeExpr } from "./resolve.js"
import { elementaryRef, elementaryTypeRef, UNKNOWN, type Type } from "./type.js"
// Inherent cycle: type inference resolves references via the reference catalog, which itself depends on the type system (bidirectional by design). Function-body import, no init hazard.
import { lookupReference } from "../reference/index.js"

/** Infer the type of an ST expression. `unknown` on any unresolved sub-part (conservative). */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr)
    case "ident_expr": {
      // THIS denotes the enclosing FB instance — resolve to its member scope so `THIS^.field` navigates.
      if (expr.name.toUpperCase() === "THIS") return thisType(scope)
      const sym = lookup(scope, expr.name)?.symbol ?? resolveBareEnumMember(project, expr.name)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project)
      const value = sym === undefined ? undefined : enumValueType(sym, project)
      if (value !== undefined) return value
      // Static base: the name denotes a GVL/enum/namespace/POU scope (`E_State.Idle`), not a typed var.
      return staticScopeType(project, expr.name) ?? UNKNOWN
    }
    case "member": {
      const sym = resolveMemberChain(expr, scope, project)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project)
      return (sym === undefined ? undefined : enumValueType(sym, project)) ?? UNKNOWN
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
    case "unary": {
      // `+` keeps the operand's type; unary MINUS does not (see `checkedNegationType`); and NOT keeps it EXCEPT on a
      // signed integer, where the result is the UNSIGNED type of the same width.
      //
      // That last part is the same fact the sign-change warning already states — "AND, OR, XOR and NOT meet in the
      // UNSIGNED integer of the width" (`checks/types/narrowing.ts`) — and it was applied to the OPERAND and not to
      // the RESULT, so only half of what CODESYS reports could be reproduced. Measured on `not_result_width`, with
      // `i5 : INT`: `NOT i5` into a DINT or an LREAL is silent (a UINT widens into either without a sign change),
      // and into an INT it warns "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT'". Three
      // assignments of the same expression, two answers — which only makes sense if the expression is UINT.
      //
      // A BOOL operand is a logical NOT and keeps BOOL; an already-unsigned operand keeps its own type. Both fall out
      // of the guard rather than needing a case.
      const operand = inferExprType(expr.operand, scope, project)
      if (expr.op === "-") return checkedNegationType(operand)
      if (expr.op === "NOT") {
        // THE UNSIGNED INTEGER OF THE OPERAND'S WIDTH — for a bit string and a duration too, not only a signed
        // integer. Measured one type at a time (`uop_not_*`): `NOT BYTE` is USINT, `NOT WORD` is UINT, `NOT DWORD`
        // and `NOT TIME` and `NOT DATE` are UDINT, `NOT LWORD` is ULINT. BOOL is a logical NOT and stays BOOL; a
        // REAL or a STRING passes through and is reported against ANY_BIT instead.
        const e = operand.kind === "elementary" ? operand.elem : undefined
        const widthed = e !== undefined && e.family !== "bool" && e.family !== "real" && e.family !== "string"
        if (widthed && e.bits !== undefined)
          return elementaryTypeRef(elementaryType(e.bits <= 8 ? "USINT" : e.bits <= 16 ? "UINT" : e.bits <= 32 ? "UDINT" : "ULINT")!)
      }
      return operand
    }
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
  const params: { name: Identifier; type: TypeExpr; hasDefault: boolean }[] = []
  const positional: { name: Identifier; type: TypeExpr; inOut: boolean; constant: boolean }[] = []
  for (const sec of sections) {
    if (!PARAM_SECTIONS.has(sec.sectionKind)) continue // VAR/VAR_TEMP/VAR_STAT locals aren't parameters
    for (const d of sec.decls)
      for (const id of d.names) {
        paramNames.add(id.text.toLowerCase())
        if (POSITIONAL_SECTIONS.has(sec.sectionKind))
          positional.push({ name: id, type: d.type, inOut: sec.sectionKind === "VAR_IN_OUT", constant: sec.constant === true })
        if (sec.sectionKind === "VAR_INPUT") params.push({ name: id, type: d.type, hasDefault: d.init !== undefined })
      }
  }
  return { sym, params, positional, positionalArity: positional.length, paramNames, scope, complete }
}

/** The member scope of a scoped type (enum, struct, FB, interface), or undefined. Completion kept a copy. */
export function memberScopeOf(t: Type): Scope | undefined {
  return t.kind === "enum" || t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" ? t.scope : undefined
}

/** The enclosing POU scope (walking out through method/accessor scopes) — the home of `THIS`. */
/**
 * An enum VALUE's type: its enum, resolved by name so it carries the base type (`EnumType.base`). Only a value owned by
 * a real enum scope counts — an inline enum's values live in the enclosing POU's scope, and typing them would name the
 * POU. Inference returned UNKNOWN for every enum value, so assignment, narrowing and call arguments each re-resolved one —
 * and the call-argument copy never learned the base type (consolidate-lsp-structure B6).
 */
function enumValueType(sym: Symbol, project: Scope): Type | undefined {
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

/**
 * The type an untyped integer literal is CHECKED as against an integer or bit-string target — or undefined when there is
 * nothing to check: not such a literal, not such a target, or a value the target holds (`us := 5`, `b := 255`, `i := 200`
 * are silent). A value the target cannot hold takes `integerLiteralType` and converts like a variable of it (gap 13,
 * conformance `overflow_*`, `cc_literal_*`, `cc_fp_literal_*`): `b : BYTE := 300` is "Cannot convert type 'INT' to type
 * 'BYTE'", `si := 128` warns "unsigned Type 'USINT' to signed Type 'SINT'", `us := -1` warns "signed Type 'SINT' to
 * unsigned Type 'USINT'". Other targets (REAL, TIME, BOOL) are not measured, and stay unchecked.
 */
export function literalCheckType(value: Expr, target: Type): Type | undefined {
  const negated = value.kind === "unary" && value.op === "-"
  const lit = negated ? value.operand : value
  // A real literal beyond REAL's largest value is an LREAL: `rv : REAL := 3.4028235E38` warns LREAL → REAL, `1.5E8` and
  // `2.5E-10` do not (conformance `cc_real_init_max`, `_sci_fraction`, `_tiny`). A literal too small for a REAL is unmeasured.
  if (lit.kind === "literal" && typeof lit.value === "number" && target.kind === "elementary" && target.elem.family === "real")
    return target.elem.bits === 32 && Math.abs(lit.value) > 3.4028234663852886e38 ? elementaryRef("LREAL") : undefined
  if (lit.kind !== "literal" || lit.literalKind !== "int" || typeof lit.value !== "bigint") return undefined
  const family = target.kind === "elementary" ? target.elem.family : undefined
  const range = target.kind === "elementary" && (family === "int" || family === "bitstring") ? target.elem.range : undefined
  if (range === undefined) return undefined
  const v = negated ? -lit.value : lit.value
  if (v >= range.min && v <= range.max) return undefined
  const t = integerLiteralType(v)
  return t === undefined ? undefined : elementaryTypeRef(t)
}

/**
 * The type an untyped numeric literal is checked as for the "Cannot convert" ERROR when stored into `target` (an
 * assignment or a declaration's initial value) — or undefined when there is nothing to check. Recorded on CODESYS
 * (conformance `cc_init_*`, `cc_assign_*`, `cc_literal_*`, consolidate-lsp-structure A13):
 *   - an integer the target holds is silent — an integer or bit-string target in range, and a BOOL takes 0 and 1
 *     (`b := 1` is silent, `b := 2` is "Cannot convert type 'SINT' to type 'BOOL'");
 *   - any other integer is its narrowest type (`integerLiteralType`) — `t := 5` is "Cannot convert type 'SINT' to type 'TIME'";
 *   - a real literal is LREAL — `i := 1.5` is "Cannot convert type 'LREAL' to type 'INT'", and into REAL or LREAL it
 *     converts silently (a narrowing, never an error).
 * The WARNING checks keep `literalCheckType`: a literal's sign-change and loss warnings are measured only for integer
 * targets.
 */
export function literalErrorType(value: Expr, target: Type): Type | undefined {
  const negated = value.kind === "unary" && value.op === "-"
  const lit = negated ? value.operand : value
  if (lit.kind !== "literal") return undefined
  if (lit.literalKind === "real" && typeof lit.value === "number") return elementaryRef(REAL_LITERAL_TYPE)
  if (lit.literalKind !== "int" || typeof lit.value !== "bigint") return undefined
  const v = negated ? -lit.value : lit.value
  if (target.kind === "elementary" && target.elem.family === "bool") {
    if (v === 0n || v === 1n) return undefined
  } else {
    const range = target.kind === "elementary" && ["int", "bitstring"].includes(target.elem.family) ? target.elem.range : undefined
    if (range !== undefined && v >= range.min && v <= range.max) return undefined
  }
  const t = integerLiteralType(v)
  return t === undefined ? undefined : elementaryTypeRef(t)
}

/**
 * A literal's OWN type — the one its prefix or kind decides (`INT#5`, `LTIME#1S`, `LDT#…`, a string). An untyped
 * integer or real takes its type from context, so it is UNKNOWN here; lowering adopts the context, and the checks use
 * `literalCheckType`/`literalErrorType`. Shared with the transpiler, which had its own copy of the date/time prefixes.
 */
export function literalType(lit: Literal): Type {
  switch (lit.literalKind) {
    case "string":
      return elementaryRef("STRING")
    case "wstring":
      return elementaryRef("WSTRING")
    case "bool":
      return elementaryRef("BOOL")
    case "time":
      // The AST gives `T#` and `LTIME#` one literalKind; the prefix decides. Typed TIME, `lt := LTIME#1S` was a false
      // positive and `t := LTIME#1S` was silent (gap 8, conformance `cc_ltime_literal_into_time`).
      // (`LTIME#` only: the lexer reads `LT` as the less-than keyword, and an `LT#` prefix was never measured)
      return elementaryRef(/^LTIME#/i.test(lit.text) ? "LTIME" : "TIME")
    // An `L` prefix (`LDATE#`, `LTOD#`/`LTIME_OF_DAY#`, `LDT#`/`LDATE_AND_TIME#`) is the 64-bit type. These were typed
    // DATE/TOD/DT whatever the prefix, while lowering typed them right (consolidate-lsp-structure A2).
    case "date":
      return elementaryRef(/^L/i.test(lit.text) ? "LDATE" : "DATE")
    case "tod":
      return elementaryRef(/^L/i.test(lit.text) ? "LTOD" : "TOD")
    case "datetime":
      return elementaryRef(/^L/i.test(lit.text) ? "LDT" : "DT")
    case "typed": {
      // `BYTE#170` / `INT#5` → the type prefix. `16#FF` (numeric base) has no type prefix → skip.
      const prefix = lit.prefix ?? ""
      // A CHARACTER literal is the exception: `UCHAR#'A'` is a character CODE, and CODESYS types it UDINT rather
      // than by its prefix — `bChar : BYTE := UCHAR#'A'` is "Cannot convert type 'UDINT' to type 'BYTE'"
      // (conformance `operand_uchar_literal`). Only UCHAR is measured; another char prefix keeps its own name.
      if (/^UCHAR$/i.test(prefix)) return elementaryRef("UDINT")
      return /^[A-Za-z_]/.test(prefix) ? elementaryRef(prefix) : UNKNOWN
    }
    default:
      // int / real / address literals are context-dependent width — skip (conservative).
      return UNKNOWN
  }
}



const COMPARISON_OPS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="])

function binaryResultType(e: BinaryExpr, scope: Scope, project: Scope): Type {
  if (COMPARISON_OPS.has(e.op)) return elementaryRef("BOOL")
  const l = inferExprType(e.left, scope, project)
  const r = inferExprType(e.right, scope, project)
  if (l.kind === "elementary" && r.kind === "elementary") {
    const temporal = e.op === "+" || e.op === "-" ? temporalResultType(e.op, l.name, r.name) : undefined
    if (temporal !== undefined) return elementaryRef(temporal)
    const folded = e.op === "+" ? typedLiteralSum(e, l, r) : undefined
    if (folded !== undefined) return folded
    // THE MEASURED MEET, not "same type or nothing". This committed only when both operands were the SAME elementary
    // type, so every mixed expression inferred UNKNOWN — and an UNKNOWN source is assignable to anything, which meant
    // no check downstream could see it. `out := a + b` with `out : STRING` was silent for all seventy pairs in
    // `fixtures/operators/mixed-type.ts` while `out := a` was reported. `checkedMeetType` is the vendor's own answer
    // and still returns undefined for the pairs nothing recorded, which keeps the silence exactly where it was earned.
    const meet = checkedMeetType(l, r)
    if (meet !== undefined) return meet
    if (canonicalElem(l.name) === canonicalElem(r.name)) return l
  }
  return UNKNOWN
}

/**
 * A `+` of two integer literals typed alike folds into the narrowest type of their signedness, from their width up, that
 * holds the sum (conformance `cc_typed_fold_*`, `typed_literal_constant_fold`): USINT#200 + USINT#100 is UINT (a change of
 * sign into INT), INT#30000 + INT#30000 is DINT ("Cannot convert type 'DINT' to type 'INT'"), SINT#100 + SINT#100 is INT
 * and USINT#1 + USINT#2 stays USINT. Other operators, bit strings and a typed-plus-untyped pair are unmeasured.
 */
function typedLiteralSum(e: BinaryExpr, l: Type, r: Type): Type | undefined {
  const { left, right } = e
  if (left.kind !== "literal" || right.kind !== "literal" || left.literalKind !== "typed" || right.literalKind !== "typed") return undefined
  if (typeof left.value !== "bigint" || typeof right.value !== "bigint") return undefined
  if (l.kind !== "elementary" || r.kind !== "elementary" || l.elem.family !== "int" || canonicalElem(l.name) !== canonicalElem(r.name)) return undefined
  const sum = left.value + right.value
  const order = l.elem.signed === true ? ["SINT", "INT", "DINT", "LINT"] : ["USINT", "UINT", "UDINT", "ULINT"]
  const fits = order.map((name) => elementaryType(name)!).find((t) => t.bits >= l.elem.bits && sum >= t.range!.min && sum <= t.range!.max)
  return fits === undefined ? undefined : elementaryRef(fits.name)
}

/**
 * EXPT's checked type — `exptResultType` once both arguments are known. An unknown argument keeps it UNKNOWN. The
 * reference catalog used to say "always LREAL", from recollection — which made the narrowing check warn on
 * `real := EXPT(real, real)`, code the compiler accepts silently.
 */
function exptType(call: CallExpr, scope: Scope, project: Scope): Type {
  // Each argument is REAL, NOT REAL, or unknown. An integer LITERAL has no width but can never be a REAL, so it counts
  // as not-REAL: `REAL_TO_DINT(EXPT(10, n))` warns LREAL → REAL in a real project (build conformance). A REAL literal
  // can take either width, so it stays unknown.
  const kinds = call.args.map((a): "real" | "not-real" | "int-literal" | "unknown" => {
    if (a.value === undefined) return "unknown"
    if (a.value.kind === "literal") return typeof a.value.value === "bigint" ? "int-literal" : "unknown"
    const t = inferExprType(a.value, scope, project)
    if (t.kind !== "elementary" || elementaryType(t.name)?.rank === undefined) return "unknown"
    return canonicalElem(t.name) === "REAL" ? "real" : "not-real"
  })
  if (kinds.length !== 2 || kinds.includes("unknown")) return UNKNOWN
  // A REAL beside an integer literal was not measured — silence rather than a guessed type.
  if (kinds.includes("real") && kinds.includes("int-literal")) return UNKNOWN
  const asType = (k: string): Type => elementaryRef(k === "real" ? "REAL" : "LINT")
  return exptResultType(asType(kinds[0]!), asType(kinds[1]!))
}

function callReturnType(call: CallExpr, scope: Scope, project: Scope): Type {
  // A project function/method wins (user code can shadow a built-in name).
  const sym = resolveMemberChain(call.callee, scope, project)
  if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project)
  if (call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "EXPT") return exptType(call, scope, project)
  // Otherwise a built-in call: a conversion `<X>_TO_<Y>`/`TO_<Y>` yields elementary `<Y>`; an operator with a
  // FIXED modeled return type yields that. Flows a built-in's result into downstream checks — e.g.
  // `REAL_TO_DINT(EXPT(…))` needs EXPT's type to see an implicit LREAL→REAL narrowing on the argument.
  if (call.callee.kind === "ident_expr") {
    const modeled = parseConversionName(call.callee.name)?.to.name ?? lookupReference(call.callee.name)?.returnType
    if (modeled !== undefined) {
      const elem = elementaryType(modeled)
      if (elem !== undefined) return elementaryTypeRef(elem)
    }
  }
  return UNKNOWN
}
