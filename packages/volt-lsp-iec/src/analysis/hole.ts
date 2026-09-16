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
import { inferExprType } from "../types/index.js"
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

/** True when `e` is a hole the COMPILER has too — see the header for why both halves are needed. */
export function isHole(e: Expr, scope: Scope, project: Scope, seen: Reported): boolean {
  if (!within(seen.explained, e.span)) return false
  if (inferExprType(e, scope, project).kind === "unknown") return true
  // For a CALL only the CALLEE counts: the result is the callee's declared return type, which the compiler knows
  // however badly an ARGUMENT resolved (`f(undefinedName)` converts fine) — but a callee it refuses outright leaves
  // the call with no type (conformance `cc2_call_recursion`).
  return within(seen.refused, e.kind === "call" ? e.callee.span : e.span)
}
