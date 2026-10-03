/**
 * infer — the ONE expression type-inference engine. `inferExprType` is the front-end's public entry point: bottom-up
 * and total, every arm returns a rich `Type`, collapsing to `UNKNOWN` on any unresolved sub-part so consumers act only
 * on fully-known types. The rich `Type` carries element/target/scope inline, so `index`/`deref`/`member` read the
 * sub-type off the node instead of re-resolving a `TypeExpr`.
 *
 * What a name or a member chain denotes is `member.ts`; a call's callee and its parameters `callee.ts`.
 */
import { bareEnumMember, isLibrarySymbol, lookup, targetOf, type Scope } from "../../symbols/index.js"
import { selfRefKind, type BinaryExpr, type CallExpr, type Expr } from "../../syntax/index.js"
import { bitwiseLiteralOperandType, checkedMeetType, checkedNegationType, literalOperandType } from "../arith/checked.js"
import { temporalArithmeticType } from "../arith/temporal.js"
import {
  ARGUMENT_TYPED,
  bareBuiltinType,
  builtinCallResult,
  clockCallResult,
  exptCheckedType,
  MATH_ARG_TYPED,
  mathResultType,
  pointerTo,
  scalarStorageBytes,
  selectionValueArguments,
  sizeofResultType,
  twincatXaddResultType,
  type ExptArgument,
} from "../builtins.js"
import { aliasElem, elementaryType } from "../elementary.js"
import { resolveNamedType, resolveTypeExpr } from "../resolve.js"
import { elementaryRef, UNKNOWN, withoutSubrange, type Type } from "../type.js"
import { literalType, typedLiteralSum, untypedNumberValue } from "../literal.js"
import { ARITHMETIC_OPERATORS, BITWISE_OPERATORS, bitwiseLiteralResultType, bitwiseResultType, COMPARISON_OPERATORS, notResultType, pointerArithmeticType, SHORT_CIRCUIT_OPERATORS, shortCircuitType } from "../arith/operators.js"
import { enumStorage } from "../enums.js"
import { resolveMemberChain, enumValueType, memberScopeOf, staticScopeType, superType, thisType, staticNameOf, insideOwnBody } from "./member.js"

/** A CODESYS partial access's member name (`%X0`, `%b3`), one token (`lex/lexer`): its width letter. */
const PARTIAL_ACCESS = /^%([XBWD])\d+$/i
const PARTIAL_ACCESS_TYPE: Readonly<Record<string, string>> = { X: "BOOL", B: "BYTE", W: "WORD", D: "DWORD" }

