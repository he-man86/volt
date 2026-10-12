/**
 * The TEXT EDITS a quick fix is made of (openspec lsp-quick-fixes design.md §2, §4): a check that reports a finding builds
 * its fixes from the facts it already resolved, and these helpers only turn offsets in the reporting document into
 * `FixEdit`s — each carrying the text it replaces, so the renderer can refuse a fix whose document has moved on.
 *
 * Every fix stays in the reporting document (§1's "local edit"), so no edit here names a `uri`.
 */
import type { Span, VarDecl, VarSection } from "../../frontend/syntax/index.js"
import type { Fix, FixEdit } from "./diagnostic-item.js"

/** The span of `source[start, end)`, its line (1-based) and column (0-based) counted as the lexer counts them. */
export function spanOf(source: string, start: number, end: number): Span {
  const at = (offset: number): [number, number] => {
    let line = 1
    let lineStart = 0
    for (let i = 0; i < offset; i++)
      if (source.charCodeAt(i) === 10) {
        line++
        lineStart = i + 1
      }
    return [line, offset - lineStart]
  }
  const [startLine, startCol] = at(start)
  const [endLine, endCol] = at(end)
  return { start, end, startLine, startCol, endLine, endCol }
}

/** Replace `source[start, end)` by `newText`. */
export function replaceText(source: string, start: number, end: number, newText: string): FixEdit {
  return { span: spanOf(source, start, end), replaces: source.slice(start, end), newText }
}

/** Insert `newText` at `offset`. */
export function insertText(source: string, offset: number, newText: string): FixEdit {
  return replaceText(source, offset, offset, newText)
}

/**
 * Remove `source[start, end)` as a construct of its own: when nothing but blanks stands beside it on its line(s), the
 * whole line goes with its line break (`level;` alone on its line, a declaration, a pragma); otherwise the construct and
 * the blanks AFTER it, so the text that follows closes up (`lbl: out := 1;` → `out := 1;`).
 */
export function removeConstruct(source: string, start: number, end: number): FixEdit {
  let lineStart = start
  while (lineStart > 0 && (source[lineStart - 1] === " " || source[lineStart - 1] === "\t")) lineStart--
  let after = end
  while (after < source.length && (source[after] === " " || source[after] === "\t")) after++
  const aloneBefore = lineStart === 0 || source[lineStart - 1] === "\n"
  const lineEnd = source.startsWith("\r\n", after) ? after + 2 : source[after] === "\n" ? after + 1 : after === source.length ? after : -1
  if (aloneBefore && lineEnd >= 0) return replaceText(source, lineStart, lineEnd, "")
  return replaceText(source, start, after, "")
}

/**
 * `text` with its comments and string literals blanked to spaces, offsets kept — so a word search finds the CODE's word,
 * never one a comment or a string mentions (`VAR RETAIN (* keep RETAIN here *)`: the keyword is the first RETAIN, not the
 * last). `(* *)` nests, as the vendors read it; `//` runs to the line end.
 */
function codeOnly(text: string): string {
  const out = text.split("")
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " "
  }
  let i = 0
  while (i < text.length) {
    let j = i + 1
    if (text.startsWith("(*", i)) {
      let depth = 0
      j = i
      while (j < text.length) {
        if (text.startsWith("(*", j)) {
          depth++
          j += 2
        } else if (text.startsWith("*)", j)) {
          depth--
          j += 2
          if (depth === 0) break
        } else j++
      }
      blank(i, j)
    } else if (text.startsWith("//", i)) {
      j = text.indexOf("\n", i)
      if (j < 0) j = text.length
      blank(i, j)
    } else if (text[i] === "'" || text[i] === '"') {
      const quote = text[i]
      while (j < text.length && text[j] !== quote) j += text[j] === "$" ? 2 : 1
      j = Math.min(j + 1, text.length)
      blank(i, j)
    }
    i = j
  }
  return out.join("")
}

/** The offset just past `name`'s first whole-word occurrence (case-insensitive) in `source[from, to)`, comments and
 *  strings aside (`codeOnly`), or undefined. */
