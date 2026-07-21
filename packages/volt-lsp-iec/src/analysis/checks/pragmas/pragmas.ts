/**
 * pragma diagnostics (D.2 · pragmas/). Several rules over the pragma tokens (the rest — wrong-vendor /
 * conflict / companion / init-slot — need the Layer-F pragma catalog and are FP-prone, so deferred):
 *   - CONDITIONAL balance: an orphan `{ELSE}`/`{ELSIF}`/`{END_IF}` with no open `{IF}`, and an `{IF}` left
 *     unterminated at end of source.
 *   - C0051 hasattribute: a `{IF hasattribute(pou: X, <attr>)}` whose attribute operand is unquoted.
 *   - MESSAGE pragmas: `{warning 'msg'}` / `{error 'msg'}` surface the author's compile-time message
 *     verbatim at matching severity (both compilers emit these when reached).
 *   - C0351 unknown `{attribute '<name>'}` (CODESYS-only) — a toggleable warning, only as complete as the catalog.
 *
 * Pragmas are lexer trivia (stripped from the parsed body), so re-lex the source for `pragma` tokens.
 * ponytail: no `{IF}` predicate evaluation — a message pragma inside a false branch is still surfaced;
 * upgrade to branch-aware when a corpus case needs it.
 */
import { lex } from "../../../syntax/index.js"
import { isKnownAttribute } from "../../../reference/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkPragmas(ctx: CheckContext, out: DiagnosticItem[]): void {
  const pragmas = lex(ctx.source)
    .filter((t) => t.kind === "pragma")
    .map((t) => ({ span: t.span, text: t.text, ...parsePragma(t.text) }))

  // C0051 — a `hasattribute(pou: X, <attr>)` conditional-compile operand whose attribute is unquoted. The
  // attribute must be a single-byte string literal ('MyAttribute'); a bare identifier is an error. Verified live
  // CODESYS 3.5.21. Narrow + FP-safe: fires only on the hasattribute form with a non-quoted last argument.
  for (const p of pragmas) {
    const m = /hasattribute\s*\(([^)]*)\)/i.exec(p.text)
    if (m === null) continue
    const attr = m[1]!.split(",").pop()!.trim()
    if (attr.length === 0 || attr.startsWith("'")) continue // quoted (or empty) — valid
    out.push({ severity: "error", span: p.span, source: SOURCE, code: "attribute-value-string", message: ctx.messages.attributeValueString(attr) })
  }

  // Conditional-compile balance — track the open {IF} stack in source order. An {END_IF}/{ELSE}/{ELSIF}
  // with no open {IF} is an orphan; any {IF} still open at the end is unterminated (both compiler errors,
  // wording confirmed against live).
  const ifStack: { span: DiagnosticItem["span"] }[] = []
  for (const p of pragmas) {
    const dir = p.directive.toLowerCase()
    if (dir === "if") {
      ifStack.push(p)
    } else if (dir === "end_if") {
      if (ifStack.length === 0) out.push(orphan(ctx, p))
      else ifStack.pop()
    } else if ((dir === "else" || dir === "elsif") && ifStack.length === 0) {
      out.push(orphan(ctx, p))
    }
  }
  for (const openIf of ifStack) {
    out.push({
      severity: "error",
      span: openIf.span,
      source: SOURCE,
      code: "unterminated-conditional-pragma",
      message: ctx.messages.unterminatedConditional(),
    })
  }

  // Message pragmas — only error/warning have IDE ground truth (info/text are hint-level, no oracle).
  for (const p of pragmas) {
    if (p.messageText === undefined) continue
    const dir = p.directive.toLowerCase()
    const severity = dir === "error" ? "error" : dir === "warning" ? "warning" : undefined
    if (severity === undefined) continue
    out.push({ severity, span: p.span, source: SOURCE, code: `message-pragma-${dir}`, message: p.messageText })
  }

  // Unknown `{attribute '<name>'}` — C0351, a toggleable warning (only as complete as the catalog). CODESYS-only:
  // live /build confirmed TwinCAT compiles an unknown attribute clean (no diagnostic), so firing it there would FP.
  if (ctx.config.vendor === "codesys") {
    for (const p of pragmas) {
      if (p.attributeName === undefined || isKnownAttribute(p.attributeName)) continue
      out.push({
        severity: "warning",
        span: p.span,
        source: SOURCE,
        code: "unknown-attribute",
        message: ctx.messages.unknownAttribute(p.attributeName),
      })
    }
  }
}

function orphan(ctx: CheckContext, p: { span: DiagnosticItem["span"]; directive: string }): DiagnosticItem {
  return {
    severity: "error",
    span: p.span,
    source: SOURCE,
    code: "orphan-conditional-pragma",
    message: ctx.messages.orphanPragma(p.directive),
  }
}

/** Extract a pragma's directive (first word), a message pragma's quoted body, and an attribute's name. */
function parsePragma(text: string): { directive: string; messageText?: string; attributeName?: string } {
  const m = /^\{\s*([^\s}]+)/.exec(text)
  const directive = m?.[1] ?? ""
  const dir = directive.toLowerCase()
  if (dir === "text" || dir === "info" || dir === "warning" || dir === "error") {
    const body = /^\{\s*\S+\s+'([^']*)'/.exec(text)
    if (body !== null) return { directive, messageText: body[1] }
  }
  if (dir === "attribute") {
    // `{attribute 'name'}` or `{attribute 'name' := 'value'}` — the name is the first quoted string.
    const name = /^\{\s*attribute\s+'([^']*)'/i.exec(text)
    if (name !== null) return { directive, attributeName: name[1] }
  }
  return { directive }
}
