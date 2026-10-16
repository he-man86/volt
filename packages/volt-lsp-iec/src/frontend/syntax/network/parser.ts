/**
 * Network text v2 parser — the bridge reader (`volt-cli/src/Volt.Engine/Format/Network/NetworkTextReader.cs`) ported
 * for the editor: the same recursive descent over the same tokens (`lexer.ts`), raising the same `NETWORK_*` finding
 * at the same token, so what the LSP underlines is what the push refuses. Specified by
 * `volt-cli/docs/network-text.html` and openspec network-text-literal-nwl (task 5.1).
 *
 * THE SCOPE. The bridge reader consults the declarations (`NetworkScope`) in the middle of a statement, and its answers
 * decide how the text reads: a POU or instance named R_EDGE, F_EDGE or PARALLEL is refused before its argument list is
 * read as the construct's, and a head is an instance or a function by what the declarations say. Asked after the parse,
 * they gave the wrong finding at the wrong token (the argument list failed as the construct's first) and let the compiler
 * checks run over a statement the push refuses, so the parser takes the same questions (`NetworkScopeView`) from its
 * caller and raises them where the bridge does — an instance's FB TYPE included, since an instance of a POU named R_EDGE
 * is as unspellable as the POU. A bare wire-shaped name no VAR_TEMP declares is a variable, whether the scope declares it
 * or not (the build's question, bridge-refusal-review 1.3), and a wire named like a name in scope is the wire (2.10). A wire's declared type is held to its producer as the bridge reader holds it, from what the
 * text says (`checkWireTypes`). Canonical form is no finding: the push writes any spelling that reads (bridge-refusal-review
 * 2.12).
 *
 * Unlike the bridge, a finding does not discard the network it is in: the statements read before it are kept, so
 * hover, rename and the type checks still see them. Recovery skips to the network's END_NETWORK, as the bridge's does.
 *
 * THE SPLIT (openspec ld-fbd-coverage 2.1). One reader, one concern per file, each building on the one before it:
 * `cursor.ts` (tokens, positions, findings, the ST inside the text) → `values.ts` (operands, groups, NOT, edges) →
 * `calls.ts` (a call and its pins, PARALLEL, EXECUTE) → `statements.ts` (one statement per NWL item) → this file (the
 * body, a network, its header and its wires). What a position holds — an argument list or a group, an empty slot, a
 * pin's name, a storage operator — is `pair-kind.ts`'s; a wire's producer type is `wire-producer.ts`'s.
 */
import type { Span } from "../span.js"
import type { BodySpan } from "../ast/nodes/index.js"
import type { Dialect } from "../lex/vocabulary.js"
import { graphicalMarkerLanguage } from "../format/bodies.js"
import { implementationLine } from "../format/implementation-line.js"
import { parseTypeExprFromTokens } from "../parse/type-expr.js"
import type { NetworkLanguage, NetworkName, NetworkTextBody, NetworkTextNetwork, NetworkTextStatement, NetworkWire } from "./ast.js"
import { IDENTIFIER, ParseError, type NetworkScopeView, type NetworkWireTyping } from "./cursor.js"
import { NetworkLexer, type Tok, isSym, isWord } from "./lexer.js"
import { stored, UNSUPPORTED_NOT_ALONE, unsupportedLineRefusal } from "./shown.js"
import { StatementReader } from "./statements.js"
import { disagreement, producerType } from "./wire-producer.js"
import { v1Refusal } from "./words.js"

const WIRE_NAME = /^[gG][0-9]+$/
const MAX_VAR_ID = 2147483647

/**
 * What a caller passes that reads only the networks' extent and headers (folding, the outline, the corpus's structural
 * gate): it asks the declarations nothing, so the three scope findings are not raised and a call of a POU named like a
 * construct reads as the construct — harmless there, since every finding recovers to its network's END_NETWORK. A
 * value of its own, never an omitted argument: a reader of the STATEMENTS that forgot the POU's scope would lose those
 * findings without a trace (the bridge's `NetworkScope.Empty`, "explicit, never a default").
 */
export const STRUCTURE_ONLY = "structure-only" as const

/** Read a graphical body into networks, statements and the bridge reader's structural findings, typing its wires by
 *  `typing`. Everything that reads the statements passes the POU's scope (`types/network/network-analyze`). */
export function readNetworkText(
  body: BodySpan,
  scope: NetworkScopeView | typeof STRUCTURE_ONLY,
  dialect: Dialect,
  typing: NetworkWireTyping,
): NetworkTextBody {
  return new Parser(body, scope === STRUCTURE_ONLY ? undefined : scope, dialect, typing).parseBody()
}

