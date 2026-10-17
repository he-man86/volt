/**
 * The network-text reader — the bridge reader (`volt-cli/src/Volt.Engine/Format/Network/NetworkTextReader.cs`, openspec
 * ld-fbd-coverage 2R.3, the grammar of `readability.md`) ported for the editor: the same tokens (`lexer.ts`), the same
 * LINES (P2), the same descent, raising the same `NETWORK_*` finding at the same token, so what the LSP underlines is what
 * the push refuses — held to it by the one case set both suites read (`volt-cli/test/fixtures/network-text`,
 * `network-cases.test.ts`).
 *
 * LINES, THEN ITEMS. A network's body is cut into lines by P2 (at bracket depth 0 a line break ends the line unless the
 * line ends with a word that cannot end it), and one `;` ends one NWL item. A line without `;` is OPEN: its root box's
 * ENO goes to a later line of the item, and each `ENO` takes the oldest open line not yet taken (B4, P3).
 *
 * THE SCOPE. The reader asks the declarations what the bridge reader asks them, mid-statement (`NetworkScopeView`): whether
 * a call head is an FB instance and of which FB, and whether a construct's word is taken by a POU. A caller that reads only
 * the networks' extent and headers passes `STRUCTURE_ONLY`.
 *
 * Unlike the bridge, a finding does not discard the network it is in: the statements read before it are kept, so hover,
 * rename and the type checks still see them. Recovery skips to the network's END_NETWORK, as the bridge's does.
 *
 * THE SPLIT. One reader, one concern per file, each building on the one before it: `cursor.ts` (tokens, lines,
 * positions, findings, the ST inside the text) → `values.ts` (a bracket level, an operand, the parallel, a box's role) →
 * `calls.ts` (a call and its pins) → `statements.ts` (one statement per line) → this file (the body, a network, its
 * header and its open lines).
 */
import type { BodySpan } from "../ast/nodes/index.js"
import type { Dialect } from "../lex/vocabulary.js"
import { graphicalMarkerLanguage } from "../format/bodies.js"
import { implementationLine } from "../format/implementation-line.js"
import type { NetworkLanguage, NetworkName, NetworkNestedSplit, NetworkSplit, NetworkSplitDef, NetworkTextBody, NetworkTextNetwork, NetworkTextStatement } from "./ast.js"
import { walkValues } from "./ast.js"

import { EMPTY_SCOPE, ParseError, type NetworkScopeView } from "./cursor.js"
import { decodeTitle, NetworkLexer, type Tok, isSym, isWord } from "./lexer.js"
import { StatementReader } from "./statements.js"
import { IDENTIFIER, SPLIT_PREFIX, UNSUPPORTED_SHAPE, v1Refusal } from "./words.js"

/**
 * What a caller passes that reads only the networks' extent and headers (folding, the outline, the corpus's structural
 * gate): it asks the declarations nothing. A value of its own, never an omitted argument (the bridge's
 * `NetworkScope.Empty`, "explicit, never a default").
 */
export const STRUCTURE_ONLY = "structure-only" as const

/** Read a graphical body into networks, statements and the bridge reader's findings. */
export function readNetworkText(body: BodySpan, scope: NetworkScopeView | typeof STRUCTURE_ONLY, dialect: Dialect): NetworkTextBody {
  return new Parser(body, scope === STRUCTURE_ONLY ? EMPTY_SCOPE : scope, dialect).parseBody()
}

class Parser extends StatementReader {
  private language: NetworkLanguage | undefined

  parseBody(): NetworkTextBody {
    const networks: NetworkTextNetwork[] = []
    const result = (): NetworkTextBody => ({
      kind: "network_body",
      ...(this.language !== undefined ? { language: this.language } : {}),
      networks,
      diagnostics: this.diagnostics,
      span: this.body.span,
    })

    // The body's language is the one its IMPLEMENTATION line STATES (`syntax/format/implementation-line`): the line is
    // not in the body's tokens, and the text below it is all network text.
    this.language = graphicalMarkerLanguage(this.body)
    if (this.language === undefined) {
      this.refuseUnstated()
      return result()
    }
    this.lx = new NetworkLexer(this.text, 0)
    const v1 = this.v1Constructs()
    if (v1.length > 0) {
      for (const { at, what } of v1) this.report(this.err(at, "NETWORK_PARSE", v1Refusal(what)))
      return result()
    }
    this.toks = this.lx.tokenize()
    this.end = this.toks.length
    for (;;) {
      try {
        const t = this.raw(this.p)
        if (t.kind === "eof") break
        if (isWord(t, "NETWORK") && t.atLineStart) {
          networks.push(this.parseNetwork(networks.length))
          continue
        }
        if (t.kind === "error") throw this.err(t, (t.code ?? "NETWORK_PARSE") as never, t.text)
        throw this.err(
          t,
          "NETWORK_PARSE",
          `'${t.text}' outside a network: a body is a sequence of NETWORK … END_NETWORK blocks, each NETWORK at a line start.`,
        )
      } catch (e) {
        if (!(e instanceof ParseError)) throw e
        this.report(e)
        this.recover()
      }
    }
    return result()
  }

