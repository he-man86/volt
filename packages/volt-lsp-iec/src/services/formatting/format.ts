/**
 * formatting · format (Layer E · E.3). The formatting REQUESTS over the printer (`print.ts`): the whole document, a range
 * (each unit it touches, reprinted over exactly the text the printer writes), and on-type (the new line's indent).
 */
import type { Position, Range, TextEdit } from "vscode-languageserver-protocol"
import { isTrivia, lex, sourceStatements, type Span, type StatementList, stmtChildLists, type TopLevel, unitBodies } from "../../frontend/syntax/index.js"
import { clampedOffset, offsetFromPosition, rangeFromSpan } from "../shared/index.js"
import type { Document } from "../shared/index.js"
import { printUnit, TAB, verbatimText } from "./print.js"

/** LSP-shaped formatting options (`editorconfig`): tabs by default, spaces on request. */
interface FormatOptions {
  insertSpaces?: boolean
  tabSize?: number
}

/**
 * Format the whole document: each unit reprinted (or kept as written, `reprint`), and whatever stands between units —
 * a file header, a comment documenting the next unit, a pragma — kept as written. Joined as units, it was deleted.
 */
export function formatDocument(doc: Document, options?: FormatOptions): string {
  const parts: string[] = []
  const keep = (text: string) => {
    if (text.trim().length > 0) parts.push(verbatimText(text).trim())
  }
  let at = 0
  for (const unit of doc.parseResult.units) {
    const { start, end } = reprintedOffsets(doc, unit)
    keep(doc.source.slice(at, start))
    parts.push(reprint(doc, unit) ?? verbatimText(doc.source.slice(start, end)))
    at = end
  }
  keep(doc.source.slice(at))
  return applyIndentStyle(parts.join("\n\n") + "\n", options)
}

/** Range formatting: re-emit each top-level unit that intersects the range (edits are per-unit), in the file's line
 *  ending. A range past the end of a line or of the text is clamped to it, as LSP says. */
export function formatRange(doc: Document, range: Range, options?: FormatOptions): TextEdit[] {
  const start = clampedOffset(doc.source, range.start)
  const end = clampedOffset(doc.source, range.end)
  const edits: TextEdit[] = []
  for (const unit of doc.parseResult.units) {
    if (unit.span.end < start || unit.span.start > end) continue
    const printed = reprint(doc, unit)
    if (printed === undefined) continue // kept as written: no edit
    edits.push({ range: reprintedRange(doc, unit), newText: inLineEndingOf(doc.source, applyIndentStyle(printed, options)) })
  }
  return edits
}

/** Printed text (`\n`) in the line ending of the file it lands in: a CRLF file stays CRLF — an LF unit inside it left a
 *  file of mixed line endings, whose stray blank lines the push writes into the IDE body (`verbatimText`). The whole
 *  document is rewritten, so `formatDocument` writes `\n` throughout. */
function inLineEndingOf(source: string, printed: string): string {
  return source.includes("\r\n") ? printed.replace(/\n/g, "\r\n") : printed
}

/**
 * The text a unit's reprint replaces — what the printer writes beyond the unit's span too: the attributes before it and
 * the `END_…` keyword a POU's span stops before (`printOrKeep`). Edited over the span alone, the source's own
 * `END_FUNCTION_BLOCK` and `{attribute …}` stayed beside the reprinted ones.
 */
function reprintedRange(doc: Document, unit: TopLevel): Range {
  const { first, last } = reprintedSpans(doc, unit)
  return { start: rangeFromSpan(first).start, end: rangeFromSpan(last).end }
}

function reprintedOffsets(doc: Document, unit: TopLevel): { start: number; end: number } {
  const { first, last } = reprintedSpans(doc, unit)
  return { start: first.start, end: last.end }
}

function reprintedSpans(doc: Document, unit: TopLevel): { first: Span; last: Span } {
  // an attribute stands before its unit — one the unit carries from inside it (an interface property's) is no start
  const attribute = unit.attributes?.[0]?.span
  const first = attribute !== undefined && attribute.start < unit.span.start ? attribute : unit.span
  const next = doc.parseResult.tokens.find((t) => t.span.start >= unit.span.end && !isTrivia(t.kind))
  const last = next !== undefined && next.kind === "keyword" && /^END_/i.test(next.text) ? next.span : unit.span
  return { first, last }
}

/**
 * On-type formatting: after a newline, indent the fresh line to the block depth at the cursor.
 * ponytail: depth is a token-scan count of open blocks (IF/CASE/FOR/WHILE/REPEAT/__TRY vs their
 * closers) within the enclosing body — enough for auto-indent, not a full reflow.
 */
