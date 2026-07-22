/**
 * deprecated-keyword (C0098 · declarations/). The obsolete `FUNCTIONBLOCK` spelling (no underscore) is no longer
 * supported — the modern keyword is `FUNCTION_BLOCK`. The lexer treats `FUNCTIONBLOCK` as a plain identifier, so
 * the parser never sees an FB there; we re-lex and flag the `FUNCTIONBLOCK <name>` token pair directly.
 *
 * Zero-FP: two consecutive identifiers only occur in a declaration head, and `FUNCTIONBLOCK <ident>` is the
 * deprecated keyword form (a member access `FUNCTIONBLOCK.x` or a typed decl `x : FUNCTIONBLOCK;` puts a punct
 * after it, not an identifier).
 *
 * (C0099 — inline local enums — is intentionally NOT here: they are common and compile clean, so it is deferred
 * as a corpus-gate demotion; see the catalog note.)
 */
import { isTrivia } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkDeprecatedKeyword(ctx: CheckContext, out: DiagnosticItem[]): void {
  const toks = ctx.tokens().filter((t) => !isTrivia(t.kind))
  for (let i = 0; i + 1 < toks.length; i++) {
    const t = toks[i]!
    if (t.kind !== "identifier" || t.text.toUpperCase() !== "FUNCTIONBLOCK") continue
    if (toks[i + 1]!.kind !== "identifier") continue
    out.push({
      severity: "error",
      span: t.span,
      source: SOURCE,
      code: "deprecated-functionblock",
      message: ctx.messages.deprecatedFunctionBlock(),
    })
  }
}
