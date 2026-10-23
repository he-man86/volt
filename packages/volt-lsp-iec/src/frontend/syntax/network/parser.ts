/**
 * The network-text reader — the bridge reader (`volt-cli/src/Volt.Engine/Format/Network/NetworkTextReader.cs`, openspec
 * ld-fbd-coverage 2R.6b, `v2-spec.md`) ported for the editor: RECURSIVE DESCENT over the same tokens (`lexer.ts`), each
 * node built once where it is read, whether something consumes it passed down from its parent, raising the same
 * `NETWORK_*` finding at the same token — so what the LSP underlines is what the push refuses, held to it by the one case
 * set both suites read (`volt-cli/test/fixtures/network-text`, `network-cases.test.ts`). The checks over the tree no
 * spelling decides are the shared validator's (`validator.ts`).
 *
 * THE SPLIT. One reader, one concern per file, each building on the one before it: `cursor.ts` (tokens, the indentation
 * check, positions, findings, the ST inside the text) → `tokens.ts` (modifiers, targets, the old spellings) → `boxes.ts`
 * (a box, its pin state, its connection; the parallel) → `values.ts` (an item's coils, a slot, an operand, a bracket) →
 * this file (the body, a network, its header and its items).
 *
 * THE SCOPE. The reader asks the declarations what the bridge reader asks them: whether a call head is an FB instance and
 * of which FB. A caller that reads only the networks' extent and headers passes `STRUCTURE_ONLY`.
 *
 * Unlike the bridge, a finding does not discard the network it is in: the items read before it are kept, so hover, rename
 * and the type checks still see them. Recovery skips to the network's END_NETWORK, as the bridge's does.
 */
import type { BodySpan } from "../ast/nodes/index.js"
import type { Dialect } from "../lex/vocabulary.js"
import { graphicalMarkerLanguage } from "../format/bodies.js"
import { implementationLine } from "../format/implementation-line.js"
import type { NetworkLanguage, NetworkName, NetworkSplit, NetworkTextBody, NetworkTextNetwork, NetworkTextStatement } from "./ast.js"
import { walkValues } from "./ast.js"
import { EMPTY_SCOPE, ParseError, type NetworkScopeView } from "./cursor.js"
import { decodeTitle, NetworkLexer, type Tok, isSym, isWord } from "./lexer.js"
import { type NetworkFinding, validateNetwork } from "./validator.js"
import { ValueReader } from "./values.js"
import { IDENTIFIER, SPLIT_PREFIX, UNSUPPORTED_HASH, UNSUPPORTED_SHAPE } from "./words.js"

/**
 * What a caller passes that reads only the networks' extent and headers (folding, the outline, the corpus's structural
 * gate): it asks the declarations nothing. A value of its own, never an omitted argument (the bridge's
 * `NetworkScope.Empty`, "explicit, never a default").
 */
export const STRUCTURE_ONLY = "structure-only" as const

/** Read a graphical body into networks, items and the bridge reader's findings. */
export function readNetworkText(body: BodySpan, scope: NetworkScopeView | typeof STRUCTURE_ONLY, dialect: Dialect): NetworkTextBody {
  return new Parser(body, scope === STRUCTURE_ONLY ? EMPTY_SCOPE : scope, dialect).parseBody()
}

class Parser extends ValueReader {
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

    // The body's language is the one its IMPLEMENTATION line STATES: the line is not in the body's tokens, and the text
    // below it is all network text.
    this.language = graphicalMarkerLanguage(this.body)
    if (this.language === undefined) {
      this.refuseUnstated()
      return result()
    }
    this.lx = new NetworkLexer(this.text, 0)
    this.toks = this.lx.tokenize()
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

  /** After an error: skip to the end of the network it is in, so the next one is still read. */
  private recover(): void {
    this.itemStart = -1
    for (;;) {
      const t = this.raw(this.p)
      if (t.kind === "eof" || (isWord(t, "NETWORK") && t.atLineStart)) return
      this.p++
      if (isWord(t, "END_NETWORK")) return
    }
  }

  // ── one network ─────────────────────────────────────────────────────────────────────────────

  private parseNetwork(index: number): NetworkTextNetwork {
    this.itemStart = -1
    const hdr = this.next()
    const statements: NetworkTextStatement[] = []
    const comment: string[] = []
    let header: { title?: string; label?: NetworkName; disabled: boolean } = { disabled: false }
    let headerEnd = hdr.offset + hdr.length
    let unsupported: { shape: NetworkName; hash: string } | undefined
    let closed = false

    try {
      header = this.parseHeader(hdr)
      headerEnd = this.lastEnd()
      // The network's comment: the `//` lines between the header and the first item.
      while (this.raw(this.p).kind === "comment") comment.push(this.next().text)
      if (this.raw(this.p).kind === "error") throw this.err(this.raw(this.p), (this.raw(this.p).code ?? "NETWORK_PARSE") as never, this.raw(this.p).text)
      unsupported = this.parseItems(hdr, statements)
      closed = true
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.report(e)
      this.itemStart = -1
      // An unclosed network already stands at the next NETWORK or the end; any other finding skips to END_NETWORK.
      if (e.code !== "NETWORK_NOT_CLOSED") this.recover()
    }

    const network: NetworkTextNetwork = {
      index,
      ...(header.title !== undefined ? { title: header.title } : {}),
      ...(header.label !== undefined ? { label: header.label } : {}),
      disabled: header.disabled,
      ...(comment.length > 0 ? { comment: comment.join("\n") } : {}),
      splits: collectSplits(statements),
      ...(unsupported !== undefined ? { unsupported: unsupported.shape, unsupportedHash: unsupported.hash } : {}),
      statements,
      span: this.span(hdr.offset, Math.max(this.lastEnd(), hdr.offset + hdr.length)),
      headerSpan: this.span(hdr.offset, headerEnd),
    }
    // The checks over the tree no spelling decides — reported at the node they name, once the network reads whole.
    if (closed) {
      const finding: NetworkFinding | undefined = validateNetwork(network)
      if (finding !== undefined) this.diag(finding.code, `${finding.reason}: ${finding.detail}`, finding.span ?? network.headerSpan)
    }
    return network
  }

