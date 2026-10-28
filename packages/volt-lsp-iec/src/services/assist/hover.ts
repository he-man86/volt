/**
 * hover (Layer E · E.3 · assist). A markdown tooltip for the symbol under the cursor: a reconstructed
 * declaration line in an `iecst` code fence + the human kind label (the same `humanKind` completion
 * uses — the parity test guards they agree). Thin over `resolveAt` + `types/renderTypeExpr`.
 * A compiler built-in (`INT`, `MOD`, `SQRT`) that no symbol answers falls back to `builtinHover` — the one dialect-aware
 * entry: `__POUNAME` or `BOOL_TO_LDATE` on TwinCAT is "not defined", so it gets no built-in
 * tooltip. A library element never needs it — it is a symbol, from its materialized declaration.
 */
import type { Hover } from "vscode-languageserver-protocol"
import { allUnits, renderTypeExpr, spanContains, unitBodies, type Dialect } from "../../frontend/syntax/index.js"
import { dialectOf, type Scope, type Symbol } from "../../frontend/symbols/index.js"
import { humanKind, rangeFromSpan, resolveAt, SYMBOL_KINDS } from "../shared/index.js"
import { builtinHover, pragmaHelp } from "./builtin-hover.js"
import type { Document } from "../shared/index.js"
import { tokenAtOffset } from "../shared/index.js"

export function hover(doc: Document, project: Scope, offset: number): Hover | undefined {
  const tok = tokenAtOffset(doc.parseResult.tokens, offset)
  const range = tok !== undefined ? { range: rangeFromSpan(tok.span) } : {}

  const sym = resolveAt(doc, project, offset)
  if (sym !== undefined) return { ...symbolHover(sym), ...range }

  // Not a user symbol — a built-in (INT / MOD / SQRT / …) the project's dialect has.
  return builtinHover(doc, project, offset)
}

/**
 * Hover for a pragma — the directive (`{IF …}`, `{region …}`) or the `{attribute '<name>'}` name under the
 * cursor, described by `pragmaHelp` in the project's dialect. Pragmas are lexer trivia (`tokenAtOffset` skips them), so
 * read the parse's tokens for the `pragma` token spanning the offset. Wired as a hover fallback.
 */
export function pragmaHover(doc: Document, project: Scope, offset: number): Hover | undefined {
  const dialect = dialectOf(project)
  for (const t of doc.parseResult.tokens) {
    if (t.kind !== "pragma" || offset < t.span.start || offset >= t.span.end) continue
    // Cursor on the attribute NAME inside `{attribute 'NAME'}` → describe the attribute.
    const am = /^\{\s*attribute\s+'([^']*)'/i.exec(t.text)
    if (am?.[1] !== undefined) {
      const nameStart = t.span.start + am[0].length - am[1].length - 1 // just inside the closing quote-less name
      if (offset >= nameStart && offset < nameStart + am[1].length) return pragmaMd(am[1], dialect)
    }
    // Otherwise the leading directive word.
    const dm = /^\{\s*([A-Za-z_]\w*)/.exec(t.text)
    return dm?.[1] !== undefined ? pragmaMd(dm[1], dialect) : undefined
  }
  return undefined
}

function pragmaMd(word: string, dialect: Dialect): Hover | undefined {
  const help = pragmaHelp(word, dialect)
  return help !== undefined ? { contents: { kind: "markdown", value: `\`{${word}}\`\n\n${help}` } } : undefined
}

/** The markdown hover for a resolved symbol — a declaration line + kind label. */
function symbolHover(sym: Symbol): Hover {
  const value = `\`\`\`iecst\n${declarationLine(sym)}\n\`\`\`\n\n_${humanKind(sym.kind)}_`
  return { contents: { kind: "markdown", value } }
}

/** Reconstruct a one-line declaration from the symbol: `name : Type` for typed things, else `KEYWORD name`. */
function declarationLine(sym: Symbol): string {
  if (sym.typeExpr !== undefined) return `${sym.name} : ${renderTypeExpr(sym.typeExpr)}`
  return `${SYMBOL_KINDS[sym.kind].keyword} ${sym.name}`
}

const HIDDEN_LANGUAGES: Record<string, string> = {
  CFC: "Continuous Function Chart",
  SFC: "Sequential Function Chart",
  IL: "Instruction List",
  FBD: "Function Block Diagram",
  LD: "Ladder Diagram",
}

/**
 * Hover for a hidden body's line — `%LANGUAGE <LANG> UNSUPPORTED`: always for CFC, SFC and IL, and for an LD/FBD body
 * holding a shape network text cannot represent yet. Explains that no implementation is shown and the push never writes
 * it, while the declaration above the line stays editable. Read off the parse, so only a line the splitter took as a
 * body's boundary answers — never a look-alike in a comment.
 */
export function readOnlyBodyHover(doc: Document, offset: number): Hover | undefined {
  for (const unit of allUnits(doc.parseResult.units)) {
    for (const body of unitBodies(unit)) {
      const line = body.languageLine
      if (line?.statement?.kind !== "unsupported" || !spanContains(line.span, offset)) continue
      const { language } = line.statement
      const name = HIDDEN_LANGUAGES[language] ?? language
      const why = !(language === "LD" || language === "FBD")
        ? `Volt does not read ${name}, so no implementation is shown for this body.`
        : `This ${name} body holds a shape network text cannot represent yet, so no implementation is shown for it.`
      const value = [
        "```iecst",
        line.text,
        "```",
        "",
        `_Volt hidden body (${name})_`,
        "",
        `${why} A push never writes it — it stays as it is in your IDE; to modify it, open the unit in CODESYS / ` +
          "TwinCAT. The declaration above this line is editable here and pushes as usual.",
      ].join("\n")
      return { contents: { kind: "markdown", value } }
    }
  }
  return undefined
}