/** Infer the type of an ST expression. `unknown` on any unresolved sub-part (conservative). */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr)
    case "ident_expr": {
      // THIS denotes the enclosing FB instance — resolve to its member scope so `THIS^.field` navigates.
      if (expr.name.toUpperCase() === "THIS") return thisType(scope)
      // …and SUPER its base's, so `SUPER^.Get()` navigates (rule E27)
      if (expr.name.toUpperCase() === "SUPER") return superType(scope)
      // `__POSITION` has a value without its parentheses (`builtins.ts` `bareBuiltinType`).
      const bare = bareBuiltinType(expr.name, project.dialect)
      if (bare !== undefined) return bare
      const sym = lookup(scope, expr.name)?.symbol ?? bareEnumMember(scope, expr.name)
      // a GVL's name, and a FUNCTION's or METHOD's where it is no call, denote the declaration (rule DT8)
      const denoted = sym === undefined ? undefined : staticNameOf(sym, scope)
      if (denoted !== undefined) return denoted
      // The declaring file is the asker: `v : ETRIG;` written inside CBML means CBML's ETRIG, no matter
      // which file is reading `v` now. Its bounds and lengths fold where it is declared (rule CE8): `v : INT(0..N)` with N
      // its POU's own CONSTANT is a subrange, and `a : ARRAY[0..N]` a sized array, wherever `v` is read.
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, sym.owner, sym.uri)
      const value = sym === undefined ? undefined : enumValueType(sym, project)
      if (value !== undefined) return value
      // Static base: the name denotes a GVL/enum/namespace/POU scope (`E_State.Idle`), not a typed var.
      return staticScopeType(project, expr.name) ?? UNKNOWN
    }
    case "global_expr": {
      // `.g` names the global past every local (rule E33): what the project scope holds under the name
      const sym = resolveMemberChain(expr, scope, project)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, sym.owner, sym.uri)
      return (sym === undefined ? undefined : enumValueType(sym, project)) ?? staticScopeType(project, expr.name.name) ?? UNKNOWN
    }
    case "member": {
      // CODESYS's PARTIAL ACCESS `d.%W0` is of the part it names: %X a BOOL, %B a BYTE, %W a WORD, %D a DWORD
      // (`operand_partial_*`, `accepts_partial_access`, `expr_partial_access_beside_undefined` build into those)
      const part = PARTIAL_ACCESS.exec(expr.member.name)?.[1]?.toUpperCase()
      if (part !== undefined) return elementaryRef(PARTIAL_ACCESS_TYPE[part]!)
      // THIS and SUPER without their `^` are the pointers, which have no members: `THIS.v` has no type
      // (`expr_this_member_without_deref`, `expr_super_without_deref`, both vendors)
      if (expr.base.kind === "ident_expr" && selfRefKind(expr.base.name) !== undefined) return UNKNOWN
      const sym = resolveMemberChain(expr, scope, project)
      // a METHOD named without its call is the method — 'VALUE' for `other.Value` (rule DT8)
      const denoted = sym === undefined ? undefined : staticNameOf(sym, scope)
      if (denoted !== undefined) return denoted
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, sym.owner, sym.uri)
      const value = sym === undefined ? undefined : enumValueType(sym, project)
      if (value !== undefined) return value
      // `Ns.Dep` — the namespace of a library `Ns` depends on, which `Ns` holds (rule LB8: `DED.CommFB.IO_SYSTEM_TYPE.PROFINET_IO`
      // builds and runs 2, `Util.Standard.LEN('abcd')` runs 4, `lib_ns_transitive_qualification*`, CODESYS 2026-10-02): a
      // static base, as the bare `Ns` is
      if (sym?.kind === "namespace") return staticScopeType(project, sym.name) ?? UNKNOWN
      // `Ns.E` — an ENUM a namespace holds is a static base, as the bare `E` is (rule EN6: `Util.WEEKDAY.THURSDAY`,
      // `enum_library_namespace_qualified`, builds and runs 4). Only an enum: no recording asks `Ns.Func` or `Ns.FB.x`,
      // and `staticScopeType` would call a FUNCTION an FB instance
      const holder = memberScopeOf(inferExprType(expr.base, scope, project))
      const held = holder?.kind === "namespace" ? staticScopeType(holder, expr.member.name) : undefined
      return held?.kind === "enum" ? held : UNKNOWN
    }
    case "index": {
      // an index through a REFERENCE TO an array reads the array (`decl_reference_to_array`, both vendors run `rf[1]`)
      const written = inferExprType(expr.base, scope, project)
      const base = written.kind === "reference" ? written.target : written
      if (base.kind === "array") return base.element
      // …and a POINTER indexed once is its target, `i` elements on (rule M3: `p[2].x` over `p : POINTER TO S` runs 30 in
      // `mem_pointer_index_struct_array`, both vendors build it); a second index is the arity error C0126, untyped
      return base.kind === "pointer" && expr.indices.length === 1 ? base.target : UNKNOWN
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
      // an operation on a SUBRANGE value yields its base, never the subrange (`dt_subrange_arithmetic_result`, rule DT3)
      const operand = withoutSubrange(inferExprType(expr.operand, scope, project))
      if (expr.op === "-") return checkedNegationType(operand)
      if (expr.op === "NOT") return notResultType(operand)
      return operand
    }
    case "binary":
      return binaryResultType(expr, scope, project)
    case "paren":
      return inferExprType(expr.inner, scope, project)
    // an inline assignment is worth what its TARGET then holds: `(a := b + INT#1) * INT#2` runs a * 2
    // (`expr_inline_assign_value`), and an untyped literal stored there is the target's type (`(b := 3)`)
    case "assign_expr":
      return inferExprType(expr.target, scope, project)
  }
}

