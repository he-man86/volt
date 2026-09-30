/**
 * A BODY, PARSED ONCE — the one cache of statement trees, keyed on the `BodySpan` (a body is immutable and parsed
 * identically every time; a document re-parse yields fresh bodies, so an edit is never stale).
 *
 * Two trees exist for a body with conditional pragmas, and both come from here:
 *   `parseStatements`  every branch read, as analysis and services read a body today;
 *   `parseActive`      only the branches CODESYS compiles (`pragmas/conditional.ts`), as the transpiler reads it.
 * Which tree every consumer reads is conformance 2.7.1's to decide.
 */
import type { BodySpan } from "../ast/nodes.js"
import { hasConditionalPragmas, scanConditionals } from "../pragmas/conditional.js"
import { type BodyParse, parseStatementTokens } from "./statements.js"

const cache = new WeakMap<BodySpan, { every?: BodyParse; active?: BodyParse }>()

function entry(body: BodySpan): { every?: BodyParse; active?: BodyParse } {
  let e = cache.get(body)
  if (e === undefined) cache.set(body, (e = {}))
  return e
}

/** A body's statements, every conditional branch read. */
export function parseStatements(body: BodySpan): BodyParse {
  const e = entry(body)
  return (e.every ??= parseStatementTokens(body.tokens))
}

/**
 * A body's statements as CODESYS compiles it under its conditional pragmas: the tokens of a branch not taken are
 * dropped before parsing, as the preprocessor drops them. A body with no conditional pragma is `parseStatements`'s.
 * A pragma the scanner does not model comes back as a failed parse naming it — never a branch picked by guess.
 */
export function parseActive(body: BodySpan): BodyParse {
  if (!hasConditionalPragmas(body.tokens)) return parseStatements(body)
  const e = entry(body)
  if (e.active !== undefined) return e.active
  const scanned = scanConditionals(body.tokens)
  e.active =
    "refused" in scanned
      ? { statements: [], ok: false, firstError: scanned.refused, errors: [] }
      : parseStatementTokens(scanned.kept)
  return e.active
}
