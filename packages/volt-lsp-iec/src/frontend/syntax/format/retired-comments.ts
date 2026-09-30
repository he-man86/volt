/**
 * THE RETIRED `(* @volt-… *)` COMMENTS (rule FMT7) — reported naming `volt pull`, as the push refuses a file holding
 * one.
 */
import type { Token } from "../lex/tokens.js"
import { IMPLEMENTATION_KEYWORD } from "./implementation-line.js"
import type { ReportAt } from "./lines.js"

// `(*`, then `@volt-`: the prefix every retired Volt comment carried (`ImplementationMarker.RetiredTag`).
const RETIRED_OPENING = /\(\*\s*@volt-/i

/**
 * Every `(* @volt-… *)` comment, reported naming `volt pull` — as the push refuses a file holding one
 * (`StReader`, `ImplementationMarker.FindRetiredComment`). No Volt writes one any more: the boundary comment
 * `(* @volt-implementation … *)` and the marker `(* @volt-graphical: … *)` both became an `IMPLEMENTATION` line, so
 * a comment of that spelling says the file was pulled by an older Volt. This is no reading of the old form — its
 * body is still read as a body that states no language — only the one sentence that names the repair, where a
 * workspace with no library manifest has no other place to say it.
 *
 * A comment only: the lexer puts a comment in its own token with every comment nested in it, so an opening anywhere in
 * a block comment's text is a comment's; the same characters after `//` or in a string are text.
 */
export function reportRetiredComments(tokens: readonly Token[], report: ReportAt): void {
  for (const t of tokens) {
    if (t.kind !== "block_comment") continue
    const m = RETIRED_OPENING.exec(t.text)
    if (m === null) continue
    const close = t.text.indexOf("*)", m.index + 2)
    const text = (close < 0 ? t.text.slice(m.index) : t.text.slice(m.index, close + 2)).trim()
    report(
      `'${text}' is a comment of a Volt from before bodies were stated by an ${IMPLEMENTATION_KEYWORD} line. Run ` +
        "`volt pull` once to rewrite the workspace in the current format.",
      t.span,
    )
  }
}

/** Is this token a `(* @volt-… *)` comment (`reportRetiredComments`)? */
export function isRetiredComment(t: Token): boolean {
  return t.kind === "block_comment" && RETIRED_OPENING.test(t.text)
}