function binaryResultType(e: BinaryExpr, scope: Scope, project: Scope): Type {
  if (COMPARISON_OPERATORS.has(e.op)) return elementaryRef("BOOL")
  // an ENUM operand of arithmetic computes in its base (`enums.ts` `enumBase`): `e + INT#1`, `e + 1` and `e + e` are INT,
  // `e * aDint` DINT (`cv_enum_arithmetic_type`, CODESYS 2026-10-03); an enum without a measured base stays itself
  // …and a SUBRANGE operand its base: `v + 1` (v an INT(0..10)) is an INT, `w * 2` (w a UINT(0..10)) a UINT
  // (`dt_subrange_arithmetic_result`, CODESYS 2026-10-03, rule DT3)
  let l = asOperand(withoutSubrange(inferExprType(e.left, scope, project)), e.op)
  let r = asOperand(withoutSubrange(inferExprType(e.right, scope, project)), e.op)
  // AND_THEN / OR_ELSE: BOOL, or the unsigned integer their operands meet in (`arith/operators` `shortCircuitType`, CB5)
  if (SHORT_CIRCUIT_OPERATORS.has(e.op)) return shortCircuitType(l, r) ?? UNKNOWN
  // POINTER ± integer, pointer − pointer (`arith/operators` `pointerArithmeticType`, rule DT13); an untyped INTEGER literal
  // counts as an integer — a REAL literal (a `number`) does not
  const pointer = pointerArithmeticType(e.op, l, r, typeof untypedNumberValue(e.left) === "bigint", typeof untypedNumberValue(e.right) === "bigint", project.dialect)
  if (pointer !== undefined) return pointer
  // an UNTYPED number beside a typed operand takes its type from it (`arith/checked` `literalOperandType`) — at a bit
  // operator the smallest UNSIGNED integer of at least its width (`bitwiseLiteralOperandType`), whose width a wider
  // literal then computes at (`bitwiseLiteralResultType`)
  const retype = ARITHMETIC_OPERATORS.has(e.op) ? literalOperandType : BITWISE_OPERATORS.has(e.op) ? bitwiseLiteralOperandType : undefined
  let widened: Type | undefined
  if (retype !== undefined) {
    const [lv, rv] = [untypedNumberValue(e.left), untypedNumberValue(e.right)]
    if (lv !== undefined && rv === undefined) l = retype(lv, r) ?? l
    else if (rv !== undefined && lv === undefined) r = retype(rv, l) ?? r
    if (BITWISE_OPERATORS.has(e.op)) widened = lv !== undefined && rv === undefined ? bitwiseLiteralResultType(r, l) : rv !== undefined && lv === undefined ? bitwiseLiteralResultType(l, r) : undefined
  }
  if (widened !== undefined) return widened
  if (l.kind === "elementary" && r.kind === "elementary") {
    const temporal = temporalArithmeticType(e.op, l, r)
    if (temporal !== undefined) return elementaryRef(temporal)
    const folded = e.op === "+" ? typedLiteralSum(e, l, r) : undefined
    if (folded !== undefined) return folded
    // THE MEASURED MEET, not "same type or nothing". This committed only when both operands were the SAME elementary
    // type, so every mixed expression inferred UNKNOWN — and an UNKNOWN source is assignable to anything, which meant
    // no check downstream could see it. `out := a + b` with `out : STRING` was silent for all seventy pairs in
    // `fixtures/operators/mixed-type.ts` while `out := a` was reported. `checkedMeetType` is the vendor's own answer
    // and still returns undefined for the pairs nothing recorded, which keeps the silence exactly where it was earned.
    // AND/OR/XOR COMPUTE IN THE UNSIGNED INTEGER OF THE OPERANDS' WIDTH. `out := a AND b` with LINT operands
    // is three warnings on CODESYS — one per operand going in, and one for the result coming back out into a
    // signed destination (`bit_{and,or,xor}_{sint,int,dint,lint}`). The result type is what carries the third:
    // typing it LINT made the assignment look clean. BOOL operands are boolean logic and keep their type; a bit
    // string is already unsigned and answers the same either way.
    const bitwise = BITWISE_OPERATORS.has(e.op) ? bitwiseResultType(l, r) : undefined
    if (bitwise !== undefined) return bitwise
    const meet = checkedMeetType(l, r)
    if (meet !== undefined) return meet
    if (aliasElem(l.name) === aliasElem(r.name)) return l
  }
  return UNKNOWN
}

