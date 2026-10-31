/**
 * A BODY, PARSED ONCE — the one statement tree of a body, with its conditional pragmas applied (`parse/statements`,
 * `pragmas/conditional`), cached on the `BodySpan` (a body is immutable and parsed identically every time; a document
 * re-parse yields fresh bodies, so an edit is never stale).
 *
 * A body whose tree depends on no condition (no `{IF}`/`{define}` where a statement may start) is parsed once for every
 * caller. One that does is parsed once per `ConditionWorld` OBJECT: a consumer that holds a project hands the same world
 * for the same scope until the project changes (`symbols/condition-world.ts`), so the cache sees a new world exactly
 * when an answer may have moved.
 *
 * `sourceStatements` is the body AS WRITTEN — every branch of every chain in the tree — for the services that edit and
 * navigate the text (rename, references, folding, selection, hover). A branch the compiled tree leaves out (not taken, or
 * undecided) is still text a rename must reach: it comes back when its condition flips.
 */
import type { BodySpan } from "../ast/nodes/index.js"
import { isConditionalDirective } from "../pragmas/conditional.js"
import type { ConditionWorld } from "../pragmas/condition-eval.js"
import { type BodyParse, parseSourceStatementTokens, parseStatementTokens } from "./statements.js"
import { networkStatements, plainStText, statementTokensOf } from "../network/plain-st.js"
import { isPlainStNetworkBody } from "../format/bodies.js"

/** The world of a caller that holds none: every condition beyond the body's own defines is refused by name. */
const NO_WORLD: ConditionWorld = Object.freeze({})

const cache = new WeakMap<BodySpan, { plain?: BodyParse; source?: BodyParse; byWorld?: WeakMap<ConditionWorld, BodyParse> }>()

const entryOf = (body: BodySpan) => {
  let e = cache.get(body)
  if (e === undefined) cache.set(body, (e = {}))
  return e
}

const isConditional = (body: BodySpan): boolean => body.tokens.some((t) => t.kind === "pragma" && isConditionalDirective(t.text))

/** A body's statements as the vendor compiles them: a branch not taken is not in the tree, a directive inside a statement
 *  is trivia. A condition `world` cannot answer leaves its chain undecided and the body `refused` (`BodyParse.refused`),
 *  never guessed; what lies outside that chain keeps its errors and messages. */
export function bodyStatements(body: BodySpan, world: ConditionWorld = NO_WORLD): BodyParse {
  const e = entryOf(body)
  if (!isConditional(body)) return (e.plain ??= parsePlain(body))
  const byWorld = (e.byWorld ??= new WeakMap())
  let parsed = byWorld.get(world)
  if (parsed === undefined) byWorld.set(world, (parsed = parseStatementTokens(statementTokensOf(body), body.dialect, world)))
  return parsed
}

/** A body with no conditional directive, parsed — a plain-ST network body's jump and return statements read as such
 *  (`networkStatements`). */
function parsePlain(body: BodySpan, asWritten = false): BodyParse {
  const parsed = parseStatementTokens(statementTokensOf(body, asWritten), body.dialect)
  return isPlainStNetworkBody(body) ? { ...parsed, statements: networkStatements(parsed.statements, plainStText(body).marks) } : parsed
}

/** A body's statements AS WRITTEN: every branch of every conditional chain, in source order (every pragma trivia). For
 *  the source services; a body with no conditional directive has one tree, and this is it (`bodyStatements`). */
export function sourceStatements(body: BodySpan): BodyParse {
  const e = entryOf(body)
  // a plain-ST network body as written holds its disabled networks' code, which it does not compile
  if (statementTokensOf(body, true) !== statementTokensOf(body)) return (e.source ??= parsePlain(body, true))
  if (!isConditional(body)) return (e.plain ??= parsePlain(body))
  return (e.source ??= parseSourceStatementTokens(statementTokensOf(body, true), body.dialect))
}
