/**
 * WHAT AN IDENTIFIER IS — equality of two ST names, and the two names that denote the enclosing instance. One home
 * (openspec frontend-conformance design.md §2): a consumer that compares names or tests for THIS/SUPER itself is a
 * second copy.
 */
import type { Expr } from "./ast/nodes.js"

/**
 * Two ST names for the same thing: names are case-insensitive. (A backtick-quoted name is compared as written — the
 * interpreter's own copy strips the quotes; which is right is the conformance work's to decide, transpile-restructure
 * owns that copy.)
 */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Which self reference a name is — `THIS` or `SUPER`, in any case (ST names are case-insensitive) — or neither. */
export function selfRefKind(name: string): "THIS" | "SUPER" | undefined {
  const upper = name.toUpperCase()
  return upper === "THIS" || upper === "SUPER" ? upper : undefined
}

/**
 * True when `e` names the enclosing instance — `THIS` or `SUPER`, in any case, optionally parenthesised and
 * dereferenced (`THIS^`). The one home of that test: two OOP checks each kept a private copy.
 */
export function isSelfRef(e: Expr): boolean {
  let x = e
  if (x.kind === "paren") x = x.inner
  if (x.kind === "deref") x = x.base
  return x.kind === "ident_expr" && selfRefKind(x.name) !== undefined
}