/**
 * EXPT's checked type (`builtins.ts` `exptCheckedType`) over its arguments as inferred here. The reference catalog used
 * to say "always LREAL", from recollection — which made the narrowing check warn on `real := EXPT(real, real)`, code the
 * compiler accepts silently.
 */
function exptType(call: CallExpr, scope: Scope, project: Scope): Type {
  // Each argument is REAL, NOT REAL, or unknown. An integer LITERAL has no width but can never be a REAL, so it counts
  // as not-REAL: `REAL_TO_DINT(EXPT(10, n))` warns LREAL → REAL in a real project (build conformance). A REAL literal
  // can take either width, so it stays unknown.
  const kinds = call.args.map((a): ExptArgument => {
    if (a.value === undefined) return "unknown"
    if (a.value.kind === "literal") return typeof a.value.value === "bigint" ? "int-literal" : "unknown"
    const t = inferExprType(a.value, scope, project)
    if (t.kind !== "elementary" || elementaryType(t.name)?.rank === undefined) return "unknown"
    return aliasElem(t.name) === "REAL" ? "real" : "not-real"
  })
  return exptCheckedType(kinds)
}

/**
 * A BUILT-IN WHOSE RESULT IS A FUNCTION OF ITS ARGUMENTS (`builtins.ts` holds each rule), or undefined for any other name.
 * The selection functions return the MEET of their value arguments — the one a binary operator's operands reach. They
 * are extensible and type-dependent, so the catalog models no fixed result, and inferring UNKNOWN left `MIN(anInt, aUint)`
 * invisible to every check downstream. An argument whose type is unknown — an untyped literal takes its type from the
 * context — leaves the result unknown.
 */
function builtinArgumentResult(name: string, call: CallExpr, scope: Scope, project: Scope): Type | undefined {
  const upper = name.toUpperCase()
  const values = call.args.map((a) => a.value)
  const typeOf = (e: Expr | undefined): Type => (e === undefined ? UNKNOWN : inferExprType(e, scope, project))
  const selected = selectionValueArguments(upper, values)
  if (selected !== undefined) {
    const types = selected.map(typeOf)
    if (types.length === 0 || types.some((t) => t.kind !== "elementary")) return UNKNOWN
    return types.reduce((acc, t) => checkedMeetType(acc, t) ?? UNKNOWN)
  }
  const argument = ARGUMENT_TYPED.get(upper)
  if (argument !== undefined) {
    const t = typeOf(values[argument])
    return t.kind === "elementary" ? t : UNKNOWN
  }
  const clock = clockCallResult(upper, call.args.length)
  if (clock !== undefined) return clock
  if (call.args.length !== 1 && upper !== "__NEW") return undefined
  const operand = values[0]
  if (upper === "ADR") return pointerTo(operand === undefined ? UNKNOWN : valueOperandType(operand, scope, project))
  if (upper === "__NEW") return pointerTo(operand?.kind === "ident_expr" ? resolveNamedType(operand.name, project) : UNKNOWN)
  if (upper === "SIZEOF") {
    if (operand === undefined) return UNKNOWN
    const sized = sizedOperandType(operand, scope, project)
    // SIZEOF of a STRUCT or a UNION is a UINT, where SIZEOF of an elementary type, an enum, an alias or an array is the
    // smallest unsigned integer holding the size: a one-byte STRUCT, a one-byte UNION and a four-byte one are UINT, a
    // four-byte DINT USINT (`dt_sizeof_derived_type`, `dt_union_sizeof_type`, `ar_sizeof_type`, both vendors 2026-10-03).
    // Asked only where the size certainly fits a UINT — a larger one is unmeasured.
    if (sized.kind === "struct") {
      const bound = structSizeBound(sized, project)
      return bound !== undefined && bound < 65536n ? elementaryRef("UINT") : UNKNOWN
    }
    const bytes = storageBytes(sized, project)
    // an enum whose storage is no fact here (a library enum's base is not materialized) is still at most an LWORD: USINT
    // (`dt_sizeof_derived_type` — every enum's SIZEOF is one)
    if (bytes === undefined && sized.kind === "enum") return elementaryRef("USINT")
    return bytes === undefined ? UNKNOWN : sizeofResultType(bytes)
  }
  return undefined
}

/** A VALUE's type, as ADR addresses it — a variable, a member, an element or a dereference; anything else (a POU's
 *  name, a literal) unknown. */
