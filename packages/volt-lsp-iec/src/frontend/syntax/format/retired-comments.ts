/**
 * THE RETIRED `(* @volt-… *)` COMMENTS (rule FMT7) — a comment, and only a HINT where a body states no language.
 *
 * No Volt writes one any more: the boundary comment `(* @volt-implementation … *)` and the marker `(* @volt-graphical: … *)`
 * both became an `IMPLEMENTATION` line. To the IDE such a comment is a comment, and the push writes it as sent wherever
 * a body states its language (openspec bridge-refusal-review 1.4/2.1; `rcc_retired_comment_in_body` and
 * `pwh_gvl_retired_volt_comment` build clean on both vendors). It is read in ONE place, as the bridge reads it
 * (`StReader.Unmarked`, `ImplementationMarker.FindRetiredComment`): a body that states no language and holds one was
 * pulled by an older Volt, and the finding for that body names the comment (`server/diagnostics.ts`).
 *
 * A comment only: the lexer puts a comment in its own token with every comment nested in it, so an opening anywhere in
 * a block comment's text is a comment's; the same characters after `//` or in a string are text.
 */
import type { Token } from "../lex/tokens.js"

// `(*`, then `@volt-` on the same line: the prefix every retired Volt comment carried (`ImplementationMarker.RetiredTag`).
const RETIRED_OPENING = /\(\*[^\S\r\n]*@volt-/i

/**
 * The first `(* @volt-… *)` comment among `tokens`, as the push quotes it (`ImplementationMarker.FindRetiredComment`):
 * on the opening's own line, from `(*` to the first `*)` there, or to the line's end — or undefined. The push reads one
 * line, so the tag must stand on the opening's line, and a comment running on past it is quoted only that far.
 */
export function retiredCommentIn(tokens: readonly Token[]): string | undefined {
  for (const t of tokens) {
    if (t.kind !== "block_comment") continue
    const m = RETIRED_OPENING.exec(t.text)
    if (m === null) continue
    const eol = t.text.slice(m.index).search(/[\r\n]/)
    const line = eol < 0 ? t.text.slice(m.index) : t.text.slice(m.index, m.index + eol)
    const close = line.indexOf("*)", 2)
    return (close < 0 ? line : line.slice(0, close + 2)).trim()
  }
  return undefined
}
