/**
 * Body helpers (Layer A) — the ONE home for "which token-bodies does a unit have" and "which parser reads this body".
 * Both were previously copy-pasted across the services + analysis layers; consolidated here so every consumer imports
 * the same definition.
 *
 * Which parser reads a body is what its `%LANGUAGE <LANG>` line STATES (`syntax/format/language-line`) and
 * nothing else — never the text's first line, a header's shape or a comment. A body that contradicts its line is a
 * diagnostic of the parser the line names, never re-read as the other language.
 */
import type { BodySpan, TopLevel } from "../ast/nodes/index.js"
import { allUnits } from "../ast/walk.js"
import { bodyReader } from "./language-line.js"
import { isPlainStNetworkText } from "./network-form.js"

/** Every token-body a unit carries (POU body + property accessors) — a NAMESPACE block's are its units' (rule Y17, through
 *  `allUnits`: a walk over a file's units reached none of the bodies inside one). */
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
    case "namespace":
      return allUnits(unit.units).flatMap(unitBodies)
    default:
      return []
  }
}

/** The language a graphical body's `%LANGUAGE` line states (`FBD` / `LD`), or undefined for any other body —
 *  ST, hidden (UNSUPPORTED), one whose line states no language, one with no line. */
export function graphicalMarkerLanguage(body: BodySpan): "FBD" | "LD" | undefined {
  const s = body.languageLine?.statement
  return s?.kind === "read" && s.language !== "ST" ? s.language : undefined
}

/** True when the network-text parser reads this body: its line states `LD` or `FBD`. A body with no network at all
 *  is graphical by its line alone. */
export function isGraphicalBody(body: BodySpan): boolean {
  return bodyReader(body) === "network"
}

/** True when an LD/FBD body is PLAIN-ST network text (`network/plain-st.ts`): read by the ST parser, as ST with `%` lines. */
export function isPlainStNetworkBody(body: BodySpan): boolean {
  return graphicalMarkerLanguage(body) !== undefined && bodyReader(body) === "st" && isPlainStNetworkText(body.tokens)
}

/** True when the ST parser reads this body: its line states `ST`, or it has no line (IDE text — see `splitImplementation`
 *  for why, and for how a workspace file with no line is reported instead). A
 *  hidden body, and one whose line states no language a body can have, is read by NEITHER parser — so every ST
 *  consumer asks this, not `!isGraphicalBody`, and a chart under `%LANGUAGE CFC UNSUPPORTED` is never analysed as ST. */
export function isStBody(body: BodySpan): boolean {
  return bodyReader(body) === "st"
}

/**
 * Every graphical (network text) body in a unit list, with its unit — the walk the outline, semantic tokens, the network
 * diagnostics and the network services each wrote out by hand (consolidate-lsp-structure C2). The ST counterpart, with a
 * resolved scope and parsed statements, is `symbols/scoped-bodies`.
 */
export function* graphicalBodies(units: readonly TopLevel[]): Generator<{ unit: TopLevel; body: BodySpan }> {
  for (const unit of allUnits(units)) for (const body of unitBodies(unit)) if (isGraphicalBody(body)) yield { unit, body }
}