function valueOperandType(e: Expr, scope: Scope, project: Scope): Type {
  if (e.kind === "ident_expr") {
    const sym = lookup(scope, e.name)?.symbol
    return sym !== undefined && VALUE_SYMBOLS.has(sym.kind) ? inferExprType(e, scope, project) : UNKNOWN
  }
  return e.kind === "member" || e.kind === "index" || e.kind === "deref" ? inferExprType(e, scope, project) : UNKNOWN
}

/** SIZEOF's value, in bytes: of a value or a TYPE named bare (`storageBytes`) — what a constant fold reads (`const/fold`). */
export function sizeofOperandBytes(e: Expr, scope: Scope, project: Scope): bigint | undefined {
  return storageBytes(sizedOperandType(e, scope, project), project)
}

/**
 * The bytes a value of `t` occupies where no layout question arises — `builtins` `scalarStorageBytes` (an elementary
 * type, an array of one), an ENUM as its storage (`enums` `enumStorage`: a written base, else INT — `dt_enum_*_storage`),
 * an array of any of these, and a UNION of them: its largest member, rounded up to its most aligned member's natural
 * alignment (BYTE|DWORD 4, BYTE|ARRAY[0..4] OF BYTE 5, LREAL|INT 8 — `dt_union_member_sizes`, `dt_union_*sizeof_bound`,
 * 2026-10-03). Undefined for a STRUCT, an FB, a pointer or anything else whose layout the memory model owns.
 */
function storageBytes(t: Type, project: Scope): bigint | undefined {
  if (t.kind === "enum") {
    const base = enumStorage(t)
    return base === undefined ? undefined : scalarStorageBytes(base)
  }
  if (t.kind === "array") {
    const element = storageBytes(t.element, project)
    if (element === undefined || t.bounds === undefined) return undefined
    return t.bounds.reduce((n, b) => n * (b.upper - b.lower + 1n), element)
  }
  if (t.kind === "struct") {
    if (t.union !== true) return undefined
    const members = fieldTypes(t, project)
    if (members === undefined || members.length === 0) return undefined
    let size = 0n
    let align = 1n
    for (const m of members) {
      const bytes = storageBytes(m, project)
      const a = alignmentOf(m)
      if (bytes === undefined || a === undefined) return undefined
      if (bytes > size) size = bytes
      if (a > align) align = a
    }
    return ((size + align - 1n) / align) * align
  }
  return scalarStorageBytes(t)
}

/** A member's natural alignment: an elementary type's own size up to 8 (a STRING 1, a WSTRING 2 — its code unit: a union of
 *  WSTRING(1) and ARRAY[0..4] OF BYTE is 6, `dt_union_wstring_sizeof_bound`, both vendors 2026-10-03), an array's
 *  element's, an enum's storage. */
