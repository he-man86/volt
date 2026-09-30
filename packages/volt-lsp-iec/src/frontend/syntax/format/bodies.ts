/**
 * Body helpers (Layer A) — the ONE home for "which token-bodies does a unit have" and "which parser reads this body".
 * Both were previously copy-pasted across the services + analysis layers; consolidated here so every consumer imports
 * the same definition.
 *
 * Which parser reads a body is what its `IMPLEMENTATION <LANG>` line STATES (`syntax/implementation-keyword`) and
 * nothing else — never the text's first line, a header's shape or a comment. A body that contradicts its line is a
 * diagnostic of the parser the line names, never re-read as the other language.
 */
import type { BodySpan, Identifier, TopLevel, TypeExpr, VarSection } from "./ast.js"
import { bodyReader } from "./implementation-keyword.js"

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

/** The language a graphical body's `IMPLEMENTATION` line states (`FBD` / `LD`), or undefined for any other body —
 *  ST, hidden (UNSUPPORTED), one whose line states no language, one with no line. */
export function graphicalMarkerLanguage(body: BodySpan): "FBD" | "LD" | undefined {
  const s = body.implementation?.statement
  return s?.kind === "read" && s.language !== "ST" ? s.language : undefined
}

/** True when the network-text parser reads this body: its line states `LD` or `FBD`. A body with no network at all
 *  is graphical by its line alone. */
export function isGraphicalBody(body: BodySpan): boolean {
  return bodyReader(body) === "network"
}

/** True when the ST parser reads this body: its line states `ST`, or it has no line (IDE text — see `splitImplementation`
 *  for why, and for how a workspace file with no line is reported instead). A
 *  hidden body, and one whose line states no language a body can have, is read by NEITHER parser — so every ST
 *  consumer asks this, not `!isGraphicalBody`, and a chart under `IMPLEMENTATION CFC UNSUPPORTED` is never analysed as ST. */
export function isStBody(body: BodySpan): boolean {
  return bodyReader(body) === "st"
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
