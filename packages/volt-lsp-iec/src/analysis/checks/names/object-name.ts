/**
 * object-name (names/). An object the IDE REFUSES TO CREATE by its name: the push's create answers with the IDE's own
 * sentence — CODESYS "The name 'INT' is not valid for this object.", TwinCAT "Creating the child named 'INT' is not
 * possible on node (Name mismatch)" — and nothing is built, so that sentence is the vendor's whole answer (openspec
 * lsp-field-followups 3). Both IDEs' create rule, measured (volt-cli `scripts/vendor-facts.<vendor>.json`, facts
 * `refused-names` and `identifier-shapes`, DIALECT C28/C28b; conformance `names/word-positions.ts`, `names/object-names.ts`):
 *
 *   - a word of the vendor's refused list (`refused-names.ts`), in any case — for every object and for a METHOD, ACTION
 *     or PROPERTY; an interface's METHOD or PROPERTY was asked one word of it (`a__b`), so only that one;
 *   - an ASCII name that is no identifier (`My-Name`, `2Fast`, `a.b`);
 *   - a name between backticks (`` `a b` ``): CODESYS creates it, TwinCAT refuses it;
 *   - a name past ASCII: CODESYS refuses it unless the project's "Unicode identifiers" is on, and then still refuses one
 *     that is no identifier in its script (`1点`, a no-break space); TwinCAT refuses every one.
 *
 * Whose name: the OBJECT's is its file's (`objectNameOf` — the name the push creates it by, whatever the text's header
 * says); a member's is the one the push reads off its header line — the last word before the colon, words split at
 * blanks outside backticks, comments blanked (volt-cli `StReader.ParseSignature`) — so `METHOD My-Name : BOOL` is asked
 * as `My-Name`, which the parser reads as `My` and a stray `-Name`.
 */
import { endsLineAt, isIdentCont, isIdentStart, objectNameOf, sourceObjectOf, type Span, type Token } from "../../../frontend/syntax/index.js"
import type { Vendor } from "../../config.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { spanOf } from "../../shared/fixes.js"
import { CODESYS_REFUSED_NAMES, TWINCAT_REFUSED_NAMES } from "../../shared/refused-names.js"

const MEMBER_KEYWORDS: ReadonlySet<string> = new Set(["METHOD", "ACTION", "PROPERTY"])
/** The words of the lists asked as an interface's METHOD and PROPERTY — on both vendors, and both refused it. */
const ASKED_ON_INTERFACE_MEMBERS: ReadonlySet<string> = new Set(["A__B"])
/** Every word of the vendor's list applies. */
const ALL_WORDS = undefined

export function checkObjectName(ctx: CheckContext, out: DiagnosticItem[]): void {
  const object = sourceObjectOf(ctx.uri)
  if (object === undefined) return // text that is no workspace file creates nothing
  const tokens = ctx.tokens()
  const own = objectNameOf(ctx.uri)!
  if (refused(ctx.config.vendor, ctx.config.unicodeIdentifiers, own, ALL_WORDS)) {
    const at = tokens.find((t) => t.text.toUpperCase() === own.toUpperCase()) ?? tokens.find((t) => !isCommentary(t))
    emit(out, at?.span ?? spanOf(ctx.source, 0, 0), "object-name-refused", ctx.messages.objectNameRefused(own), "error")
  }
  const words = object === "interface" ? ASKED_ON_INTERFACE_MEMBERS : ALL_WORDS
  for (const header of memberHeaders(ctx.source, tokens)) {
    if (!refused(ctx.config.vendor, ctx.config.unicodeIdentifiers, header.name, words)) continue
    emit(out, header.span, "object-name-refused", ctx.messages.objectNameRefused(header.name), "error")
  }
}

/** Whether the vendor's create refuses `name`; `words` the refused words that apply to it (all of the vendor's list when
 *  undefined). */
export function refused(vendor: Vendor, unicode: boolean, name: string, words: ReadonlySet<string> | undefined): boolean {
  if (name.length >= 2 && name[0] === "`" && name.indexOf("`", 1) > 0) return vendor === "twincat"
  if ([...name].some((c) => c > "\x7f")) return vendor === "twincat" || !unicode || !isIdentifier(name)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return true
  const upper = name.toUpperCase()
  const list = vendor === "twincat" ? TWINCAT_REFUSED_NAMES : CODESYS_REFUSED_NAMES
  return list.has(upper) && (words === undefined || words.has(upper))
}

/** An identifier in any script — what CODESYS creates past ASCII with "Unicode identifiers" on (DIALECT C28b). */
function isIdentifier(name: string): boolean {
  const chars = [...name]
  return chars.length > 0 && isIdentStart(chars[0]!) && chars.slice(1).every(isIdentCont)
}

const isCommentary = (t: Token): boolean =>
  t.kind === "whitespace" || t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma" || t.kind === "eof"

/** Each member header in the text — a line whose first code is METHOD, ACTION or PROPERTY — with the name the push
 *  reads off it and where that name stands. */
function memberHeaders(source: string, tokens: readonly Token[]): { name: string; span: Span }[] {
  const out: { name: string; span: Span }[] = []
  let lineHasCode = false
  for (const t of tokens) {
    if (t.kind === "whitespace" && /[\r\n]/.test(t.text)) lineHasCode = false
    if (isCommentary(t)) continue
    const first = !lineHasCode
    lineHasCode = true
    if (!first || t.kind !== "keyword" || !MEMBER_KEYWORDS.has(t.text.toUpperCase())) continue
    const named = pushedName(source, tokens, t)
    if (named !== undefined) out.push(named)
  }
  return out
}

/** The name the push reads off the header line opening at `keyword`: comments and pragmas blanked, a trailing `;` off,
 *  the text before the first colon outside backticks, split at blanks outside backticks — its last word. */
function pushedName(source: string, tokens: readonly Token[], keyword: Token): { name: string; span: Span } | undefined {
  const start = keyword.span.start
  let end = start
  while (end < source.length && !endsLineAt(source, end) && source[end] !== "\r") end++
  const line = [...source.slice(start, end)]
  for (const t of tokens) {
    if (t.kind !== "line_comment" && t.kind !== "block_comment" && t.kind !== "pragma") continue
    if (t.span.end <= start || t.span.start >= end) continue
    for (let i = Math.max(t.span.start, start); i < Math.min(t.span.end, end); i++) line[i - start] = " "
  }
  let quoted = false
  const masked = line.map((c) => {
    if (c === "`") quoted = !quoted
    else if (quoted) return "x"
    return c
  })
  let stop = masked.indexOf(":")
  if (stop < 0) stop = masked.length
  while (stop > 0 && (masked[stop - 1] === " " || masked[stop - 1] === "\t")) stop--
  if (stop > 0 && masked[stop - 1] === ";" && masked.indexOf(":") < 0) stop--
  const words: { from: number; to: number }[] = []
  for (let i = 0, from = -1; i <= stop; i++) {
    const blank = i === stop || masked[i] === " " || masked[i] === "\t"
    if (blank && from >= 0) {
      words.push({ from, to: i })
      from = -1
    } else if (!blank && from < 0) from = i
  }
  if (words.length < 2) return undefined
  const { from, to } = words[words.length - 1]!
  // `line` holds code points; the offsets in `source` are UTF-16 units
  const offset = (k: number) => start + line.slice(0, k).join("").length
  return { name: line.slice(from, to).join(""), span: spanOf(source, offset(from), offset(to)) }
}