function alignmentOf(t: Type): bigint | undefined {
  if (t.kind === "array") return alignmentOf(t.element)
  if (t.kind === "enum") {
    const base = enumStorage(t)
    return base === undefined ? undefined : alignmentOf(base)
  }
  if (t.kind !== "elementary") return undefined
  if (t.elem.family === "string") return BigInt(t.elem.bits / 8)
  const bytes = scalarStorageBytes(t)
  return bytes === undefined ? undefined : bytes > 8n ? 8n : bytes
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
function structSizeBound(t: Extract<Type, { kind: "struct" }>, project: Scope, depth = 0): bigint | undefined {
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
function sizedOperandType(e: Expr, scope: Scope, project: Scope): Type {
  if (e.kind === "ident_expr" && lookup(scope, e.name) === undefined) return resolveNamedType(e.name, project)
  return valueOperandType(e, scope, project)
}

/** The symbols that hold a value — a call of one calls what its type is. */
const VALUE_SYMBOLS: ReadonlySet<string> = new Set(["var", "gvl_var", "struct_field", "method_param"])
/** The types a value can have that are no call target. */
const NOT_CALLABLE: ReadonlySet<string> = new Set(["elementary", "enum", "struct", "array"])

function callReturnType(call: CallExpr, scope: Scope, project: Scope): Type {
  // A project function/method wins (user code can shadow a built-in name).
  const sym = resolveMemberChain(call.callee, scope, project)
  // a FUNCTION called inside its own body calls its RESULT VARIABLE (rule Y20), which is no call target: the call has no
  // result — "Program name, function or function block instance expected instead of 'F_C2_loop'" and "Cannot convert
  // type 'Unknown type: 'F_C2_loop(depth := (depth - INT#1))'' to type 'INT'" (`cc2_call_recursion`, both vendors)
  if (sym?.kind === "function" && call.callee.kind === "ident_expr" && insideOwnBody(sym, scope)) return UNKNOWN
  if (sym?.typeExpr !== undefined) {
    const declared = resolveTypeExpr(sym.typeExpr, project, 0, project, sym.uri)
    // a VALUE that is no call target has no result: `.gCall(1)` over an INT is "Unknown type: '.gCall(1)'" on both
    // vendors (`expr_global_namespace_call_non_callable`). A reference or pointer is judged by its target, as
    // `analysis/checks/calls/non-callable-call` judges it — a REFERENCE TO an FB is called (`xo_reference_to_fb_call`).
    // A CONSTANT is not asked: "called" in an aggregate it is a repeat count, `[L_UM1P_Internal.c_MaxTask(-1)]` (a
    // lenze library), which the parser reads as a call — its value is the element's, not nothing. Nor is a library's
    // value, whose declaration may be partial (that list's CONSTANT is not in its signature).
    const target = declared.kind === "pointer" || declared.kind === "reference" ? declared.target : declared
    if (VALUE_SYMBOLS.has(sym.kind) && sym.constant !== true && !isLibrarySymbol(sym) && NOT_CALLABLE.has(target.kind)) return UNKNOWN
    return declared
  }
  // An element of an array of instances, called (`inst[0]()`), is the instance `inst()` is — typed alike, by the type
  // the element has; it has no symbol of its own to carry one. So is a dereferenced instance: `SUPER^(…)`, `p^(…)`
  // (rule M3, `mem_super_call_unknown_param`, `callshape_super_own_fields`).
  if (call.callee.kind === "index" || call.callee.kind === "deref") {
    const element = inferExprType(call.callee, scope, project)
    if (element.kind === "function_block") return element
  }
  if (call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "EXPT") return exptType(call, scope, project)
  if (call.callee.kind === "ident_expr") {
    const builtin = builtinArgumentResult(call.callee.name, call, scope, project)
    if (builtin !== undefined) return builtin
  }
  // TwinCAT's `__XADD` hands back what it was given (`builtins.ts` `twincatXaddResultType`).
  if (project.dialect === "twincat" && call.callee.kind === "ident_expr" && call.callee.name.toUpperCase() === "__XADD") {
    const first = call.args[0]?.value
    return twincatXaddResultType(first === undefined ? UNKNOWN : inferExprType(first, scope, project))
  }
  // A one-argument math function hands back the real it was given (`builtins.ts` `mathResultType`).
  if (call.callee.kind === "ident_expr" && MATH_ARG_TYPED.has(call.callee.name.toUpperCase()) && call.args.length === 1) {
    const arg = call.args[0]?.value
    const result = mathResultType(arg === undefined ? UNKNOWN : inferExprType(arg, scope, project), arg?.kind === "literal")
    if (result !== undefined) return result
  }
  // Otherwise a built-in call: a conversion, or an operator with a FIXED result (`builtins.ts` `builtinCallResult`).
  // Flows a built-in's result into downstream checks — e.g. `REAL_TO_DINT(EXPT(…))` needs EXPT's type to see an
  // implicit LREAL→REAL narrowing on the argument.
  if (call.callee.kind === "ident_expr") {
    const builtin = builtinCallResult(call.callee.name, project.dialect, targetOf(project))
    if (builtin !== undefined) return builtin
  }
  return UNKNOWN
}

/** An operand as an operator reads it: a REFERENCE as what it refers to (`ri + 1` is INT, `ri * rr` REAL —
 *  `dt_reference_auto_deref_type`, rule DT14); at ARITHMETIC an enum with a measured base as that base (`cv_enum_arithmetic_type`). */
function asOperand(t0: Type, op: string): Type {
  const t = t0.kind === "reference" ? t0.target : t0
  return ARITHMETIC_OPERATORS.has(op) && t.kind === "enum" && t.base !== undefined ? t.base : t
}
