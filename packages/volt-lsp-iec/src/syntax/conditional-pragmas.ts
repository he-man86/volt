import type { BodySpan } from "./ast.js"
import { type BodyParse, parseStatements } from "./statements.js"
import type { Token } from "./tokens.js"

const DIRECTIVE = /^\{\s*(define|undefine|IF|ELSIF|ELSE|END_IF)\b\s*(.*?)\s*\}$/i
const CONDITION = /^defined\s*\(\s*([A-Za-z_]\w*)\s*\)$/i

const cache = new WeakMap<BodySpan, BodyParse>()

/**
 * A body parsed as CODESYS compiles it under its conditional pragmas: `{define X}`, `{undefine X}`, and
 * `{IF defined (X)}` / `{ELSIF defined (X)}` / `{ELSE}` / `{END_IF}`. The tokens of a branch not taken are dropped before
 * parsing, as the preprocessor drops them — such a branch may hold text that is no statement at all (conformance
 * `conditional_*`). A condition other than `defined (NAME)`, or an unbalanced chain, comes back as a failed parse naming
 * it: never a branch picked by guess.
 *
 * ponytail: only defines made in the body itself are seen. A compiler define set in the project's settings, or one made
 * in the declaration part, reads as undefined here — model them when a project that sets one is recorded.
 */
export function parseActive(body: BodySpan): BodyParse {
  if (!body.tokens.some((t) => t.kind === "pragma" && DIRECTIVE.test(t.text))) return parseStatements(body)
  const cached = cache.get(body)
  if (cached !== undefined) return cached
  const refused = (why: string): BodyParse => ({ statements: [], ok: false, firstError: why, errors: [] })
  const defines = new Set<string>()
  const branches: { active: boolean; taken: boolean }[] = []
  const active = () => branches.every((b) => b.active)
  const kept: Token[] = []
  let result: BodyParse | undefined
  for (const token of body.tokens) {
    const directive = token.kind === "pragma" ? DIRECTIVE.exec(token.text) : null
    if (directive === null) {
      if (active()) kept.push(token)
      continue
    }
    const word = directive[1]!.toUpperCase()
    const argument = directive[2]!
    const condition = (): boolean | undefined => {
      const named = CONDITION.exec(argument)
      return named === null ? undefined : defines.has(named[1]!.toUpperCase())
    }
    const top = branches.at(-1)
    if (word === "DEFINE" || word === "UNDEFINE") {
      const name = argument.split(/\s+/)[0]?.toUpperCase() ?? ""
      if (active() && word === "DEFINE") defines.add(name)
      else if (active()) defines.delete(name)
    } else if (word === "IF") {
      const value = condition()
      if (value === undefined) return (result = refused(`the conditional pragma ${token.text} is not modelled`))
      branches.push({ active: value, taken: value })
    } else if (top === undefined) {
      return (result = refused(`${token.text} without an {IF}`))
    } else if (word === "ELSIF") {
      const value = condition()
      if (value === undefined) return (result = refused(`the conditional pragma ${token.text} is not modelled`))
      top.active = !top.taken && value
      top.taken ||= value
    } else if (word === "ELSE") {
      top.active = !top.taken
      top.taken = true
    } else branches.pop()
  }
  result = branches.length > 0 ? refused("an {IF} without its {END_IF}") : parseStatements({ ...body, tokens: kept })
  cache.set(body, result)
  return result
}
