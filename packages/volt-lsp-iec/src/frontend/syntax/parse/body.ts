/**
 * BODY COLLECTION — the raw tokens of a POU, method, action or accessor body, trivia kept (a pragma in a body means
 * something), up to the keyword that ends it; the body built from them by `format/implementation-line.ts` `codeBody`.
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, type Span } from "../span.js"
import type { BodySpan } from "../ast/nodes.js"
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
    return codeBody(reportOn(c), tokens, joinSpans(startSpan, closer.span), owner)
  }
  c.pushError(`unterminated ${context}: expected ${enders.join(" or ")}`, startSpan)
  return codeBody(reportOn(c), tokens, startSpan, owner)
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

/** A property accessor's body: closed by its END_GET/END_SET, or — the sloppy form — by the next GET/SET/END_PROPERTY,
 *  which is left for the property parser. */
export function collectAccessorBody(c: Cursor, endAccessor: Keyword): BodySpan {
  const startSpan = c.peek().span
  const { tokens, closer, stoppedAt } = consumeBodyUntilAny(c, {
    consumeEnders: [endAccessor],
    peekStoppers: ["GET", "SET", "END_PROPERTY"],
  })
  if (closer !== undefined) {
    return codeBody(reportOn(c), tokens, joinSpans(startSpan, closer.span), "pou-or-accessor")
  }
  if (stoppedAt !== undefined) {
    // Sloppy close — stop without consuming; outer recover handles.
    return codeBody(reportOn(c), tokens, startSpan, "pou-or-accessor")
  }
  c.pushError(`unterminated property accessor: expected ${endAccessor} (or next GET/SET/END_PROPERTY)`, startSpan)
  return codeBody(reportOn(c), tokens, startSpan, "pou-or-accessor")
}

/** The cursor's error list as a file-format report: what `codeBody` reports lands with the parse errors. */
function reportOn(c: Cursor): ReportAt {
  return (message, span) => c.pushError(message, span)
}