class Parser extends StatementReader {
  // ── the body ────────────────────────────────────────────────────────────────────────────────

  parseBody(): NetworkTextBody {
    const networks: NetworkTextNetwork[] = []
    const result = (language?: NetworkLanguage): NetworkTextBody => ({
      kind: "network_body",
      language,
      networks,
      diagnostics: this.diagnostics,
      span: this.body.span,
    })

    // The body's language is the one its IMPLEMENTATION line STATES (`syntax/format/implementation-line`), and this parser
    // reads only LD and FBD — the classifier `isGraphicalBody` asks the same question, so a body this parser reads no
    // network of is never one the ST checks were told to skip. The line is not in the body's tokens: the text below is
    // all network text.
    const language = graphicalMarkerLanguage(this.body)
    if (language === undefined) {
      this.refuseUnstated()
      return result()
    }
    this.language = language
    this.lx = new NetworkLexer(this.text, 0)
    for (;;) {
      const t = this.peekSafe()
      if (t === undefined) continue // a lexical error, reported; the lexer moved past it
      if (t.kind === "eof") break
      if (isWord(t, "NETWORK") && t.atLineStart) {
        networks.push(this.parseNetwork(networks.length))
        continue
      }
      this.next()
      this.report(
        isWord(t, "LET")
          ? new ParseError("NETWORK_PARSE", v1Refusal("`LET` statements"), t.offset, t.length)
          : new ParseError(
              "NETWORK_PARSE",
              `'${t.text}' outside a network: a body is a sequence of NETWORK … END_NETWORK blocks, each NETWORK at a line start.`,
              t.offset,
              t.length,
            ),
      )
      this.recover()
    }
    return result(language)
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
    for (;;) {
      const t = this.peekSafe()
      if (t === undefined) continue
      if (t.kind === "eof" || (isWord(t, "NETWORK") && t.atLineStart)) return
      this.next()
      if (isWord(t, "END_NETWORK")) return
    }
  }

  // ── one network ─────────────────────────────────────────────────────────────────────────────

  private parseNetwork(index: number): NetworkTextNetwork {
    this.wires = new Map()
    this.readAsVariable = new Map()
    const hdr = this.next()
    let title: string | undefined
    let label: NetworkName | undefined
    let disabled = false
    const wires: NetworkWire[] = []
    const statements: NetworkTextStatement[] = []
    const comment: string[] = []
    let headerEnd = hdr.offset + hdr.length
    let unsupported: NetworkName | undefined

    try {
      ;({ title, label, disabled, headerEnd } = this.parseHeader(hdr))

      // The network's comment: the `//` lines between the header and the wire block or first statement.
      while (this.peek().kind === "comment") comment.push(this.next().text)

      for (;;) {
        const t = this.peek()
        if (isWord(t, "END_NETWORK")) {
          this.next()
          break
        }
        if (t.kind === "eof" || (isWord(t, "NETWORK") && t.atLineStart))
          throw this.err(hdr, "NETWORK_NOT_CLOSED", "this NETWORK has no END_NETWORK.")
        if (t.kind === "comment")
          throw this.err(
            t,
            "NETWORK_PARSE",
            "a // comment after a statement: the network's one comment is the // lines between its header and its wire block or first statement, and NWL has no per-item comment to move this one to.",
          )
        // A VAR_TEMP block is read wherever it stands, and a second one adds to the first (bridge-refusal-review 2.7):
        // the model is the same, and the writer puts the one canonical block before the first statement on the next
        // pull. Text order still rules — a wire is a wire from its declaration on.
        if (isWord(t, "VAR_TEMP")) {
          this.parseWires(wires)
          continue
        }
        // `UNSUPPORTED "<shape>";` (ld-fbd-coverage 1b.4): the network's trees the text cannot spell, shown — its only line.
        if (isWord(t, "UNSUPPORTED")) {
          unsupported = this.unsupportedLine(statements.length > 0 || wires.length > 0)
          continue
        }
        statements.push(this.parseStatement())
      }

      // A wire declared and never defined carries no Demux: the model is complete without it and the writer drops its
      // declaration (2.8). A REFERENCE to one is refused where it stands (`resolve`): it has no producer.
      this.checkWireTypes(wires)
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.report(e)
      // An unclosed network already stands at the next NETWORK or the end; any other finding skips to END_NETWORK.
      if (e.code !== "NETWORK_NOT_CLOSED") this.recover()
    }

    return {
      index,
      title: stored(title),
      label,
      disabled,
      comment: stored(comment.length > 0 ? comment.join("\n") : undefined),
      wires,
      ...(unsupported !== undefined ? { unsupported } : {}),
      statements,
      span: this.span(hdr.offset, Math.max(this.lastEnd, hdr.offset + hdr.length)),
      headerSpan: this.span(hdr.offset, headerEnd),
    }
  }