export function findWord(source: string, from: number, to: number, word: string): { start: number; end: number } | undefined {
  const re = new RegExp(`(?<![A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "i")
  const m = re.exec(codeOnly(source.slice(from, to)))
  return m === null ? undefined : { start: from + m.index, end: from + m.index + m[0].length }
}

/** One fix of `edits` titled `title`; `preferred` only where no other edit builds clean with another meaning (§3). */
export function fixOf(title: string, edits: readonly FixEdit[], preferred = false): Fix {
  return { title, edits, ...(preferred ? { preferred: true as const } : {}) }
}

/** The line break the document uses (a CRLF document keeps its CRLF in what a fix inserts). */
export function lineBreakOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n"
}

/** The LAST whole-word, case-insensitive occurrence of `word` in `source[from, to)`, comments and strings aside
 *  (`codeOnly`) — a header keyword before the name it modifies (the last, so an `{attribute 'abstract'}` above the header
 *  is never taken for the keyword). */
export function findLastWord(source: string, from: number, to: number, word: string): { start: number; end: number } | undefined {
  const re = new RegExp(`(?<![A-Za-z0-9_'])${word}(?![A-Za-z0-9_'])`, "gi")
  let found: { start: number; end: number } | undefined
  for (const m of codeOnly(source.slice(from, to)).matchAll(re)) found = { start: from + m.index!, end: from + m.index! + m[0].length }
  return found
}

/** Remove the header keyword `word` (its last occurrence in `source[from, to)`) and the blanks before it — or after it,
 *  where none stand before (`VAR_INPUT RETAIN` → `VAR_INPUT`, `ABSTRACT FINAL X` → `FINAL X`). */
export function removeWord(source: string, from: number, to: number, word: string): FixEdit | undefined {
  const at = findLastWord(source, from, to, word)
  if (at === undefined) return undefined
  let start = at.start
  while (start > from && (source[start - 1] === " " || source[start - 1] === "\t")) start--
  let end = at.end
  if (start === at.start) while (source[end] === " " || source[end] === "\t") end++
  return replaceText(source, start, end, "")
}

/**
 * "Add '()'" (design.md §4 F9, `qf_c0130_call`, `qf_fnparens_call`): the call a FUNCTION or METHOD named without one
 * makes, after the name — only for a callable that takes NO argument: one with a VAR_INPUT or a VAR_IN_OUT is refused
 * called bare ("Function 'Value' requires exactly '1' inputs", `qf_c0130_before_input`, `_inout`, `qf_fnparens_before_*`),
 * and which argument is not the fix's to choose.
 */
export function addParensFix(source: string, end: number, callable: { varSections: readonly VarSection[] }): Fix | undefined {
  const takes = callable.varSections.some((s) => (s.sectionKind === "VAR_INPUT" || s.sectionKind === "VAR_IN_OUT") && s.decls.length > 0)
  return takes ? undefined : fixOf("Add '()'", [insertText(source, end, "()")], true)
}

/**
 * "Quote as '<attribute>'" (design.md §4 F9, `qf_c0051_quote`): the unquoted attribute name of a `hasattribute` condition
 * in the pragma at `span`, written as the single-byte string the compiler expects (`preferred` — it can mean nothing
 * else). The name is its last occurrence in the pragma, the condition's operand.
 */
export function quoteAttributeFix(source: string, span: Span, attribute: string): Fix | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(attribute)) return undefined
  const at = findLastWord(source, span.start, span.end, attribute)
  return at === undefined ? undefined : fixOf(`Quote as '${attribute}'`, [replaceText(source, at.start, at.end, `'${attribute}'`)], true)
}

/**
 * A declaration's ` := <value>` removed, up to its `;` (design.md §4 F9: `qf_c0238_remove`, `qf_c0533_remove`) — `title`
 * names what it is to the finding. `preferred`: the value is one the compiler refuses or never uses. None where the
 * value is written with another operator (`REF=`).
 */
export function removeInitializerFix(source: string, decl: VarDecl, title: string): Fix | undefined {
  if (decl.init === undefined || decl.initOp !== undefined) return undefined
  if (!/^\s*:=\s*$/.test(source.slice(decl.type.span.end, decl.init.span.start))) return undefined
  return fixOf(title, [replaceText(source, decl.type.span.end, decl.init.span.end, "")], true)
}

/** "Swap the bounds" (design.md §4 F9, `qf_border_swap`, `qf_caserange_swap`): the two bounds' texts exchanged — a range
 *  written high to low means the one written low to high (`preferred`). */
export function swapBoundsFix(source: string, lower: Span, upper: Span): Fix {
  const [lo, hi] = [source.slice(lower.start, lower.end), source.slice(upper.start, upper.end)]
  return fixOf("Swap the bounds", [replaceText(source, lower.start, lower.end, hi), replaceText(source, upper.start, upper.end, lo)], true)
}

/** "Change BIT to BOOL" (design.md §4 F9, `qf_c0203_bool`, `qf_c0204_bool`, `qf_c0206_bool`): the BIT a place cannot
 *  hold written as the BOOL it can — the one type a single bit's value has besides (`preferred`). */
export function bitToBoolFix(source: string, bit: Span): Fix {
  return fixOf("Change BIT to BOOL", [replaceText(source, bit.start, bit.end, "BOOL")], true)
}

/** The VAR section among `sections` that holds `decl`. */
export function sectionOf(sections: readonly VarSection[], decl: VarDecl): VarSection | undefined {
  return sections.find((s) => s.decls.includes(decl))
}

/** Are two VAR sections the same kind with the same qualifiers — so a variable means the same in either (an input is no
 *  local, a constant no variable, a RETAIN one survives a reset)? */
export function sameSection(a: VarSection, b: VarSection): boolean {
  return a.sectionKind === b.sectionKind && (a.constant === true) === (b.constant === true) && (a.retain === true) === (b.retain === true) && (a.persistent === true) === (b.persistent === true)
}
