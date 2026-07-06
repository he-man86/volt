/**
 * Body helpers (Layer A) — the ONE home for "which token-bodies does a unit have" and "is this body
 * graphical (VG) rather than ST". Both were previously copy-pasted across the services + analysis
 * layers; consolidated here so every consumer imports the same definition.
 *
 * Graphical detection is a heuristic (first meaningful token is `NETWORK`) until the real VG surface
 * lands in Layer F; keeping it in one place means that upgrade is a single edit.
 */
import type { BodySpan, Identifier, TopLevel, TypeExpr, VarSection } from "./ast.js"
import { isTrivia } from "./tokens.js"

/** Every token-body a unit carries (POU body + property accessors). */
export function unitBodies(unit: TopLevel): BodySpan[] {
  switch (unit.kind) {
    case "function_block":
    case "program":
    case "function":
    case "method":
    case "action":
      return [unit.body]
    case "property":
      return [...(unit.getter ? [unit.getter.body] : []), ...(unit.setter ? [unit.setter.body] : [])]
    default:
      return []
  }
}

/** True when a body is graphical (FBD/LD) — its first meaningful token is `NETWORK` — not ST. */
export function isGraphicalBody(body: BodySpan): boolean {
  const first = body.tokens.find((t) => !isTrivia(t.kind))
  return first !== undefined && first.text.toUpperCase() === "NETWORK"
}

/** The VAR_INPUT parameters (name + declared type) of a POU/method's var sections, in order. */
export function varInputParams(sections: readonly VarSection[]): { name: Identifier; type: TypeExpr }[] {
  const out: { name: Identifier; type: TypeExpr }[] = []
  for (const section of sections) {
    if (section.sectionKind !== "VAR_INPUT") continue
    for (const decl of section.decls) for (const id of decl.names) out.push({ name: id, type: decl.type })
  }
  return out
}
