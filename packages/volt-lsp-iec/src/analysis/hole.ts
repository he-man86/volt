/**
 * hole — "the compiler could not type this expression", which is the premise of every message in
 * `checks/types/unknown-source` and of the one the network-text sink check reports. One definition, because the
 * hard part is not the message but knowing when the LSP's "unknown" is the COMPILER'S unknown.
 *
 * It is unknown for two unrelated reasons: a name that does not RESOLVE, which is the compiler's reason too, and a
 * type the inference merely does not MEET yet (`si AND un`, `MAX(un, sn)`, an untyped integer literal), which the
 * compiler types without trouble. Only the first counts — gating on "any diagnostic was reported inside" produced 30
 * false positives on the arithmetic fixtures alone.
 */
import { addressShape, typedLiteralForm, type Expr, type Span } from "../frontend/syntax/index.js"
import type { Scope } from "../frontend/symbols/index.js"
import { inferExprType, isConversionName, resolveMemberChain, resolveNamedType } from "../frontend/types/index.js"
import type { DiagnosticItem } from "./diagnostic-item.js"

/** The findings that mean the expression has NO TYPE — the ST codes and their network-text counterparts. */
const RESOLUTION_FAILURE: ReadonlySet<string> = new Set([
  "unresolved-identifier", "unknown-member", "deref-non-pointer", "indexing-non-array", "this-not-allowed",
  "super-not-allowed", "self-not-structured", "call-recursion", "network-undeclared-identifier", "network-unknown-member",
  // a call of what is no call target has no type (`types/infer` `callReturnType`), and the C0035 names why: `out :=
  // .gCall(1)` is "Cannot convert type 'Unknown type: '.gCall(1)'' to type 'INT'" beside it
  // (`expr_global_namespace_call_non_callable`, both vendors 2026-10-02)
  "invalid-call-target",
])

/**
 * The names the compiler refuses OUTRIGHT, so nothing built on one has a type either however well the LSP resolves
 * it: THIS/SUPER out of context or read without their `^`, a VAR_EXTERNAL the project has no global for, a function
 * calling itself.
 */
const REFUSED_OUTRIGHT: ReadonlySet<string> = new Set([
  "this-not-allowed", "super-not-allowed", "self-not-structured", "unresolved-identifier", "call-recursion", "network-undeclared-identifier",
])

/** A view of what the earlier checks found, which is the only evidence a hole is reported on. */
export interface Reported {
  explained: readonly Span[]
  refused: readonly Span[]
}

export function reported(out: readonly DiagnosticItem[]): Reported {
  return {
    explained: out.filter((d) => RESOLUTION_FAILURE.has(d.code)).map((d) => d.span),
    refused: out.filter((d) => REFUSED_OUTRIGHT.has(d.code)).map((d) => d.span),
  }
}

const within = (spans: readonly Span[], s: Span): boolean => spans.some((x) => x.start >= s.start && x.end <= s.end)

/** A call whose callee is a METHOD or FUNCTION declared with no return type — it resolves, and yields nothing. */
function valuelessCall(e: Expr, scope: Scope, project: Scope): boolean {
  if (e.kind !== "call") return false
  const sym = resolveMemberChain(e.callee, scope, project)
  return (sym?.kind === "method" || sym?.kind === "function") && sym.typeExpr === undefined
}

/** A `<word>#<operand>` literal whose word is an ENUM type — IEC's typed enum literal, which CODESYS does not support. */
export function enumTypedLiteral(text: string, project: Scope): boolean {
  const form = typedLiteralForm(text)
  return form.kind === "component" && resolveNamedType(form.prefix, project).kind === "enum"
}

/**
 * A LITERAL THAT IS A HOLE ON ITS OWN EVIDENCE: a malformed ADDRESS — "Cannot convert type 'Unknown type: '%M?0.1''
 * to type 'BOOL'" — and an ENUM type's `Type#Value`, which CODESYS does not support and types as nothing — "Unknown
 * type: 'E_Mode#Running'" (`lit_address_unsized_in_body`, `lit_enum_typed_*`, 2026-10-01). Nothing else names the
 * failure. Any other `<word>#<operand>` is reported as no component of its word (`checks/types/typed-literal`) and
 * carries no hole: the vendor stops there.
 */
export function literalHole(e: Expr, project: Scope): boolean {
  if (e.kind !== "literal") return false
  if (e.literalKind === "address") return addressShape(e.text).kind === "malformed"
  return e.literalKind === "typed" && enumTypedLiteral(e.text, project)
}

/** The built-in calls whose type is their one operand's (ABS) or a pointer to it (ADR). */
const PASS_THROUGH_CALLS: ReadonlySet<string> = new Set(["ABS", "ADR"])

