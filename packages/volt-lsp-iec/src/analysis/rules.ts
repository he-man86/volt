/**
 * Rules (Layer D) — the diagnostics more than one checker applies. The ST checks under `checks/` and the network-text
 * checks in `network/` turn a store, a conversion argument or a binary operator into the same diagnostic with the same
 * wording. The rules lived inside check files, so the network layer imported three check files through the analysis
 * index (consolidate-lsp-structure C3).
 */
import { decodeStringLiteral, decodeUtf8Literal, typedLiteralForm, type BinaryExpr, type Expr, type Span, type Target } from "../frontend/syntax/index.js"
import { targetOf, type Scope } from "../frontend/symbols/index.js"
import { ARITHMETIC_OPERATORS, SHORT_CIRCUIT_OPERATORS, shortCircuitType, classifyConversion, constEval, isSameType, strictEnum, elementaryTypeRef, elemOf, inferExprType, isAssignable, literalCheckType, literalErrorType, operandFamilyRule, parseConversionName, renderType, type Type, UNKNOWN, untypedNumberValue } from "../frontend/types/index.js"
import { SOURCE, type DiagnosticItem } from "./diagnostic-item.js"
import { compilerStringLiteralText, type Messages } from "./messages.js"

// ─── checkable types ─────────────────────────────────────────────────────────

/** A type a conversion check can decide — elementary or enum, or a REFERENCE to one (it converts as its target and is
 *  named as itself, rule DT14) — else undefined (a struct, FB, array, pointer or unknown type). */
export function checkable(t: Type): Type | undefined {
  if (t.kind === "reference") return checkable(t.target) === undefined ? undefined : t
  return t.kind === "elementary" || t.kind === "enum" ? t : undefined
}

/**
 * An expression's checkable type — the ONE the assignment, narrowing and call-argument checks share. Inference types an
 * enum value as its enum, so there is no enum lookup here: each of those checks kept its own, and the call-argument copy
 * never learned an enum's base type (consolidate-lsp-structure B6).
 */
export function checkableType(expr: Expr, scope: Scope, project: Scope): Type | undefined {
  return checkable(inferExprType(expr, scope, project))
}

// ─── conversions ─────────────────────────────────────────────────────────────

/**
 * Map a source→value conversion to its narrowing / change-of-sign WARNING on `at`, or undefined. The ONE mapping — the
 * assignment pair, conversion arguments, the negation operand and call arguments all funnel through it, so the wording
 * stays byte-identical.
 */
export function conversionWarning(lhs: Type, rhs: Type, at: Expr, messages: Messages, target?: Target): DiagnosticItem | undefined {
  const kind = classifyConversion(lhs, rhs, target)
  if (kind === "enum-change")
    return conversionWarn(at, "enum-conversion", messages.enumConversion(renderType(rhs, { form: "compiler" }), renderType(lhs, { form: "compiler" })))
  if (kind === "narrow") return conversionWarn(at, "narrowing-conversion", messages.narrowing(renderType(rhs, { form: "compiler" }), renderType(lhs, { form: "compiler" })))
  if (kind === "sign-change")
    return conversionWarn(
      at,
      "sign-change-conversion",
      messages.signChange(signOf(rhs), renderType(rhs, { form: "compiler" }), signOf(lhs), renderType(lhs, { form: "compiler" })),
    )
  return undefined
}

const conversionWarn = (target: Expr, code: string, message: string): DiagnosticItem => ({
  severity: "warning",
  span: target.span,
  source: SOURCE,
  code,
  message,
})

function signOf(t0: Type): string {
  // the facts ride on the Type — no second lookup by name (consolidate-lsp-structure B1); an enum signs as its base, a
  // reference as its target, a pointer as the unsigned integer it is
  const t = t0.kind === "reference" ? t0.target : t0
  return elemOf(t.kind === "enum" && t.base !== undefined ? t.base : t)?.signed ? "signed" : "unsigned"
}

/**
 * The assignment-type-mismatch diagnostic for one `target := value` pair, or undefined when the compiler would accept it
 * (or either side isn't checkable). The ST assign check and the network-text sink check both call it.
 */
export function assignmentPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  // a POINTER target takes an integer by the target's rule (`compat` `integerIntoPointer`)
  const t = inferExprType(target, scope, project)
  const lhs = t.kind === "pointer" ? t : checkable(t)
  return lhs === undefined ? undefined : storeConversionError(lhs, value, target.span, scope, project, messages, "assignment")
}

/**
 * Where a store happens, which names a SUBRANGE target two ways: an ASSIGNMENT's in its assignment form, `UINT
 * (UINT#1..10)` on CODESYS, for a constant and a variable source alike (`subrange_assign_const_out`,
 * `dt_subrange_assign_variable`, both vendors 2026-10-03; `messages` `subrangeAssignTarget`); an initial value's, and
 * anything else, as the type is written, `UINT (1..10)` (`subrange_init_above_range`).
 */