  /** `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]`, in that order, on the header's line. */
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
          stage === at ? `a NETWORK header carries ${what} twice.` : 'the NETWORK header is NETWORK [LABEL: x] [DISABLED] [TITLE: "…"], in that order.',
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
        if (decoded.value.length === 0) throw this.err(s, "NETWORK_PARSE", '`TITLE: ""`: a network with no title has no TITLE.')
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

  /** The network's items up to END_NETWORK — or its one UNSUPPORTED line. */
  private parseItems(hdr: Tok, statements: NetworkTextStatement[]): { shape: NetworkName; hash: string } | undefined {
    let unsupported: { shape: NetworkName; hash: string } | undefined
    for (;;) {
      this.itemStart = -1
      const t = this.raw(this.p)
      if (isWord(t, "END_NETWORK") || t.kind === "eof" || (isWord(t, "NETWORK") && t.atLineStart)) {
        if (!isWord(t, "END_NETWORK")) throw this.err(hdr, "NETWORK_NOT_CLOSED", "this NETWORK has no END_NETWORK.")
        this.p++
        return unsupported
      }
      if (t.kind === "comment")
        throw this.err(
          t,
          "NETWORK_PARSE",
          "a // comment after an item: the network's one comment is the // lines between its header and its first item, and NWL has no per-item comment to move this one to.",
        )
      if (isWord(t, "UNSUPPORTED")) {
        unsupported = this.unsupportedLine(t, statements.length > 0)
        continue
      }
      statements.push(this.parseItem())
    }
  }

  /** `UNSUPPORTED "<shape>" #<hash>;`: the network's trees the text has no spelling for, shown — its only line. */
  private unsupportedLine(kw: Tok, content: boolean): { shape: NetworkName; hash: string } {
    this.p++
    if (content)
      throw this.err(
        kw,
        "NETWORK_UNSUPPORTED",
        "an UNSUPPORTED line beside other items: it stands for the whole network's content, and is its network's only line.",
      )
    const shape = this.next()
    const inner = shape.kind === "dstring" ? shape.text.slice(1, -1) : ""
    if (shape.kind !== "dstring" || !UNSUPPORTED_SHAPE.test(inner))
      throw this.err(
        shape,
        "NETWORK_PARSE",
        'an UNSUPPORTED line names the shape Volt cannot show, as a quoted phrase, and its hash: UNSUPPORTED "a flag on a box input pin" #3f9a01c2;',
      )
    const h = this.next()
    if (h.kind !== "hash" || !UNSUPPORTED_HASH.test(h.text))
      throw this.err(
        h,
        "NETWORK_PARSE",
        'an UNSUPPORTED line ends with the network\'s hash, `#` and 8 lower-case hex digits: UNSUPPORTED "<shape>" #3f9a01c2;',
      )
    this.expectSym(";", 'UNSUPPORTED "<shape>" #<hash>;')
    const end = this.raw(this.p)
    if (!isWord(end, "END_NETWORK"))
      throw this.err(
        end,
        "NETWORK_UNSUPPORTED",
        "an item after an UNSUPPORTED line: the line stands for the whole network's content, and is its network's only line.",
      )
    return { shape: { text: inner, span: this.span(shape.offset + 1, shape.offset + shape.length - 1) }, hash: h.text }
  }
}

/** The network's split points in text order — each item's definition, then the definitions nested in it — and every
 *  reference to each. */
function collectSplits(statements: readonly NetworkTextStatement[]): NetworkSplit[] {
  const out: NetworkSplit[] = []
  const refs = new Map<number, NetworkName[]>()
  const id = (name: NetworkName): number => Number(name.text.slice(SPLIT_PREFIX.length))
  for (const s of statements) {
    if (s.kind === "split_def") out.push({ name: s.split, varId: id(s.split), definition: s, references: [] })
    for (const v of walkValues(s)) {
      if (v.kind === "nested_split") out.push({ name: v.split, varId: id(v.split), definition: v, references: [] })
      if (v.kind === "split_ref") refs.set(id(v.name), [...(refs.get(id(v.name)) ?? []), v.name])
    }
  }
  for (const s of out) s.references = refs.get(s.varId) ?? []
  return out
}