  /** The header's fields, in any order: a misordered header is written, and the canonical order comes back (2.12). */
  private parseHeader(hdr: Tok): { title?: string; label?: NetworkName; disabled: boolean; headerEnd: number } {
    const hdrLine = this.line(hdr)
    let title: string | undefined
    let label: NetworkName | undefined
    let disabled = false
    let headerEnd = hdr.offset + hdr.length
    // The header ends at its newline: a line after it that starts DISABLED, TITLE or LABEL is a statement.
    for (let t = this.peek(); t.kind !== "eof" && this.line(t) === hdrLine; t = this.peek()) {
      if (isWord(t, "LABEL")) {
        this.next()
        if (label !== undefined) throw this.err(t, "NETWORK_PARSE", "a NETWORK header carries LABEL twice.")
        this.expectOnLine(":", hdrLine, "LABEL: name")
        const name = this.next()
        if (this.line(name) !== hdrLine || name.kind !== "word" || !IDENTIFIER.test(name.text))
          throw this.err(name, "NETWORK_PARSE", "a LABEL is one identifier, on the header's line.")
        label = this.name(name)
      } else if (isWord(t, "TITLE")) {
        this.next()
        if (title !== undefined) throw this.err(t, "NETWORK_PARSE", "a NETWORK header carries TITLE twice.")
        this.expectOnLine(":", hdrLine, 'TITLE: "…"')
        const s = this.next()
        if (this.line(s) !== hdrLine || s.kind !== "string")
          throw this.err(s, "NETWORK_PARSE", "a TITLE is a double-quoted string, on the header's line.")
        title = s.text
      } else if (isWord(t, "DISABLED")) {
        this.next()
        if (disabled) throw this.err(t, "NETWORK_PARSE", "a NETWORK header carries DISABLED twice.")
        disabled = true
      } else if (t.kind === "number") {
        throw this.err(t, "NETWORK_PARSE", v1Refusal("`NETWORK <n> <LANG>` headers"))
      } else {
        throw this.err(
          t,
          "NETWORK_PARSE",
          `'${t.text}' in a NETWORK header: the header is NETWORK [LABEL: x] [TITLE: "…"] [DISABLED], and it ends at its newline.`,
        )
      }
      headerEnd = this.lastEnd
    }
    return { ...(title !== undefined ? { title } : {}), ...(label !== undefined ? { label } : {}), disabled, headerEnd }
  }

  /** `UNSUPPORTED "<shape>";`, its network's only line (`shown.ts`), after `UNSUPPORTED`; `content`: the network holds
   *  something before it. */
  private unsupportedLine(content: boolean): NetworkName {
    const kw = this.next()
    const shape = this.next()
    const bad = unsupportedLineRefusal(kw, shape, content)
    if (bad !== undefined) throw this.err(bad.at, bad.code, bad.message)
    this.expectSym(";", 'UNSUPPORTED "<shape>";')
    const end = this.peek()
    if (!isWord(end, "END_NETWORK")) throw this.err(end, "NETWORK_UNSUPPORTED", UNSUPPORTED_NOT_ALONE)
    return { text: shape.text, span: this.tokSpan(shape) }
  }

