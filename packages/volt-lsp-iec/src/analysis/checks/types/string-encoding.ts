/**
 * string-not-representable (types/). A STRING literal holding a character past Latin-1, in a project whose Compile option
 * "UTF-8 Encoding for STRING" is off: CODESYS stores a STRING one byte per character (Latin-1 — ö is 246) and such a
 * character as '?', and its build warns "The string literal 'a计b...' contains non-representable characters. The project
 * option 'UTF-8 Encoding for STRING' could be used." — quoting the literal's first seven characters and "..." (`slit_*`,
 * CODESYS 3.5.21.40, 2026-11-08), in any context, a WSTRING's included (`slit_into_wstring`). With the option on the
 * literal is its UTF-8 bytes and nothing is said; where no `.projectsettings` states the option, nothing is judged.
 */
import type { CheckContext } from "../../pipeline/context.js"
import { forEachExpr } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkStringEncoding(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.utf8Encoding !== false) return
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    if (e.kind !== "literal" || e.literalKind !== "string" || typeof e.value !== "string") return
    const chars = Array.from(e.value)
    if (!chars.some((c) => c.codePointAt(0)! > 0xff)) return
    emit(out, e.span, "string-not-representable", ctx.messages.stringNotRepresentable(chars.slice(0, 7).join("")), "warning")
  })
}