export function formatOnType(doc: Document, position: Position, ch: string, options?: FormatOptions): TextEdit[] {
  if (ch !== "\n") return []
  const offset = offsetFromPosition(doc.source, position)
  if (offset < 0) return []
  const depth = blockDepthAt(doc, offset)
  if (depth <= 0) return []
  const unit = options?.insertSpaces ? " ".repeat((options.tabSize ?? 2) * depth) : TAB.repeat(depth)
  return [{ range: { start: position, end: position }, newText: unit }]
}

/** Convert leading tabs to spaces per options (the printer always emits tabs internally). */
function applyIndentStyle(text: string, options?: FormatOptions): string {
  if (options?.insertSpaces !== true) return text
  const pad = " ".repeat(options.tabSize ?? 2)
  return text
    .split("\n")
    .map((line) => {
      const m = /^\t+/.exec(line)
      return m ? pad.repeat(m[0].length) + line.slice(m[0].length) : line
    })
    .join("\n")
}

/** Open-block depth of the ST body enclosing `offset`, by scanning the body's statements. */
function blockDepthAt(doc: Document, offset: number): number {
  for (const unit of doc.parseResult.units) {
    if (offset < unit.span.start || offset > unit.span.end) continue
    for (const body of unitBodies(unit)) {
      if (offset < body.span.start || offset > body.span.end) continue
      const parsed = sourceStatements(body) // as written: the cursor may sit in any conditional branch
      if (!parsed.ok) return 1 // inside a body but unparseable — one level of indent
      return statementDepthAt(parsed.statements, offset)
    }
  }
  return 0
}

function statementDepthAt(list: StatementList, offset: number): number {
  for (const s of list) {
    if (offset < s.span.start || offset > s.span.end) continue
    const inner = stmtChildLists(s).map((sub) => statementDepthAt(sub, offset))
    return 1 + Math.max(0, ...inner)
  }
  return 0
}

/**
 * The unit reprinted from its AST, or undefined when it is kept AS WRITTEN, because the reprint would delete text:
 * - the declaration parse refused something inside it: a refused declaration leaves no node, so the reprint deleted the
 *   user's line (`v : __VECTOR[4] OF REAL;` on TwinCAT, `v : final;` on either vendor);
 * - it holds a comment or pragma the printer does not write back: the AST holds no comments, so every comment in a
 *   declaration (`i : INT; // counter`) was deleted. The rule a commented body already follows (`printCode`), one level up;
 * - it carries an attribute from INSIDE it (an interface member's): the parser attaches it to the unit, so the printer
 *   wrote it above the unit's header, where it applies to the unit — a meaning change no AST comparison sees.
 */
function reprint(doc: Document, unit: TopLevel): string | undefined {
  if (refusedIn(doc, unit)) return undefined
  if (unit.attributes?.some((a) => a.span.start >= unit.span.start)) return undefined
  const printed = printUnit(unit)
  return dropsCommentary(doc, unit, printed) ? undefined : printed
}

/** Whether the reprint lacks a comment or pragma of the unit's text — each matched, in order, against the comment and
 *  pragma TOKENS of the printed text (lexed in the document's dialect): a raw text search found a dropped comment's text
 *  inside a string literal (`s := '// TODO';`) and counted it kept. */
function dropsCommentary(doc: Document, unit: TopLevel, printed: string): boolean {
  const { start, end } = reprintedOffsets(doc, unit)
  const printedCommentary = lex(printed, doc.parseResult.dialect).filter(isCommentary).map((t) => commentaryText(t.text))
  let from = 0
  for (const t of doc.parseResult.tokens) {
    if (t.span.start < start || t.span.end > end || !isCommentary(t)) continue
    const at = printedCommentary.indexOf(commentaryText(t.text), from)
    if (at < 0) return true
    from = at + 1
  }
  return false
}

function isCommentary(t: { kind: string }): boolean {
  return t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma"
}

/** A comment or pragma as the printer writes it: LF line endings, no trailing blank (a CRLF file's line comment ends in
 *  its CR). */
function commentaryText(text: string): string {
  return verbatimText(text).trimEnd()
}

/** Whether the declaration parse reported an error inside `unit`. */
function refusedIn(doc: Document, unit: TopLevel): boolean {
  return doc.parseResult.errors.some((e) => e.span.start >= unit.span.start && e.span.start < unit.span.end)
}
