/**
 * attribute-placement (declarations/) — a pragma attribute applied to a POU kind that doesn't accept it:
 *   C0550 pack-mode-not-allowed — `{attribute 'pack_mode'}` on a FUNCTION or METHOD (pack_mode is only valid
 *          on data structures).
 *
 * Pragmas are lexer trivia, so the parser drops the POU-leading `{attribute '…'}` blocks. We re-lex and attach
 * each attribute pragma to the unit it *immediately* precedes (only whitespace/comments/other pragmas between),
 * exactly the "leading trivia" ownership the parser skips. Zero-FP: only fires for `pack_mode` and only when the
 * owned unit is a FUNCTION/METHOD, so a pack_mode on a struct/var (its legal home) is never flagged.
 */
import { lex, isTrivia } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAttributePlacement(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return // live /build: TwinCAT silently accepts pack_mode on a FUNCTION/METHOD
  // Map each FUNCTION/METHOD unit's start offset → the POU-kind name the message uses.
  const kindAt = new Map<number, string>()
  for (const u of ctx.parseResult.units) {
    if (u.kind === "function") kindAt.set(u.span.start, "FUNCTION")
    else if (u.kind === "method") kindAt.set(u.span.start, "METHOD")
  }
  if (kindAt.size === 0) return

  let leading: { name: string; span: DiagnosticItem["span"] }[] = []
  for (const t of lex(ctx.source)) {
    if (t.kind === "pragma") {
      const name = attributeName(t.text)
      if (name !== undefined) leading.push({ name, span: t.span })
      continue
    }
    if (isTrivia(t.kind)) continue // whitespace/comments don't break the leading-attribute run
    const kind = kindAt.get(t.span.start)
    if (kind !== undefined)
      for (const p of leading)
        if (p.name === "pack_mode")
          out.push({
            severity: "error",
            span: p.span,
            source: SOURCE,
            code: "pack-mode-not-allowed",
            message: ctx.messages.packModeNotAllowed(kind),
          })
    leading = [] // any meaningful token consumes/ends the leading run
  }
}

/** The first quoted name of an `{attribute 'name' …}` pragma, else undefined. */
function attributeName(text: string): string | undefined {
  return /^\{\s*attribute\s+'([^']*)'/i.exec(text)?.[1]
}
