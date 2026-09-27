/**
 * Body helpers (Layer A) — the ONE home for "which token-bodies does a unit have" and "is this body
 * graphical (network text) rather than ST". Both were previously copy-pasted across the services + analysis
 * layers; consolidated here so every consumer imports the same definition.
 *
 * Graphical detection reads the body's own implementation marker — `(* @volt-implementation FBD|LD *)`, network text
 * v2's one statement of a body's language (openspec `network-text-literal-nwl` 3.3) — and recognises v1 text by v1's
 * HEADER, `NETWORK <n>` on the first non-blank line after the bare marker (the bridge's `NetworkText.IsV1`): read as ST
 * a v1 body would bury the file in parse errors, where the network parser refuses it once, by name, asking for a
 * re-pull — as the push does. The header's shape, not its first word: an ST body may well begin with a variable called
 * `network`, or assign a function `Network` its result. Both are decided by whole LINES (`bodyForm`), the one rule the
 * network parser reads by too.
 */
import type { BodySpan, Identifier, TopLevel, TypeExpr, VarSection } from "./ast.js"

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

/** A graphical body's implementation marker LINE, naming its language: `(* @volt-implementation LD *)` — the bridge's
 *  `ImplementationMarker.Line`, blanks around it layout and nothing else on it. */
export const GRAPHICAL_MARKER_LINE = /^\s*\(\*\s*@volt-implementation\s+(FBD|LD)\s*\*\)\s*$/
/** The bare marker line an ST body (and a v1 body) carries. */
export const BARE_MARKER_LINE = /^\s*\(\*\s*@volt-implementation\s*\*\)\s*$/
/** v1's per-network header line, `NETWORK 0 LD` — the bridge's `NetworkText.V1Header`, case and all. */
export const V1_HEADER_LINE = /^\s*NETWORK\s+\d+(\s|$)/

/** One line of a body's text: its text without the newline, and its offsets in that text. */
export interface BodyLine {
  text: string
  start: number
  end: number
}

/** The first non-blank line of `text` at or after `from`; an empty line at the end when there is none. */
export function firstLineFrom(text: string, from: number): BodyLine {
  let start = from
  while (start < text.length && /\s/.test(text[start]!)) start++
  const nl = text.indexOf("\n", start)
  const end = nl < 0 ? text.length : nl
  return { text: text.slice(start, end).replace(/\r$/, ""), start, end }
}

/**
 * What a body's text IS, decided by LINES exactly as the push decides it — the ONE classifier `isGraphicalBody` and the
 * network parser share:
 * - `graphical`: its first non-blank line is a graphical marker (`NetworkText.LanguageOf`);
 * - `v1`: its first non-blank line — or, behind the bare marker, the next one — is a v1 header (`NetworkText.IsV1`),
 *   which the push refuses by name, asking for a re-pull;
 * - `st`: anything else, which the push writes into the IDE as Structured Text.
 *
 * Decided by TOKEN once (the first block comment, the first non-trivia token), a marker sharing its line with code and
 * a v1 header behind a comment or split over two lines were called graphical here and ST by the push: their ST
 * diagnostics were suppressed for a network finding no push gives.
 */
export type BodyForm =
  | { kind: "graphical"; language: "FBD" | "LD"; marker: BodyLine }
  | { kind: "v1"; header: BodyLine }
  | { kind: "st"; first: BodyLine }

export function bodyForm(text: string): BodyForm {
  const first = firstLineFrom(text, 0)
  const marked = GRAPHICAL_MARKER_LINE.exec(first.text)
  if (marked !== null) return { kind: "graphical", language: marked[1] as "FBD" | "LD", marker: first }
  if (V1_HEADER_LINE.test(first.text)) return { kind: "v1", header: first }
  if (BARE_MARKER_LINE.test(first.text)) {
    const next = firstLineFrom(text, first.end)
    if (V1_HEADER_LINE.test(next.text)) return { kind: "v1", header: next }
  }
  return { kind: "st", first }
}

/** A body's text: its tokens' text, since the ST lexer emits every character, whitespace included. */
export function bodyText(body: BodySpan): string {
  return body.tokens.map((t) => t.text).join("")
}

/** The body's leading text, just far enough for `bodyForm` — its first two non-blank lines — so the classifier every
 *  service asks of every body does not join a whole body's tokens to read two lines of it. */
function bodyHead(body: BodySpan): string {
  let text = ""
  let lines = 0
  let inLine = false
  for (const t of body.tokens) {
    text += t.text
    for (const ch of t.text) {
      if (ch === "\n") {
        if (inLine && ++lines === 2) return text
        inLine = false
      } else if (!/\s/.test(ch)) inLine = true
    }
  }
  return text
}

/** The language a body's implementation marker names (`FBD` / `LD`), or undefined for an ST or v1 body. */
export function graphicalMarkerLanguage(body: BodySpan): "FBD" | "LD" | undefined {
  const form = bodyForm(bodyHead(body))
  return form.kind === "graphical" ? form.language : undefined
}

/** True when a body is graphical (FBD/LD), not ST: it carries a graphical implementation marker (v2), or it is v1 text,
 *  which the network parser refuses naming a re-pull. A v2 body with no network at all is graphical by its marker
 *  alone. */
export function isGraphicalBody(body: BodySpan): boolean {
  return bodyForm(bodyHead(body)).kind !== "st"
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
