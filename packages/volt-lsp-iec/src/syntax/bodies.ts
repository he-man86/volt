/**
 * Body helpers (Layer A) — the ONE home for "which token-bodies does a unit have" and "is this body
 * graphical (network text) rather than ST". Both were previously copy-pasted across the services + analysis
 * layers; consolidated here so every consumer imports the same definition.
 *
 * Graphical detection reads the body's own implementation marker — `(* @volt-implementation FBD|LD *)`, network text
 * v2's one statement of a body's language (openspec `network-text-literal-nwl` 3.3) — and keeps the older test, "the
 * first meaningful token is `NETWORK`", for the v1 bodies this server still analyses: its network parser reads v1
 * until task 5.1 and the corpus is v1 until 6.1 re-pulls it. Both answers live here, so dropping the second is one edit.
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

/** A graphical body's implementation marker, naming its language: `(* @volt-implementation LD *)`. */
const GRAPHICAL_MARKER = /^\(\*\s*@volt-implementation\s+(FBD|LD)\s*\*\)$/

/** The language a body's implementation marker names (`FBD` / `LD`), or undefined for an ST body (bare marker, or
 *  none). The marker is the body's first token: nothing but whitespace stands before it. */
export function graphicalMarkerLanguage(body: BodySpan): "FBD" | "LD" | undefined {
  const first = body.tokens.find((t) => t.kind !== "whitespace")
  const m = first?.kind === "block_comment" ? GRAPHICAL_MARKER.exec(first.text) : null
  return m ? (m[1] as "FBD" | "LD") : undefined
}

/** True when a body is graphical (FBD/LD), not ST: it carries a graphical implementation marker (v2), or — the v1
 *  form, until the parser and corpus move to v2 (tasks 5.1, 6.1) — its first meaningful token is `NETWORK`. A v2 body
 *  with no network at all is graphical by its marker alone. */
export function isGraphicalBody(body: BodySpan): boolean {
  if (graphicalMarkerLanguage(body) !== undefined) return true
  const first = body.tokens.find((t) => !isTrivia(t.kind))
  return first !== undefined && first.text.toUpperCase() === "NETWORK"
}

/**
 * Every graphical (network text) body in a unit list, with its unit — the walk the outline, semantic tokens, the network
 * diagnostics and the network services each wrote out by hand (consolidate-lsp-structure C2). The ST counterpart, with a
 * resolved scope and parsed statements, is `symbols/bodies`.
 */
export function* graphicalBodies(units: readonly TopLevel[]): Generator<{ unit: TopLevel; body: BodySpan }> {
  for (const unit of units) for (const body of unitBodies(unit)) if (isGraphicalBody(body)) yield { unit, body }
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
