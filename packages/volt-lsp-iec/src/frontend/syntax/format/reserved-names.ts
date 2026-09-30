/**
 * `IMPLEMENTATION` IS A RESERVED NAME (rule FMT8) — the file format's rule, reported on every token spelled like it
 * that is not a body's line.
 */
import type { Token } from "../lex/tokens.js"
import { IMPLEMENTATION_KEYWORD, isImplementationKeyword } from "./implementation-line.js"
import type { ReportAt } from "./lines.js"

/**
 * `IMPLEMENTATION` is RESERVED: nothing in a file may be named it, in any case — a variable at any scope, a member, the
 * POU, an enum value, a struct member. A name spelled like the line could stand at the start of one and read as it,
 * which is why the push refuses every such name (`StReader.RefuseReservedNames`); this reports the same tokens.
 *
 * Every identifier token spelled like the keyword is a name, EXCEPT one that opens a line of the keyword's shape inside
 * a body (`claimed`): that one is the boundary, or the second line `splitImplementation` already reported by name.
 */
export function reportReservedNames(tokens: readonly Token[], claimed: (t: Token) => boolean, report: ReportAt): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (!isImplementationKeyword(t) || claimed(t)) continue
    report(
      `'${t.text}' is reserved: ${IMPLEMENTATION_KEYWORD} is the line that states where a body starts and what ` +
        "language it is in, so nothing may be named it. Rename it.",
      t.span,
    )
  }
}
