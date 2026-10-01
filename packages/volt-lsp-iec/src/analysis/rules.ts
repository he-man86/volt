/**
 * Rules (Layer D) — the diagnostics more than one checker applies. The ST checks under `checks/` and the network-text
 * checks in `network/` turn a store, a conversion argument or a binary operator into the same diagnostic with the same
 * wording. The rules lived inside check files, so the network layer imported three check files through the analysis
 * index (consolidate-lsp-structure C3).
 */
import { decodeStringLiteral, decodeUtf8Literal, typedLiteralForm, type BinaryExpr, type Expr, type Span } from "../frontend/syntax/index.js"
import type { Scope } from "../frontend/symbols/index.js"
import { ARITHMETIC_OPERATORS, classifyConversion, elementaryTypeRef, elemOf, inferExprType, isAssignable, literalCheckType, literalErrorType, operandFamilyRule, parseConversionName, renderType, type Type, UNKNOWN } from "../frontend/types/index.js"
import { SOURCE, type DiagnosticItem } from "./diagnostic-item.js"
import { compilerStringLiteralText, type Messages } from "./messages.js"

// ─── checkable types ─────────────────────────────────────────────────────────

/** A type a conversion check can decide — elementary or enum — else undefined (a struct, FB, array or unknown type). */
export function checkable(t: Type): Type | undefined {
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
export function conversionWarning(lhs: Type, rhs: Type, at: Expr, messages: Messages): DiagnosticItem | undefined {
  const kind = classifyConversion(lhs, rhs)
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

function signOf(t: Type): string {
  // the facts ride on the Type — no second lookup by name (consolidate-lsp-structure B1); an enum signs as its base
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
  const lhs = checkableType(target, scope, project)
  return lhs === undefined ? undefined : storeConversionError(lhs, value, target.span, scope, project, messages)
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
): DiagnosticItem | undefined {
  const rhs = literalErrorType(value, lhs) ?? checkableType(value, scope, project)
  if (rhs === undefined) return undefined
  if (isAssignable(lhs, rhs)) return undefined
  const display = rhsDisplay(value, rhs)
  if (display === undefined) return undefined
  return {
    severity: "error",
    span,
    source: SOURCE,
    code: "assignment-type-mismatch",
    message: messages.cannotConvert(display, renderType(lhs, { form: "compiler" })),
  }
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
  // an untyped integer literal the target cannot hold converts as its literal type (gap 13): `si := 128` warns USINT→SINT
  const rhs = literalCheckType(value, lhs) ?? checkableType(value, scope, project) ?? UNKNOWN
  return conversionWarning(lhs, rhs, target, messages)
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
  const srcElem = parseConversionName(x.callee.name)?.from
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

function binaryDiag(e: BinaryExpr, message: string): DiagnosticItem {
  return { severity: "error", span: e.span, source: SOURCE, code: "binary-op-type-mismatch", message }
}

function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" ? t.name : undefined
}
