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
import type { Expr, Span } from "../syntax/index.js"
import type { Scope } from "../symbols/index.js"
import { inferExprType, resolveMemberChain } from "../types/index.js"
import type { DiagnosticItem } from "./diagnostic-item.js"

/** The findings that mean the expression has NO TYPE — the ST codes and their network-text counterparts. */
const RESOLUTION_FAILURE: ReadonlySet<string> = new Set([
  "unresolved-identifier", "unknown-member", "deref-non-pointer", "indexing-non-array", "this-not-allowed",
  "super-not-allowed", "call-recursion", "network-undeclared-identifier", "network-unknown-member",
])

/**
 * The names the compiler refuses OUTRIGHT, so nothing built on one has a type either however well the LSP resolves
 * it: THIS/SUPER out of context, a VAR_EXTERNAL the project has no global for, a function calling itself.
 */
const REFUSED_OUTRIGHT: ReadonlySet<string> = new Set([
  "this-not-allowed", "super-not-allowed", "unresolved-identifier", "call-recursion", "network-undeclared-identifier",
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
  if (!within(seen.explained, e.span)) return false
  if (unknown) return true
  // For a CALL only the CALLEE counts: the result is the callee's declared return type, which the compiler knows
  // however badly an ARGUMENT resolved (`f(undefinedName)` converts fine) — but a callee it refuses outright leaves
  // the call with no type (conformance `cc2_call_recursion`).
  return within(seen.refused, e.kind === "call" ? e.callee.span : e.span)
}
