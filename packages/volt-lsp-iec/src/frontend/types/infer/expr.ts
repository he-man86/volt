/**
 * infer — the ONE expression type-inference engine. `inferExprType` is the front-end's public entry point: bottom-up
 * and total, every arm returns a rich `Type`, collapsing to `UNKNOWN` on any unresolved sub-part so consumers act only
 * on fully-known types. The rich `Type` carries element/target/scope inline, so `index`/`deref`/`member` read the
 * sub-type off the node instead of re-resolving a `TypeExpr`.
 *
 * What a name or a member chain denotes is `member.ts`; a call's callee and its parameters `callee.ts`.
 */
import { bareEnumMember, lookup, type Scope } from "../../symbols/index.js"
import { globalClash } from "../names.js"
import { selfRefKind, type BinaryExpr, type Expr } from "../../syntax/index.js"
import { bitwiseLiteralOperandType, checkedMeetType, checkedNegationType, literalOperandType } from "../arith/checked.js"
import { temporalArithmeticType } from "../arith/temporal.js"
import { bareBuiltinType } from "../builtins.js"
import { aliasElem } from "../elementary.js"
import { resolveTypeExpr } from "../resolve.js"
import { elementaryRef, UNKNOWN, withoutSubrange, type Type } from "../type.js"
import { literalType, typedLiteralSum, untypedNumberValue } from "../literal.js"
import { ARITHMETIC_OPERATORS, BITWISE_OPERATORS, bitwiseLiteralResultType, bitwiseResultType, COMPARISON_OPERATORS, notResultType, pointerArithmeticType, SHORT_CIRCUIT_OPERATORS, shortCircuitType } from "../arith/operators.js"
import {
  resolveMemberChain,
  enumValueType,
  memberScopeOf,
  staticScopeType,
  superType,
  thisType,
  staticNameOf,
} from "./member.js"
import { callReturnType } from "./builtin-call.js"
import { wireType } from "./network-call.js"

/** A CODESYS partial access's member name (`%X0`, `%b3`), one token (`lex/lexer`): its width letter. */
const PARTIAL_ACCESS = /^%([XBWD])\d+$/i
const PARTIAL_ACCESS_TYPE: Readonly<Record<string, string>> = { X: "BOOL", B: "BYTE", W: "WORD", D: "DWORD" }

/** Infer the type of an ST expression. `unknown` on any unresolved sub-part (conservative). */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): Type {
  switch (expr.kind) {
    case "literal":
      return literalType(expr)
    case "ident_expr":
      return identType(expr, scope, project)
    case "global_expr": {
      // `.g` names the global past every local (rule E33): what the project scope holds under the name
      const sym = resolveMemberChain(expr, scope, project)
      if (sym?.typeExpr !== undefined) return resolveTypeExpr(sym.typeExpr, project, 0, sym.owner, sym.uri)
      return (sym === undefined ? undefined : enumValueType(sym, project)) ?? staticScopeType(project, expr.name.name) ?? UNKNOWN
    }
    case "member":
      return memberType(expr, scope, project)
    case "index":
      return indexType(expr, scope, project)
    case "deref": {
      const base = inferExprType(expr.base, scope, project)
      if (base.kind === "pointer" || base.kind === "reference") return base.target
      // `THIS^` / a ref already resolved to its target: dereffing a scoped value is identity.
      return base.kind === "function_block" || base.kind === "struct" || base.kind === "enum" ? base : UNKNOWN
    }
    case "call":
      return callReturnType(expr, scope, project)
    case "unary":
      return unaryType(expr, scope, project)
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

function identType(expr: Extract<Expr, { kind: "ident_expr" }>, scope: Scope, project: Scope): Type {
  // THIS denotes the enclosing FB instance — resolve to its member scope so `THIS^.field` navigates.
  if (expr.name.toUpperCase() === "THIS") return thisType(scope)
  // …and SUPER its base's, so `SUPER^.Get()` navigates (rule E27)
  if (expr.name.toUpperCase() === "SUPER") return superType(scope)
  // `__POSITION` has a value without its parentheses (`builtins.ts` `bareBuiltinType`).
  const bare = bareBuiltinType(expr.name, project.dialect)
  if (bare !== undefined) return bare
  const sym = lookup(scope, expr.name)?.symbol ?? bareEnumMember(scope, expr.name)
  // a global that clashes — two of the project's lists, or a global and an own enum's member — names nothing, so it
  // has no type (`names.ts` `globalClash`)
  if (sym?.kind === "gvl_var" && globalClash(scope, sym, expr.name) !== undefined) return UNKNOWN
  // a plain-ST network body's wire is of its definition's type (`network-call.ts`)
  if (sym?.wire !== undefined) return wireType(sym, project)
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

function memberType(expr: Extract<Expr, { kind: "member" }>, scope: Scope, project: Scope): Type {
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

function indexType(expr: Extract<Expr, { kind: "index" }>, scope: Scope, project: Scope): Type {
  // an index through a REFERENCE TO an array reads the array (`decl_reference_to_array`, both vendors run `rf[1]`)
  const written = inferExprType(expr.base, scope, project)
  const base = written.kind === "reference" ? written.target : written
  if (base.kind === "array") return base.element
  // …and a STRING indexed is one of its units: a BYTE, a WSTRING's a WORD (`lib_prim_char_past_length` records `BYTE#…`,
  // `string_non_ascii_bytes` `text[0]` = BYTE#99; lsp-transpile-review-gaps 2.3)
  if (base.kind === "elementary" && base.elem.family === "string" && expr.indices.length === 1) return elementaryRef(base.elem.bits === 16 ? "WORD" : "BYTE")
  // …and a POINTER indexed once is its target, `i` elements on (rule M3: `p[2].x` over `p : POINTER TO S` runs 30 in
  // `mem_pointer_index_struct_array`, both vendors build it); a second index is the arity error C0126, untyped
  return base.kind === "pointer" && expr.indices.length === 1 ? base.target : UNKNOWN
}

function unaryType(expr: Extract<Expr, { kind: "unary" }>, scope: Scope, project: Scope): Type {
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

/** An operand as an operator reads it: a REFERENCE as what it refers to (`ri + 1` is INT, `ri * rr` REAL —
 *  `dt_reference_auto_deref_type`, rule DT14); at ARITHMETIC an enum with a measured base as that base (`cv_enum_arithmetic_type`). */
function asOperand(t0: Type, op: string): Type {
  const t = t0.kind === "reference" ? t0.target : t0
  return ARITHMETIC_OPERATORS.has(op) && t.kind === "enum" && t.base !== undefined ? t.base : t
}
