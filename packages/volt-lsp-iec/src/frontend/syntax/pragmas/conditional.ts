/**
 * CONDITIONAL PRAGMAS — `{define X}`, `{undefine X}`, and `{IF defined (X)}` / `{ELSIF defined (X)}` / `{ELSE}` /
 * `{END_IF}`, as CODESYS's preprocessor applies them to a body's tokens. This is the scanner; the parse of what is left
 * is `parse/body-parse.ts` `parseActive`.
 */
import type { Token } from "../lex/tokens.js"

const DIRECTIVE = /^\{\s*(define|undefine|IF|ELSIF|ELSE|END_IF)\b\s*(.*?)\s*\}$/i
const CONDITION = /^defined\s*\(\s*([A-Za-z_]\w*)\s*\)$/i

/** Does this token stream hold a conditional pragma at all? */
export function hasConditionalPragmas(tokens: readonly Token[]): boolean {
  return tokens.some((t) => t.kind === "pragma" && DIRECTIVE.test(t.text))
}

/**
 * A body's tokens as CODESYS compiles them under its conditional pragmas: `{define X}`, `{undefine X}`, and
 * `{IF defined (X)}` / `{ELSIF defined (X)}` / `{ELSE}` / `{END_IF}`. The tokens of a branch not taken are dropped before
 * parsing, as the preprocessor drops them — such a branch may hold text that is no statement at all (conformance
 * `conditional_*`). A condition other than `defined (NAME)`, or an unbalanced chain, comes back as a failed parse naming
 * it: never a branch picked by guess.
 *
 * ponytail: only defines made in the body itself are seen. A compiler define set in the project's settings, or one made
 * in the declaration part, reads as undefined here — model them when a project that sets one is recorded.
 */
export function scanConditionals(tokens: readonly Token[]): { kept: Token[] } | { refused: string } {
  const branches: { active: boolean; taken: boolean }[] = []
  const active = () => branches.every((b) => b.active)
  const kept: Token[] = []
  const defines = new Set<string>()
  for (const token of tokens) {
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
      if (value === undefined) return { refused: `the conditional pragma ${token.text} is not modelled` }
      branches.push({ active: value, taken: value })
    } else if (top === undefined) {
      return { refused: `${token.text} without an {IF}` }
    } else if (word === "ELSIF") {
      const value = condition()
      if (value === undefined) return { refused: `the conditional pragma ${token.text} is not modelled` }
      top.active = !top.taken && value
      top.taken ||= value
    } else if (word === "ELSE") {
      top.active = !top.taken
      top.taken = true
    } else branches.pop()
  }
  return branches.length > 0 ? { refused: "an {IF} without its {END_IF}" } : { kept }
}
