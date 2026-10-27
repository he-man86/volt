/**
 * WHERE A BODY'S OWN `%`-LINES ARE PEELED FROM ITS TOKENS — under its `%LANGUAGE` line (`peelProperties`), or closing the
 * declaration of a member with no body slot (`peelClosingProperties`): exactly where the push peels them
 * (`StReader.PeelPropertiesUnder`, `StReader.PeelPropertiesClosing`). The lines' grammar is `object-properties.ts`'s.
 */
import type { Token } from "../lex/tokens.js"
import { joinSpans } from "../span.js"
import { lineAround } from "./lines.js"
import { propertyKeyOf, type PropertyLine } from "./object-properties.js"

/**
 * The `%`-lines on the lines DIRECTLY under a body's `%LANGUAGE` line — `code` opens with the token holding the newline
 * that ends that line — as their texts and the index of the token that ends the last; or undefined. Exactly where the
 * push peels them (`StReader.PeelPropertiesUnder`) and nowhere else: not after a blank line or a comment, not in another
 * case. `%FOLDER` is peeled only in a member's block (`folderAllowed`); under a POU's own line it is code, as the push
 * reads it. Anywhere the push does not peel a line, it pushes it into the IDE as code — so the LSP leaves it in the body,
 * where the parser reports it.
 */
export function peelProperties(code: readonly Token[], folderAllowed: boolean): { lines: PropertyLine[]; end: number } | undefined {
  const lines: PropertyLine[] = []
  let at = 0
  for (;;) {
    const newline = code[at]
    // Only indentation may follow the line's newline in its token: a second newline is a blank line.
    if (newline?.kind !== "whitespace" || newline.text.slice(newline.text.indexOf("\n") + 1).includes("\n")) break
    if (at + 1 >= code.length || code[at + 1]!.kind === "eof") break
    const { text, end } = lineAround(code, at + 1)
    const key = propertyKeyOf(text)
    if (key === undefined || (key === "FOLDER" && !folderAllowed)) break
    lines.push({ text: text.trim(), key, span: joinSpans(code[at + 1]!.span, code[Math.max(at + 1, end - 1)]!.span) })
    at = end
  }
  return lines.length === 0 ? undefined : { lines, end: at }
}

/**
 * The `%`-lines CLOSING a member's declaration when its body has no `%LANGUAGE` line (a member with no body slot) — the
 * trailing whole lines of `code` that are property lines, back to the first that is not (a blank line included) — and
 * the index of the first token of the first; or undefined. Where the push peels them (`StReader.PeelPropertiesClosing`):
 * `code` ends with the newline before the member's END line, which is the layout's separator and no line of its own.
 */
export function peelClosingProperties(code: readonly Token[], folderAllowed: boolean): { lines: PropertyLine[]; start: number } | undefined {
  const offsets: number[] = []
  let text = ""
  for (const t of code) {
    offsets.push(text.length)
    if (t.kind !== "eof") text += t.text
  }
  const rows = text.split("\n")
  if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop()
  // `at`: where the row being read ends (the offset of its newline, or the text's end)
  let at = text.length - (text.endsWith("\n") ? 1 : 0)
  const lines: PropertyLine[] = []
  let start = code.length
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r]!
    const key = propertyKeyOf(row)
    if (key === undefined || (key === "FOLDER" && !folderAllowed)) break
    const rowStart = at - row.length
    let first = -1
    let last = -1
    for (let i = 0; i < code.length; i++) {
      if (offsets[i]! < rowStart || offsets[i]! >= at || code[i]!.kind === "whitespace" || code[i]!.kind === "eof") continue
      if (first < 0) first = i
      last = i
    }
    if (first < 0) break
    lines.unshift({ text: row.trim(), key, span: joinSpans(code[first]!.span, code[last]!.span) })
    start = first
    at = rowStart - 1
  }
  return lines.length === 0 ? undefined : { lines, start }
}
