/**
 * `ACTION Name <body> END_ACTION`
 *
 * Actions are the simplest unit — no return type, no modifiers, no
 * VAR sections. The body is captured opaquely up to END_ACTION.
 *
 * AN ACTION HAS NO DECLARATION THE IDE STORES (openspec bridge-refusal-review D10, review 4b): neither vendor's write
 * keeps one, and a pull composes `ACTION <name>`. So the push refuses, by name, anything on the ACTION line besides the
 * keyword and the name (a modifier, a type, a comment, a `;`) and any comment or pragma above the line or under it
 * before the body — each would be dropped without a word. The parser reports the same text with the push's words, and
 * still reads the action by the name the push reads (the last word on the line), so a call to it binds.
 */
import type { Action } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import type { Token } from "../../lex/tokens.js"
import { isTrivia } from "../../lex/tokens.js"
import { collectBodyUntil } from "../body.js"
import { joinSpans } from "../../span.js"
import { identFromToken } from "../names.js"

const NO_DECLARATION = "an action has no declaration the IDE stores"

export function parseAction(c: Cursor): Action | undefined {
  const above = c.triviaAhead().find(isStoredTrivia)
  const start = c.expectKeyword("ACTION")
  if (start === undefined) return undefined
  const line = c.consumeRestOfLine()
  const words = line.filter((t) => !isTrivia(t.kind))
  const nameTok = words.length === 0 ? c.expectIdent() : [...words].reverse().find((t) => t.kind === "identifier")
  if (nameTok === undefined) {
    if (words.length > 0) c.pushError(`Identifier expected instead of '${words[0]!.text}'`, words[0]!.span)
    return undefined
  }
  const name = identFromToken(nameTok)
  const written = `ACTION ${name.text}`
  if (words.length > 1 || line.some(isStoredTrivia)) {
    const text = [start, ...line].map((t) => t.text).join("").trim()
    c.pushError(
      `Cannot parse ACTION signature: ${NO_DECLARATION} — its line is '${written}', so anything else on it would be dropped — ${text}`,
      joinSpans(start.span, line[line.length - 1]!.span),
    )
  }
  const reportDeclaration = (t: Token): void =>
    c.pushError(
      `'${t.text.split("\n")[0]!.trim()}' would be part of action '${name.text}'s declaration, and ${NO_DECLARATION} — its ` +
        `line is '${written}', so this would be dropped. Move it into the action's body or the owner's declaration.`,
      t.span,
    )
  if (above !== undefined) reportDeclaration(above)
  const under = c.triviaAhead().find(isStoredTrivia)
  if (under !== undefined && c.opensImplementationLine()) reportDeclaration(under)
  const body = collectBodyUntil(c, "END_ACTION", "action", "member")
  return {
    kind: "action",
    name,
    body,
    span: joinSpans(start.span, body.span),
  }
}

/** A comment or a pragma — trivia the push would read into a declaration (blank space is layout). */
const isStoredTrivia = (t: Token): boolean => isTrivia(t.kind) && t.kind !== "whitespace"