export type StoreSite = "assignment" | "initial value" | "argument"

/** The name a store's target is given in its "Cannot convert" message — see `StoreSite`. */
function storeTargetName(lhs: Type, site: StoreSite, messages: Messages): string {
  if (site === "assignment" && lhs.kind === "elementary" && lhs.subrange !== undefined)
    return messages.subrangeAssignTarget(lhs.name, lhs.subrange.lower, lhs.subrange.upper)
  return renderType(lhs, { form: "compiler" })
}

/** The "Cannot convert" error for `value` stored into a `lhs` — an assignment or a declaration's initial value — reported
 *  at `span`, or undefined. An untyped numeric literal is typed by `literalErrorType` (gaps 13, 14); any other value by
 *  inference. */
export function storeConversionError(
  lhs: Type,
  value: Expr,
  span: Span,
  scope: Scope,
  project: Scope,
  messages: Messages,
  site: StoreSite,
): DiagnosticItem | undefined {
  const strict = strictEnumStore(lhs, value, scope, project, messages)
  if (strict !== "not-strict") return strict === "accepted" ? undefined : { severity: "error", span, source: SOURCE, code: "assignment-type-mismatch", message: strict }
  // A STRUCT stored into an elementary target is refused, named as the struct: "Cannot convert type 'VERSION' to type
  // 'STRING'" (`ty_version_into_string`, both vendors) — the struct case of rule CV1, unchecked until task 4.5.3 — and so
  // is every other value that is no elementary one: an FB instance, an interface, an array, THIS^, a name that denotes a
  // declaration (`dt_fb_instance_type_name`, `dt_interface_variable_type_name`, `dt_render_array_dims`, `dt_this_type`,
  // `dt_static_base_*`, CODESYS 2026-10-03; task 4.7.4). A METHOD's name is `checks/oop/method-reference`'s, under its code.
  const whole = inferExprType(value, scope, project)
  if (lhs.kind === "elementary" && refusedWhole(whole))
    return { severity: "error", span, source: SOURCE, code: "assignment-type-mismatch", message: messages.cannotConvert(renderType(whole, { form: "compiler" }), storeTargetName(lhs, site, messages)) }
  // …into a POINTER, an integer VARIABLE (`compat` `integerIntoPointer`, decided by the project's target); an untyped
  // literal into a pointer was never recorded (`cv_integers_into_pointer`, `cv_xword_into_pointer` store variables)
  if (lhs.kind === "pointer" && untypedNumberValue(value) !== undefined) return undefined
  const rhs = literalErrorType(value, lhs) ?? checkableType(value, scope, project)
  if (rhs === undefined || (lhs.kind === "pointer" && rhs.kind !== "elementary")) return undefined
  if (isAssignable(lhs, rhs, targetOf(project))) return undefined
  const display = rhsDisplay(value, rhs)
  if (display === undefined) return undefined
  return {
    severity: "error",
    span,
    source: SOURCE,
    code: "assignment-type-mismatch",
    message: messages.cannotConvert(display, storeTargetName(lhs, site, messages)),
  }
}

/** A value no elementary target takes whatever its type: a struct, an FB instance, an interface, an array, a name that
 *  denotes a declaration (rule DT8) — but a METHOD's name, whose check is `method-reference`'s. */
function refusedWhole(t: Type): boolean {
  if (t.kind === "static") return t.denotes !== "method"
  return t.kind === "struct" || t.kind === "function_block" || t.kind === "interface" || t.kind === "array"
}

/** How a member value of an enum folds, for the analysis: `constEval` in the project. */
const enumeratorValue = (project: Scope) => (e: Expr): bigint | undefined => {
  const v = constEval(e, project)
  return typeof v === "bigint" ? v : undefined
}

/** Is `t` a `{attribute 'strict'}` enum (P14, `types/enums` `strictEnum`)? */
export function isStrictEnum(t: Type, project: Scope): boolean {
  return strictEnum(project, t, enumeratorValue(project)) !== undefined
}

/**
 * A store INTO a `{attribute 'strict'}` enum (P14, `types/enums` `strictEnum`): "accepted" for a value of the enum itself
 * or an integer literal (plain, typed, negated) a member holds; the refusal's message for a variable or a literal of any
 * other kind, named by its text as written (`'i'`, `'5'`, `'-1'`, `'TRUE'` — `cv_scalars_into_strict_enum`,
 * `cv_literals_into_strict_enum`, `cv_strict_enum_from_other_enum`); "accepted" too for any other expression, whose
 * text the vendor's message was never measured with (missing, never wrong). "not-strict" when `lhs` is no strict enum.
 */