/**
 * THE OPERAND OF AN OPERATION WHOSE TYPE IS ITS OPERAND'S — `NOT x`, `-x`, `ABS(x)`, and `ADR(x)` (a pointer to it) — or
 * `undefined`. Such an operation has no type when its operand has none: `out := ABS(%M0.1)` is "Unknown type: '%M?0.1'"
 * on the operand AND "Cannot convert type 'Unknown type: 'ABS(%M?0.1)'' to type 'INT'" on the whole
 * (`lit_address_unsized_as_argument`, `_under_not`, `_under_adr`, `lit_enum_typed_as_argument`, `_under_minus`,
 * CODESYS 2026-10-01). A bare conversion is NOT one: its type is its name's (`checks/types/unknown-source`).
 */
export function passThroughOperand(e: Expr): Expr | undefined {
  if (e.kind === "unary") return e.op === "NOT" || e.op === "-" ? e.operand : undefined
  if (e.kind !== "call" || e.callee.kind !== "ident_expr" || !PASS_THROUGH_CALLS.has(e.callee.name.toUpperCase())) return undefined
  const [only] = e.args
  return e.args.length === 1 && only.param === undefined ? only.value : undefined
}

/**
 * The one positional argument of a BARE conversion call (`TO_INT(x)` — no source type in its name), or `undefined`. It
 * converts its argument to ANY and keeps its own type: `TO_INT(%M0.1)` is "Cannot convert type 'Unknown type: '%M?0.1''
 * to type 'ANY'" and nothing more (`lit_address_unsized_as_conversion_argument`, CODESYS 2026-10-01).
 */
export function bareConversionArgument(e: Expr): Expr | undefined {
  if (e.kind !== "call" || e.callee.kind !== "ident_expr" || !/^TO_/i.test(e.callee.name)) return undefined
  if (!isConversionName(e.callee.name)) return undefined
  const [only] = e.args
  return e.args.length === 1 && only.param === undefined ? only.value : undefined
}

/**
 * An operation that passes a LITERAL hole's type through, however deep (`NOT ABS(%M0.1)`). Only a literal hole: a name
 * that did not resolve is a hole by the `explained` gate below, and what ADR or ABS of one says is not recorded.
 */
function passesLiteralHole(e: Expr, project: Scope): boolean {
  const operand = passThroughOperand(e)
  return operand !== undefined && literalHoleWithin(operand, project)
}

/** A literal hole, under parentheses or operations that pass its type through. */
export const literalHoleWithin = (e: Expr, project: Scope): boolean =>
  e.kind === "literal" ? literalHole(e, project) : e.kind === "paren" ? literalHoleWithin(e.inner, project) : passesLiteralHole(e, project)

/** True when `e` is a hole the COMPILER has too — see the header for why both halves are needed. */
export function isHole(e: Expr, scope: Scope, project: Scope, seen: Reported): boolean {
  // A CALL TO A ROUTINE WITH NO RETURN TYPE IS A HOLE ON ITS OWN EVIDENCE. It needs no earlier check to explain it:
  // the routine resolved perfectly and simply HAS no value, which is the whole of the failure. CODESYS says
  // "Cannot convert type 'Unknown type: 'm.NoRet()'' to type 'INT'" — the same shape this file already produces
  // for a name that resolved to nothing (`refuse_method_no_result`, measured).
  //
  // Before the `explained` gate, because nothing else will ever explain it, and it cannot false-positive on a
  // valueless call used as a STATEMENT: `unknown-source` only looks at an assignment's source and an operator's
  // operands, which is exactly where a routine with no value must not appear.
  const unknown = inferExprType(e, scope, project).kind === "unknown"
  // ...and the type is consulted FIRST, because a valueless call has no type by definition. Resolving the callee is
  // the expensive half and this way it runs only for an expression that is already untyped, which is rare. Put the
  // other way round it cost the corpus gate its 120s budget.
  if (unknown && valuelessCall(e, scope, project)) return true
  // TWO LITERALS ARE HOLES ON THEIR OWN EVIDENCE TOO, and for the same reason: nothing else names the failure
  // (`literalHole`) — and so is an operation that passes such a hole's type through (`passThroughOperand`).
  if (e.kind === "literal") return literalHole(e, project)
  if (passesLiteralHole(e, project)) return true
  if (!within(seen.explained, e.span)) return false
  if (unknown) return true
  // For a CALL only the CALLEE counts: the result is the callee's declared return type, which the compiler knows
  // however badly an ARGUMENT resolved (`f(undefinedName)` converts fine) — but a callee it refuses outright leaves
  // the call with no type (conformance `cc2_call_recursion`).
  return within(seen.refused, e.kind === "call" ? e.callee.span : e.span)
}
