/**
 * BODY COLLECTION — the raw tokens of a POU, method, action or accessor body, trivia kept (a pragma in a body means
 * something), up to the keyword that ends it; the body built from them by `format/implementation-line.ts` `codeBody`.
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans } from "../span.js"
import type { BodySpan } from "../ast/nodes/index.js"
import type { Cursor } from "./cursor.js"
import { type BodyOwner, codeBody } from "../format/implementation-line.js"
import type { Keyword } from "../lex/vocabulary.js"
import type { ReportAt } from "../format/lines.js"

/**
 * Collect tokens until the named END_* keyword, consume it, return a
 * BodySpan. The terminator is consumed so the outer parser sees the
 * next unit cleanly.
 */
export function collectBodyUntil(c: Cursor, ender: Keyword, context: string, owner: BodyOwner): BodySpan {
  return collectBodyUntilAny(c, [ender], context, owner)
}

/**
 * `collectBodyUntil` with several acceptable terminators — any one of `enders` closes the body and is consumed.
 */
export function collectBodyUntilAny(c: Cursor, enders: readonly Keyword[], context: string, owner: BodyOwner): BodySpan {
  const startSpan = c.peek().span
  const { tokens, closer } = consumeBodyUntilAny(c, { consumeEnders: enders })
  if (closer !== undefined) {
    return codeBody(reportOn(c), tokens, joinSpans(startSpan, closer.span), owner, c.dialect)
  }
  c.pushError(`unterminated ${context}: expected ${enders.join(" or ")}`, startSpan)
  return codeBody(reportOn(c), tokens, startSpan, owner, c.dialect)
}

/**
 * Walk the raw token stream — **including trivia (pragmas,
 * comments, whitespace)** — until the next *meaningful* token is
 * one of `consumeEnders` (the cursor advances past it) or
 * `peekStoppers` (the cursor leaves it for the caller). Returns
 * the collected tokens and the closer (undefined on EOF).
 *
 * Used by body collectors so the captured `BodySpan.tokens` keeps
 * pragma tokens (semantically meaningful: `{IF}`, `{warning ...}`,
 * `{attribute ...}`). Downstream consumers filter trivia via
 * `isTrivia()` when they want only meaningful tokens.
 */
function consumeBodyUntilAny(
  c: Cursor,
  opts: { consumeEnders: readonly Keyword[]; peekStoppers?: readonly Keyword[] },
): {
  tokens: Token[]
  closer: Token | undefined
  stoppedAt: Token | undefined
} {
  const tokens: Token[] = []
  const consumeSet = new Set<Keyword>(opts.consumeEnders)
  const peekSet = new Set<Keyword>(opts.peekStoppers ?? [])
  for (let t = c.rawAt(); t !== undefined; t = c.rawAt()) {
    if (t.kind === "eof") return { tokens, closer: undefined, stoppedAt: undefined }
    if (!isTrivia(t.kind) && t.kind === "keyword" && t.keyword !== undefined) {
      if (consumeSet.has(t.keyword)) {
        c.advanceRaw()
        return { tokens, closer: t, stoppedAt: undefined }
      }
      if (peekSet.has(t.keyword)) {
        return { tokens, closer: undefined, stoppedAt: t }
      }
    }
    tokens.push(t)
    c.advanceRaw()
  }
  return { tokens, closer: undefined, stoppedAt: undefined }
}

/**
 * An accessor's body, and whether its own END_GET/END_SET closed it (`closed: false` — it stopped at the next accessor or
 * END_PROPERTY, left unconsumed for the property loop, or at the end of the text).
 *
 * A BODY RUNS FROM ITS IMPLEMENTATION LINE TO ITS OWN END KEYWORD, as every element's does (openspec
 * lsp-accessor-keyword-at-line-start; the push's `StReader.ReadProperty` reads the same). GET and SET are legal names
 * (`SOFT_NAME_KEYWORDS`), so under the line they are operands — `SET^.x := P;`, `P := ADR(SET^.x);` — and only the
 * accessor's own END closes it. Reaching END_PROPERTY first leaves it open; reaching the OTHER accessor's END first does
 * too, and that END is consumed with the body: the accessor it would close was text of this one. Before the line (a
 * bare accessor, or one whose body states no line — fixture ST) the next GET/SET still closes it, which is what makes
 * `GET` bare.
 */
export function collectAccessorBody(c: Cursor, endAccessor: Keyword): { body: BodySpan; closed: boolean } {
  const startSpan = c.peek().span
  const otherEnd: Keyword = endAccessor === "END_GET" ? "END_SET" : "END_GET"
  const { tokens, closer, stoppedAt } = c.opensImplementationLine()
    ? consumeBodyUntilAny(c, { consumeEnders: [endAccessor, otherEnd], peekStoppers: ["END_PROPERTY"] })
    : consumeBodyUntilAny(c, { consumeEnders: [endAccessor], peekStoppers: ["GET", "SET", "END_PROPERTY"] })
  if (closer?.keyword === otherEnd)
    return { body: codeBody(reportOn(c), tokens, joinSpans(startSpan, closer.span), "accessor", c.dialect), closed: false }
  if (closer !== undefined) {
    return { body: codeBody(reportOn(c), tokens, joinSpans(startSpan, closer.span), "accessor", c.dialect), closed: true }
  }
  if (stoppedAt === undefined)
    c.pushError(`unterminated property accessor: expected ${endAccessor} (or next GET/SET/END_PROPERTY)`, startSpan)
  return { body: codeBody(reportOn(c), tokens, startSpan, "accessor", c.dialect), closed: false }
}

/** The cursor's error list as a file-format report: what `codeBody` reports lands with the parse errors. */
function reportOn(c: Cursor): ReportAt {
  return (message, span) => c.pushError(message, span)
}