function strictEnumStore(lhs: Type, value: Expr, scope: Scope, project: Scope, messages: Messages): string | "accepted" | "not-strict" {
  const strict = strictEnum(project, lhs, enumeratorValue(project))
  if (strict === undefined) return "not-strict"
  // a REFERENCE reads as its target (rule DT14): a `REFERENCE TO` the enum is a value of it
  const read = inferExprType(value, scope, project)
  const rhs = read.kind === "reference" ? read.target : read
  if (rhs.kind === "enum" && isSameType(rhs, lhs)) return "accepted"
  const negated = value.kind === "unary" && value.op === "-" && value.operand.kind === "literal" ? value.operand : undefined
  const literal = value.kind === "literal" ? value : negated
  if (literal !== undefined) {
    const folded = constEval(value, scope)
    if (typeof folded === "bigint" && strict.values.has(folded)) return "accepted"
    return messages.strictEnumValue(negated !== undefined ? `-${literal.text}` : literal.text, strict.name)
  }
  if (value.kind === "ident_expr") return messages.strictEnumValue(value.name, strict.name)
  return "accepted"
}

/** The RHS type as the COMPILER renders it in the mismatch message — a string literal's own form, else the type's. */
function rhsDisplay(value: Expr, rhs: Type): string | undefined {
  const literal = stringLiteralMessageType(value)
  return literal === null ? renderType(rhs, { form: "compiler" }) : literal
}

/**
 * A STRING LITERAL'S TYPE as the compiler names it in a message — length-tagged, `STRING(INT#<len>)` (`WSTRING` for
 * `"…"`), by its DECODED length: `i := 'a$Tb'` is "Cannot convert type 'STRING(INT#3)' to type 'INT'" (conformance
 * `cc_string_escape_literal_into_int`). So is a quoted typed literal that is a STRING: `UTF8#'ä'` by its UTF-8 bytes,
 * STRING(INT#2); a `UCHAR#'AB'` by the token's own text it stands for, STRING(INT#8) (`lit_utf8_*_into_wstring`,
 * `lit_uchar_two_chars`, 2026-10-01). `null` for an expression that is no string literal; `undefined` for one whose
 * escape the shared decoder does not know — it has no measured length, and no message.
 */
export function stringLiteralMessageType(value: Expr): string | null | undefined {
  if (value.kind !== "literal") return null
  if (value.literalKind === "string" || value.literalKind === "wstring") {
    const wide = value.literalKind === "wstring"
    const decoded = decodeStringLiteral(value.value as string, wide)
    return decoded === undefined ? undefined : compilerStringLiteralText(decoded.length, wide)
  }
  if (value.literalKind !== "typed") return null
  const form = typedLiteralForm(value.text)
  const decoded = form.kind === "utf8" ? decodeUtf8Literal(form.raw) : form.kind === "text" ? decodeStringLiteral(form.raw) : null
  return decoded === null ? null : decoded === undefined ? undefined : compilerStringLiteralText(decoded.length, false)
}

/**
 * The implicit-conversion WARNING for one `target := value` pair, or undefined — for `classifyConversion` "narrow"
 * (loss) and "sign-change" (sign); the ERROR kinds are `storeConversionError`'s. The ST assign check and the
 * network-text sink check both call it.
 */
export function narrowingPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  const lhs = inferExprType(target, scope, project)
  // a store into a `strict` enum is refused or taken whole (`storeConversionError`), never warned about
  if (strictEnum(project, lhs, enumeratorValue(project)) !== undefined) return undefined
  // an untyped literal into a pointer is unjudged (`storeConversionError`)
  if (lhs.kind === "pointer" && untypedNumberValue(value) !== undefined) return undefined
  // an untyped integer literal the target cannot hold converts as its literal type (gap 13): `si := 128` warns USINT→SINT
  const rhs = literalCheckType(value, lhs) ?? checkableType(value, scope, project) ?? UNKNOWN
  return conversionWarning(lhs, rhs, target, messages, targetOf(project))
}

/**
 * The implicit-conversion WARNING for a conversion-function ARGUMENT, or undefined. `<SRC>_TO_<DST>(arg)` converts `arg`
 * to `<SRC>` first, so an `arg` that narrows/sign-changes into `<SRC>` warns exactly as `<SRC>Var := arg` would (the
 * textual `REAL_TO_DINT(EXPT(…))` and the graphical `UINT_TO_WORD(…)` corpus cases).
 */