  /** A body whose line states no network language: the bridge reader's messages (`NetworkTextReader.ParseBody`). */
  private refuseUnstated(): void {
    const opens = `${implementationLine("FBD")} or ${implementationLine("LD")}`
    const line = this.body.implementation
    const message =
      line === undefined
        ? `a graphical body opens with the line stating its language, ${opens}, on its first line.`
        : `the body states '${line.text}' — a network-text body opens with ${opens}.`
    this.report(new ParseError("NETWORK_PARSE", message, 0, 1))
  }

  /** The v1 constructs the bridge refuses before it parses (`NetworkText.V1Constructs`): `LET name :=`, and a number at a
   *  field position of a NETWORK header's line. */
  private v1Constructs(): { at: Tok; what: string }[] {
    const found: { at: Tok; what: string }[] = []
    const toks = new NetworkLexer(this.text, 0).tokenize().filter((t) => t.kind !== "comment" && t.kind !== "error")
    let headerLine = -1
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!
      const prev = toks[i - 1]
      const before = toks[i - 2]
      const third = toks[i - 3]
      if (isWord(t, "NETWORK") && t.atLineStart) headerLine = this.lx.lineOf(t.offset)
      else if (t.kind === "number" && headerLine >= 0 && this.lx.lineOf(t.offset) === headerLine &&
               !(prev !== undefined && (isSym(prev, ":") || isWord(prev, "LABEL") || isWord(prev, "TITLE"))))
        found.push({ at: t, what: "`NETWORK <n> <LANG>` headers" })
      else if (isSym(t, ":=") && prev?.kind === "word" && before !== undefined && isWord(before, "LET") &&
               !(third !== undefined && isWord(third, "JMP")) && this.lx.lineOf(before.offset) !== headerLine)
        found.push({ at: before, what: "`LET` statements" })
    }
    return found
  }

  /** After an error: skip to the end of the network it is in, so the next one is still read. */
  private recover(): void {
    this.end = this.toks.length
    for (;;) {
      const t = this.raw(this.p)
      if (t.kind === "eof" || (isWord(t, "NETWORK") && t.atLineStart)) return
      this.p++
      if (isWord(t, "END_NETWORK")) return
    }
  }

  // ── one network ─────────────────────────────────────────────────────────────────────────────

  private parseNetwork(index: number): NetworkTextNetwork {
    this.splits = new Map()
    this.splitRefs = new Map()
    this.splitRefAt = new Map()
    this.open = []
    this.end = this.toks.length
    const hdr = this.next()
    const statements: NetworkTextStatement[] = []
    const comment: string[] = []
    let header: { title?: string; label?: NetworkName; disabled: boolean } = { disabled: false }
    let headerEnd = hdr.offset + hdr.length
    let unsupported: NetworkName | undefined

    try {
      header = this.parseHeader(hdr)
      headerEnd = this.lastEnd()
      // P10: the network's comment — the `//` lines between the header and the body.
      while (this.raw(this.p).kind === "comment") comment.push(this.next().text)
      unsupported = this.parseItems(hdr, statements)
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.report(e)
      this.end = this.toks.length
      // An unclosed network already stands at the next NETWORK or the end; any other finding skips to END_NETWORK.
      if (e.code !== "NETWORK_NOT_CLOSED") this.recover()
    }
    this.end = this.toks.length

    return {
      index,
      ...(header.title !== undefined ? { title: header.title } : {}),
      ...(header.label !== undefined ? { label: header.label } : {}),
      disabled: header.disabled,
      ...(comment.length > 0 ? { comment: comment.join("\n") } : {}),
      splits: this.collectSplits(statements),
      ...(unsupported !== undefined ? { unsupported } : {}),
      statements,
      span: this.span(hdr.offset, Math.max(this.lastEnd(), hdr.offset + hdr.length)),
      headerSpan: this.span(hdr.offset, headerEnd),
    }
  }

  /** P10: `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]`, in that order, on the header's line. */
  private parseHeader(hdr: Tok): { title?: string; label?: NetworkName; disabled: boolean } {
    const hdrLine = this.line(hdr)
    let title: string | undefined
    let label: NetworkName | undefined
    let disabled = false
    let stage = 0
    const order = (t: Tok, at: number, what: string): void => {
      if (stage >= at)
        throw this.err(
          t,
          "NETWORK_PARSE",
          stage === at ? `a NETWORK header carries ${what} twice.` : 'the NETWORK header is NETWORK [LABEL: x] [DISABLED] [TITLE: "…"], in that order (P10).',
        )
      stage = at
    }
    for (let t = this.raw(this.p); t.kind !== "eof" && this.line(t) === hdrLine; t = this.raw(this.p)) {
      if (t.kind === "error") throw this.err(t, (t.code ?? "NETWORK_PARSE") as never, t.text)
      if (isWord(t, "LABEL")) {
        order(t, 1, "LABEL")
        this.p++
        this.expectOnLine(":", hdrLine, "LABEL: name")
        const name = this.next()
        if (this.line(name) !== hdrLine || name.kind !== "word" || !IDENTIFIER.test(name.text))
          throw this.err(name, "NETWORK_PARSE", "a LABEL is one identifier, on the header's line.")
        label = this.name(name)
      } else if (isWord(t, "DISABLED")) {
        order(t, 2, "DISABLED")
        this.p++
        disabled = true
      } else if (isWord(t, "TITLE")) {
        order(t, 3, "TITLE")
        this.p++
        this.expectOnLine(":", hdrLine, 'TITLE: "…"')
        const s = this.next()
        if (this.line(s) !== hdrLine || s.kind !== "dstring") throw this.err(s, "NETWORK_PARSE", "a TITLE is a double-quoted string, on the header's line.")
        const decoded = decodeTitle(s.text)
        if ("error" in decoded) throw this.err(s, "NETWORK_PARSE", decoded.error)
        if (decoded.value.length === 0) throw this.err(s, "NETWORK_PARSE", '`TITLE: ""`: a network with no title has no TITLE (P10).')
        title = decoded.value
      } else
        throw this.err(
          t,
          "NETWORK_PARSE",
          `'${t.text}' in a NETWORK header: the header is NETWORK [LABEL: x] [DISABLED] [TITLE: "…"], and it ends at its newline.`,
        )
    }
    return { ...(title !== undefined ? { title } : {}), ...(label !== undefined ? { label } : {}), disabled }
  }

  /** The network's lines up to END_NETWORK: one statement per item, the open lines taken by the ENOs below them (P3). */
  private parseItems(hdr: Tok, statements: NetworkTextStatement[]): NetworkName | undefined {
    let unsupported: NetworkName | undefined
    for (;;) {
      const t = this.raw(this.p)
      if (isWord(t, "END_NETWORK") || t.kind === "eof" || (isWord(t, "NETWORK") && t.atLineStart)) {
        if (this.open.length > 0)
          throw this.err(
            this.open[0]!.at,
            "NETWORK_BAD_EXPRESSION",
            "an open line nothing takes: a line without `;` hands its box's ENO to a later line of its item, which reads it as ENO (B4, P3) — end it with `;`.",
          )
        if (!isWord(t, "END_NETWORK")) throw this.err(hdr, "NETWORK_NOT_CLOSED", "this NETWORK has no END_NETWORK.")
        this.p++
        for (const [id, at] of this.splitRefAt)
          if (!this.splits.has(id))
            throw this.err(
              at,
              "NETWORK_BAD_EXPRESSION",
              `the split ${at.text} is never defined: a split is defined once in its network, \`${at.text} := value;\` (P9).`,
            )
        return unsupported
      }
      if (t.kind === "comment")
        throw this.err(
          t,
          "NETWORK_PARSE",
          "a // comment after a statement: the network's one comment is the // lines between its header and its first statement, and NWL has no per-item comment to move this one to.",
        )
      if (isWord(t, "UNSUPPORTED")) {
        unsupported = this.unsupportedLine(t, statements.length > 0 || this.open.length > 0)
        continue
      }

      const { end, semi } = this.lineEnd(this.p)
      const lineStart = this.raw(this.p)
      this.end = end
      try {
        const read = this.parseLine(semi)
        if (semi) {
          // One `;` = one NWL item: every open line above it is taken by now (P3).
          if (this.open.length > 0)
            throw this.err(
              this.open[0]!.at,
              "NETWORK_BAD_EXPRESSION",
              "an open line nothing takes: its item ended with `;` before an ENO read it — every line without `;` is read by exactly one ENO of its item (B4, P3).",
            )
          if ("statement" in read) statements.push(read.statement)
        } else {
          // P3: an open line's root is a box with an ENO — refused for any other root.
          if (!("open" in read))
            throw this.err(
              lineStart,
              "NETWORK_BAD_EXPRESSION",
              "a line without `;` whose root is no box with an ENO (a coil, a split, a jump, a leaf, a parallel): end it with `;` (B4, P3).",
            )
          this.open.push({ box: read.open, at: lineStart })
        }
      } finally {
        this.end = this.toks.length
      }
      this.p = end
    }
  }

  /** `UNSUPPORTED "<shape>";` (1b.4): the network's trees the text has no spelling for, shown — its only line. */
  private unsupportedLine(kw: Tok, content: boolean): NetworkName {
    this.p++
    if (content)
      throw this.err(
        kw,
        "NETWORK_UNSUPPORTED",
        "an UNSUPPORTED line beside other statements: it stands for the whole network's content, which Volt cannot show, and is its network's only line.",
      )
    const shape = this.next()
    const inner = shape.kind === "dstring" ? shape.text.slice(1, -1) : ""
    if (shape.kind !== "dstring" || !UNSUPPORTED_SHAPE.test(inner))
      throw this.err(shape, "NETWORK_PARSE", 'an UNSUPPORTED line names the shape Volt cannot show, as a quoted phrase: UNSUPPORTED "a flag on a box input pin";')
    this.expectSym(";", 'UNSUPPORTED "<shape>";')
    const end = this.raw(this.p)
    if (!isWord(end, "END_NETWORK"))
      throw this.err(
        end,
        "NETWORK_UNSUPPORTED",
        "a statement after an UNSUPPORTED line: the line stands for the whole network's content, and is its network's only line.",
      )
    return { text: inner, span: this.span(shape.offset + 1, shape.offset + shape.length - 1) }
  }

  /** P2: where the line starting at `from` ends, and whether it ends with `;`. At bracket depth 0 a line break ends a
   *  line unless the line ends with a word that cannot end it; inside brackets line breaks are layout. An EXECUTE body and
   *  its END_EXECUTE belong to the EXECUTE's line. */
  private lineEnd(from: number): { end: number; semi: boolean } {
    let depth = 0
    for (let j = from; ; ) {
      const t = this.raw(j)
      if (t.kind === "eof") return { end: j, semi: false }
      if (j > from && depth === 0) {
        const prev = this.raw(j - 1)
        if (isWord(t, "END_NETWORK") || (isWord(t, "NETWORK") && t.atLineStart) || t.kind === "comment") return { end: j, semi: false }
        if (t.kind !== "snippet" && prev.kind !== "snippet" && this.line(t) > this.line(prev) &&
            !this.continuesLine(prev, j > 1 ? this.raw(j - 2) : undefined))
          return { end: j, semi: false }
      }
      if (isSym(t, "(")) depth++
      else if (isSym(t, ")")) depth = Math.max(0, depth - 1)
      j++
      if (isSym(t, ";") && depth === 0) return { end: j, semi: true }
    }
  }

  // ── splits ──────────────────────────────────────────────────────────────────────────────────

  /** The network's split points in text order — each statement's definition, then the definitions nested in it (2R.5). */
  private collectSplits(statements: readonly NetworkTextStatement[]): NetworkSplit[] {
    const out: NetworkSplit[] = []
    const add = (s: NetworkSplitDef | NetworkNestedSplit): void => {
      const varId = Number(s.split.text.slice(SPLIT_PREFIX.length))
      out.push({ name: s.split, varId, definition: s, references: this.splitRefs.get(varId) ?? [] })
    }
    for (const s of statements) {
      if (s.kind === "split_def") add(s)
      for (const v of walkValues(s)) if (v.kind === "nested_split") add(v)

    }
    return out
  }
}