  /** `VAR_TEMP g1, g2 : BOOL; … END_VAR` — on one line canonically, across lines as ST allows. */
  private parseWires(out: NetworkWire[]): void {
    const kw = this.next()
    while (!isWord(this.peek(), "END_VAR")) {
      if (this.peek().kind === "eof") throw this.err(kw, "NETWORK_PARSE", "a VAR_TEMP block with no END_VAR.")
      const names = [this.wireNameTok()]
      while (isSym(this.peek(), ",")) {
        this.next()
        names.push(this.wireNameTok())
      }
      this.expectSym(":", "a wire declaration is `g1 : BOOL;`")
      if (isSym(this.peek(), ";")) throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "a wire declaration with no type.")
      const from = this.peek().offset
      let to = from
      while (!isSym(this.peek(), ";")) {
        const t = this.next()
        if (t.kind === "eof" || isWord(t, "END_VAR")) throw this.err(t, "NETWORK_PARSE", "a wire declaration ends with `;`.")
        to = t.offset + t.length
      }
      this.next()
      const typeText = this.text.slice(from, to).replace(/\s+/g, " ").trim()
      const typeToks = this.stTokens(from, to)
      const type = parseTypeExprFromTokens(typeToks, this.dialect)
      const declSpan = this.span(names[0]!.offset, this.lastEnd)
      for (const n of names) this.declare(n, typeText, type, declSpan, out)
    }
    // END_VAR — it takes no `;` of its own: a `;` after it is the empty item. An empty block declares nothing: layout,
    // read as no block (2.9).
    this.next()
  }

  private wireNameTok(): Tok {
    const t = this.next()
    if (t.kind !== "word" || !WIRE_NAME.test(t.text))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `the wire '${t.text}' is not named g<digits>: a wire's name carries the vendor's VarId, and the declaration alone makes it a wire.`,
      )
    return t
  }

  private declare(name: Tok, typeText: string, type: NetworkWire["type"], span: Span, out: NetworkWire[]): void {
    // The VarId is the vendor's Int32: the bridge parses it as one and refuses a wire whose digits do not fit.
    const id = Number(name.text.slice(1))
    if (id > MAX_VAR_ID) throw this.err(name, "NETWORK_BAD_EXPRESSION", `the wire ${name.text} carries a VarId out of range.`)
    const key = name.text.toUpperCase()
    if (this.wires.has(key)) throw this.err(name, "NETWORK_DUPLICATE_NAME", `the wire ${name.text} is declared twice.`)
    for (const w of this.wires.values())
      if (Number(w.wire.name.text.slice(1)) === id)
        throw this.err(name, "NETWORK_DUPLICATE_NAME", `the wires ${w.wire.name.text} and ${name.text} carry the same VarId ${id}.`)
    // A wire spelled like a variable in scope is no conflict (2.10): wires are VarIds in the IDE, and in the text the
    // network's own wires resolve first. But a LATE block (2.7) may not take a name this network already read as a
    // variable: text order would make the one spelling two things, the variable before the block and the wire after it.
    const used = this.readAsVariable.get(key)
    if (used !== undefined)
      throw this.err(
        name,
        "NETWORK_DUPLICATE_NAME",
        `the wire ${name.text} is declared after line ${this.bridgeLine(used)} read ${used.text} as a variable: one name ` +
          "would mean the variable before this block and the wire after it. Declare the wire before its first use, or give it another name.",
      )
    const wire: NetworkWire = { name: this.name(name), typeText, ...(type !== undefined ? { type } : {}), span }
    this.wires.set(key, { wire, defined: false })
    out.push(wire)
  }

  /**
   * Spec, "a hand-edited type": each wire's declared type against what its producer says — the bridge reader's
   * `CheckWireTypes`, by the writer's rule (`NetworkSpelling.ProducerType`), because the vendor's Demux has no field
   * that would keep a type the producer contradicts. Run once the network is read. A leaf says its own type (TRUE/FALSE
   * BOOL, otherwise the type the reader puts on it), LD's empty terminator BOOL, a box the output type its pragma
   * spells (ld-fbd-coverage 2.3), else BOOL (an EXECUTE, `.ENO`, a comparison), "BOOL or another bit string" (a bit
   * operator) or nothing — exactly what the reader has to go on.
   *
   * A refused declaration types nothing downstream (`NetworkWire.typeRefused`): the push never lets the body reach a
   * build, so a compiler message at the wire's CONSUMER would be one no build gives, and it would steer the engineer
   * to "fix" the consumer instead of the declaration. Only a declaration the producer names EXACTLY is the type the
   * build gives the uses (`NetworkWire.typeConfirmed`): where the rule says less, the push takes the declaration as
   * written and the vendor, whose Demux holds no type, compiles the consumer against the producer.
   */
  private checkWireTypes(wires: readonly NetworkWire[]): void {
    for (const wire of wires) {
      if (wire.definition === undefined) continue
      const produced = producerType(wire.definition.value, wires, this.language, this.typing)
      const says = disagreement(produced, wire.typeText, this.typing)
      if (says === undefined) {
        if (produced.exact !== undefined) wire.typeConfirmed = true
        continue
      }
      wire.typeRefused = true
      this.diag("NETWORK_BAD_EXPRESSION", `the wire ${wire.name.text} is declared ${wire.typeText} and its producer is ${says}.`, wire.name.span)
    }
  }
}