export function conversionArgError(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind !== "call" || x.callee.kind !== "ident_expr") return undefined
  // The `<SRC>` before `_TO_` is the type the argument converts TO before the cast — where CODESYS emits the same
  // C0195/C0197 an assignment would (`UINT_TO_WORD(anINT)` warns "change of sign", `REAL_TO_DINT(anLREAL)` "loss").
  const srcElem = parseConversionName(x.callee.name, targetOf(project))?.from
  if (srcElem === undefined) return undefined // not a conversion, or `TO_STRING` (no explicit source)
  const arg = x.args[0]?.value
  if (arg === undefined) return undefined
  return conversionWarning(elementaryTypeRef(srcElem), inferExprType(arg, scope, project), arg, messages)
}

// ─── binary operators ────────────────────────────────────────────────────────


/**
 * The binary-operator-type-mismatch diagnostic for one binary node, or undefined — the ST body check and the network-text
 * operand check both call it. Both operands must be elementary (else skip, zero-FP): `MOD` on a non-integer, or
 * arithmetic mixing `BOOL` or a string with a numeric.
 */
export function binaryOpError(e: BinaryExpr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (!ARITHMETIC_OPERATORS.has(e.op)) return undefined
  // ARITHMETIC ON A `strict` ENUM is refused, once per operation whichever operand it is (`cv_strict_enum_arithmetic`:
  // `e - INT#1`, `e * 2`, `e + e` one message each; `prag_strict_enum_add_literal`, both vendors)
  for (const side of [e.left, e.right]) {
    const strict = strictEnum(project, inferExprType(side, scope, project), enumeratorValue(project))
    if (strict !== undefined) return binaryDiag(e, messages.strictEnumArithmetic(strict.name))
  }
  // A POINTER MINUS A REAL converts the REAL into the pointer, which it cannot: "Cannot convert type 'REAL' to type
  // 'POINTER TO INT'" (`dt_pointer_arithmetic_refused`, CODESYS 2026-10-03 — the only refused form of the four asked;
  // TwinCAT converts the pointer into the REAL instead, `messages` `pointerMinusReal`)
  const [lt, rt] = [inferExprType(e.left, scope, project), inferExprType(e.right, scope, project)]
  if (e.op === "-" && lt.kind === "pointer" && rt.kind === "elementary" && rt.elem.family === "real")
    return binaryDiag(e, messages.pointerMinusReal(renderType(rt, { form: "compiler" }), renderType(lt, { form: "compiler" })))
  const a = elemName(e.left, scope, project)
  const b = elemName(e.right, scope, project)
  if (a === undefined || b === undefined) return undefined
  // The rule is the type layer's (`operandFamilyRule`): a BOOL operand converts, MOD is integer-only and names
  // `REAL` for every floating operand (parity with the compiler's wording, not the more precise operand name), a
  // string converts to ANY_NUM or to the number beside it.
  const rule = operandFamilyRule(e.op, a, b)
  if (rule === undefined) return undefined
  return binaryDiag(e, rule.kind === "convert" ? messages.cannotConvert(rule.from, rule.to) : messages.modNotDefined(rule.type))
}

/**
 * AND_THEN / OR_ELSE on operands that are not two BOOLs (`types/arith/operators` `shortCircuitType`, rule CB5): each BOOL
 * operand refused into the integer they meet in, and that integer refused as the condition — "Cannot convert type 'BOOL'
 * to type 'UINT'", "Cannot convert type 'UINT' to type 'BOOL'" (`cb_and_then_bool_and_int`, `cb_and_then_on_int`,
 * `cb_and_then_on_word`, CODESYS 2026-10-03). The signed operands' warnings are `narrowing`'s.
 */
export function shortCircuitErrors(e: BinaryExpr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem[] {
  if (!SHORT_CIRCUIT_OPERATORS.has(e.op)) return []
  const sides = [inferExprType(e.left, scope, project), inferExprType(e.right, scope, project)]
  const meet = shortCircuitType(sides[0]!, sides[1]!)
  if (meet === undefined || meet.kind !== "elementary" || meet.elem.family === "bool") return []
  const into = renderType(meet, { form: "compiler" })
  return [
    ...sides.filter((t) => t.kind === "elementary" && t.elem.family === "bool").map(() => binaryDiag(e, messages.cannotConvert("BOOL", into))),
    binaryDiag(e, messages.cannotConvert(into, "BOOL")),
  ]
}

function binaryDiag(e: BinaryExpr, message: string): DiagnosticItem {
  return { severity: "error", span: e.span, source: SOURCE, code: "binary-op-type-mismatch", message }
}

function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" ? t.name : undefined
}

/** The control-variable families a FOR refuses, as measured: REAL/LREAL and BOOL — "Cannot convert type 'REAL' to type
 *  'ANY_INT'" (`stmt_for_real_control`, `stmt_for_bool_control`, both vendors 2026-10-02); an integer or a bit string
 *  counts (`stmt_for_dword_control`). `statement-rules` refuses the counter, `loop-exit` judges no such loop. */
export function isRefusedCounter(family: string): boolean {
  return family === "real" || family === "bool"
}
