/**
 * Network text v2 parser — the bridge reader (`volt-cli/src/Volt.Engine/Format/Network/NetworkTextReader.cs`) ported
 * for the editor: the same recursive descent over the same tokens (`lexer.ts`), raising the same `NETWORK_*` finding
 * at the same token, so what the LSP underlines is what the push refuses. Specified by
 * `volt-cli/docs/network-text.html` and openspec network-text-literal-nwl (task 5.1).
 *
 * THE SCOPE. The bridge reader consults the declarations (`NetworkScope`) in the middle of a statement, and three of
 * its answers decide how the text reads: a POU or instance named R_EDGE, F_EDGE or PARALLEL is refused before its
 * argument list is read as the construct's; a bare wire-shaped name no scope declares is refused as a wire someone
 * forgot; a wire named like a name in scope is refused at its declaration. Asked after the parse, they gave the wrong
 * finding at the wrong token (the argument list failed as the construct's first) and let the compiler checks run over
 * a statement the push refuses, so the parser takes the same questions (`NetworkScopeView`) from its caller and raises
 * them where the bridge does — an instance's FB TYPE included, since an instance of a POU named R_EDGE is as
 * unspellable as the POU. A wire's declared type is held to its producer as the bridge reader holds it, from what the
 * text says (`checkWireTypes`); NETWORK_NOT_CANONICAL stays the gate's alone (it needs the writer).
 *
 * Unlike the bridge, a finding does not discard the network it is in: the statements read before it are kept, so
 * hover, rename and the type checks still see them. Recovery skips to the network's END_NETWORK, as the bridge's does.
 */
import {
  type BodySpan,
  type Dialect,
  type Expr,
  graphicalMarkerLanguage,
  implementationLine,
  type Span,
  type StatementList,
  type Token,
  isTrivia,
  lex,
  parseExprFromTokens,
  parseStatements,
  parseTypeExprFromTokens,
} from "../frontend/syntax/index.js"
import type {
  NetworkAssign,
  NetworkCall,
  NetworkDiagnosticCode,
  NetworkExecute,
  NetworkLanguage,
  NetworkName,
  NetworkParallel,
  NetworkPin,
  NetworkTarget,
  NetworkTextBody,
  NetworkTextDiagnostic,
  NetworkTextNetwork,
  NetworkTextStatement,
  NetworkValue,
  NetworkWire,
} from "./ast.js"
import { NetworkLexer, OPERATOR_HEADS, SYMBOL_TO_TYPE, type Tok, isOperator, isSym, isWord } from "./lexer.js"
import { BIT_OPERATOR_FUNCTIONS, COMPARISON_FUNCTIONS } from "../frontend/types/index.js"

/**
 * Words the text's own grammar gives a meaning at operand position (`NetworkSpelling.TextWords`); an operand spelled
 * like one is backticked. Exported so the editor colours them: they are syntax of the network sublanguage, and the ST
 * lexer hands most of them back as plain identifiers.
 */
export const NETWORK_TEXT_WORDS: ReadonlySet<string> = new Set([
  "NOT",
  "AND",
  "OR",
  "XOR",
  "MOD",
  "R_EDGE",
  "F_EDGE",
  "PARALLEL",
  "EXECUTE",
  "END_EXECUTE",
  "IF",
  "THEN",
  "END_IF",
  "JMP",
  "RETURN",
  "NETWORK",
  "END_NETWORK",
  "VAR_TEMP",
  "END_VAR",
  "LET",
])

/** The words the editor colours as keywords inside a graphical body: the grammar's words, the header's fields, and the
 *  suffix and pin words that only the network text gives a meaning. `LET` is not among them — it is refused. */
export const NETWORK_TEXT_KEYWORDS: ReadonlySet<string> = new Set([
  ...[...NETWORK_TEXT_WORDS].filter((w) => w !== "LET"),
  "LABEL",
  "TITLE",
  "DISABLED",
  "ENO",
  "MODE",
])

/** The names a POU or FB instance may not carry, because the text spells a construct with them. */
export const CONSTRUCT_WORDS: ReadonlySet<string> = new Set(["R_EDGE", "F_EDGE", "PARALLEL"])

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/
const WIRE_NAME = /^[gG][0-9]+$/
const MAX_VAR_ID = 2147483647
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g
const MEASURED_MODES = new Set(["BoxShortCircuit", "Sequential"])
const STRUCTURAL = new Set([",", ")", "(", ";", ":=", "=>", ".", ":"])

const isName = (t: string): boolean => IDENTIFIER.test(t) || PATH.test(t)

/** The bridge's v1 refusal, one sentence for every place that meets v1 text (`NetworkText.V1Refusal`). */
export function v1Refusal(what: string): string {
  return `this is network text v1 (${what}), which Volt no longer reads and does not translate: re-pull the POU to get the current form, and redo the edit on it.`
}

class ParseError {
  constructor(
    readonly code: NetworkDiagnosticCode,
    readonly message: string,
    readonly offset: number,
    readonly length: number,
  ) {}
}

/** A value as parsed, before it is known what it is for: a bare token stays unresolved, because the same token is a
 *  target when `:=` follows it and an operand otherwise. */
interface PVal {
  node?: NetworkValue
  bare?: Tok
  start: Tok
}

interface Wire {
  wire: NetworkWire
  defined: boolean
}

/** The questions the bridge reader asks of the declarations mid-statement (`NetworkScope`), case-insensitively. */
export interface NetworkScopeView {
  /** A name some declaration in scope makes — a variable, a global, a POU (`NetworkScope.Contains`). */
  contains(name: string): boolean
  /** A POU a call can name (the bridge's `IsPou`). */
  isPou(name: string): boolean
  /** The FB type of `head` when it is an FB instance a declaration names — a variable, or a path to one — else
   *  undefined (`NetworkScope.InstanceType`). */
  instanceType(head: string): string | undefined
}

/**
 * What a caller passes that reads only the networks' extent and headers (folding, the outline, the corpus's structural
 * gate): it asks the declarations nothing, so the three scope findings are not raised and a call of a POU named like a
 * construct reads as the construct — harmless there, since every finding recovers to its network's END_NETWORK. A
 * value of its own, never an omitted argument: a reader of the STATEMENTS that forgot the POU's scope would lose those
 * findings without a trace (the bridge's `NetworkScope.Empty`, "explicit, never a default").
 */
export const STRUCTURE_ONLY = "structure-only" as const

/** Parse a graphical body into networks, statements and the bridge reader's structural findings. Everything that reads
 *  the statements passes the POU's scope (`network/network-analyze`). */
export function parseNetworkText(
  body: BodySpan,
  scope: NetworkScopeView | typeof STRUCTURE_ONLY,
  dialect: Dialect,
): NetworkTextBody {
  return new Parser(body, scope === STRUCTURE_ONLY ? undefined : scope, dialect).parseBody()
}

class Parser {
  private readonly text: string
  private readonly base: Span
  private readonly lineStarts: number[] = [0]
  private lx!: NetworkLexer
  private la: Tok | undefined
  private lastEnd = 0
  private readonly diagnostics: NetworkTextDiagnostic[] = []
  private wires = new Map<string, Wire>()
  private language!: NetworkLanguage

  constructor(
    private readonly body: BodySpan,
    private readonly scope: NetworkScopeView | undefined,
    /** The document's vocabulary, for the ST fragments in the text (`stTokens`) — the parse's own. */
    private readonly dialect: Dialect,
  ) {
    // The body's text is its tokens' text: the ST lexer emits every character, whitespace included.
    this.text = body.tokens.map((t) => t.text).join("")
    this.base = body.tokens[0]?.span ?? body.span
    for (let k = 0; k < this.text.length; k++) if (this.text[k] === "\n") this.lineStarts.push(k + 1)
  }

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
        : `the body states '${line.text}' — a network-text body opens with ${opens}` +
          (line.statement.kind === "no-language" ? "; this line states no language." : ".")
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
    const hdr = this.next()
    const hdrLine = this.line(hdr)
    let title: string | undefined
    let label: NetworkName | undefined
    let disabled = false
    const wires: NetworkWire[] = []
    const statements: NetworkTextStatement[] = []
    const comment: string[] = []
    let headerEnd = hdr.offset + hdr.length

    try {
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

      // The network's comment: the `//` lines between the header and the wire block or first statement.
      while (this.peek().kind === "comment") comment.push(this.next().text)

      let sawBlock = false
      if (isWord(this.peek(), "VAR_TEMP")) {
        this.parseWires(wires)
        sawBlock = true
      }

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
        if (isWord(t, "VAR_TEMP"))
          throw this.err(
            t,
            "NETWORK_BAD_EXPRESSION",
            sawBlock
              ? "a second VAR_TEMP block: a network declares its wires in one block."
              : "a VAR_TEMP block after a statement: a network's wire block comes before its first statement.",
          )
        statements.push(this.parseStatement())
      }

      for (const w of [...this.wires.values()].filter((x) => !x.defined))
        this.diag(
          "NETWORK_BAD_EXPRESSION",
          `the wire ${w.wire.name.text} is declared and never defined: a wire's definition is the statement \`${w.wire.name.text} := value;\`.`,
          w.wire.name.span,
        )
      this.checkWireTypes(wires, statements)
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.report(e)
      // An unclosed network already stands at the next NETWORK or the end; any other finding skips to END_NETWORK.
      if (e.code !== "NETWORK_NOT_CLOSED") this.recover()
    }

    const stored = (s: string | undefined): string | undefined => {
      const t = s?.trimEnd()
      return t === undefined || t.length === 0 ? undefined : t
    }
    return {
      index,
      title: stored(title),
      label,
      disabled,
      comment: stored(comment.length > 0 ? comment.join("\n") : undefined),
      wires,
      statements,
      span: this.span(hdr.offset, Math.max(this.lastEnd, hdr.offset + hdr.length)),
      headerSpan: this.span(hdr.offset, headerEnd),
    }
  }

  /** `VAR_TEMP g1, g2 : BOOL; … END_VAR` — on one line canonically, across lines as ST allows. */
  private parseWires(out: NetworkWire[]): void {
    const kw = this.next()
    let any = false
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
      any = true
    }
    this.next() // END_VAR — it takes no `;` of its own: a `;` after it is the empty item.
    if (!any) throw this.err(kw, "NETWORK_BAD_EXPRESSION", "an empty VAR_TEMP block: a network without a wire carries none.")
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
    if (this.scope?.contains(name.text))
      throw this.err(
        name,
        "NETWORK_DUPLICATE_NAME",
        `the wire ${name.text} names a variable in scope (case-insensitively); the writer would have named it the lowest free g<n>.`,
      )
    const wire: NetworkWire = { name: this.name(name), typeText, ...(type !== undefined ? { type } : {}), span }
    this.wires.set(key, { wire, defined: false })
    out.push(wire)
  }

  /**
   * Spec, "a hand-edited type": each wire's declared type against what its producer says — the bridge reader's
   * `CheckWireTypes`, by the writer's rule (`NetworkSpelling.ProducerType`), because the vendor's Demux has no field
   * that would keep a type the producer contradicts. Run once the network is read: a leaf's type is decided by how the
   * wire is USED. Text carries no stored output type, so a box says BOOL (an EXECUTE, `.ENO`, a comparison), "BOOL or
   * another bit string" (a bit operator) or nothing — exactly what the reader has to go on.
   *
   * A refused declaration types nothing downstream (`NetworkWire.typeRefused`): the push never lets the body reach a
   * build, so a compiler message at the wire's CONSUMER would be one no build gives, and it would steer the engineer
   * to "fix" the consumer instead of the declaration. Only a declaration the producer names EXACTLY is the type the
   * build gives the uses (`NetworkWire.typeConfirmed`): where the rule says less, the push takes the declaration as
   * written and the vendor, whose Demux holds no type, compiles the consumer against the producer.
   */
  private checkWireTypes(wires: readonly NetworkWire[], statements: readonly NetworkTextStatement[]): void {
    for (const wire of wires) {
      if (wire.definition === undefined) continue
      const produced = this.producerType(wire.definition.value, wire, statements, wires)
      const says = disagreement(produced, wire.typeText)
      if (says === undefined) {
        if (produced.exact !== undefined) wire.typeConfirmed = true
        continue
      }
      wire.typeRefused = true
      this.diag("NETWORK_BAD_EXPRESSION", `the wire ${wire.name.text} is declared ${wire.typeText} and its producer is ${says}.`, wire.name.span)
    }
  }

  /** `NetworkSpelling.ProducerType` over the text's tree. A modifier (`NOT`) is a flag on the node it stands on, so it
   *  is looked through; an edge flag makes anything BOOL. */
  private producerType(
    v: NetworkValue,
    wire: NetworkWire,
    statements: readonly NetworkTextStatement[],
    wires: readonly NetworkWire[],
  ): Produced {
    switch (v.kind) {
      case "edge":
      case "parallel":
      case "execute":
        return { exact: BOOL }
      case "not":
        return this.producerType(v.operand, wire, statements, wires)
      case "operand":
        if (/^(TRUE|FALSE)$/i.test(v.text)) return { exact: BOOL }
        return this.everyUseIsBoolean(wire, statements) ? { exact: BOOL } : {}
      case "wire_ref": {
        const other = wires.find((w) => w.name.text.toUpperCase() === v.name.text.toUpperCase())
        return other !== undefined ? { exact: other.typeText } : {}
      }
      case "group":
        return boxProduces(operatorType(v.op))
      case "call":
        return v.eno ? { exact: BOOL } : boxProduces(v.boxType)
      case "empty_slot":
        return {}
    }
  }

  /** Whether `wire` is referenced at least once and only where a BOOL is taken (`NetworkSpelling.EveryUseIsBoolean`):
   *  an EN, a Parallel, a jump condition, and in ladder a coil or a contact (a bit operator's input). */
  private everyUseIsBoolean(wire: NetworkWire, statements: readonly NetworkTextStatement[]): boolean {
    const key = wire.name.text.toUpperCase()
    const ld = this.language === "LD"
    let any = false
    let all = true
    const walk = (v: NetworkValue, boolean: boolean): void => {
      switch (v.kind) {
        case "wire_ref":
          if (v.name.text.toUpperCase() !== key) return
          any = true
          all &&= boolean
          return
        case "not":
        case "edge":
          return walk(v.operand, boolean)
        case "group": {
          const contacts = ld && BIT_OPERATOR_FUNCTIONS.has(operatorType(v.op))
          for (const o of v.operands) walk(o, contacts)
          return
        }
        case "call": {
          const contacts = ld && BIT_OPERATOR_FUNCTIONS.has(v.boxType.toUpperCase())
          for (const p of v.pins) if (p.kind === "input") walk(p.value, p.name?.text.toUpperCase() === "EN" || contacts)
          return
        }
        case "execute":
          if (v.en !== undefined) walk(v.en, true)
          return
        case "parallel":
          if (v.input !== undefined) walk(v.input, true)
          for (const b of v.branches) walk(b, true)
          return
        default:
          return
      }
    }
    for (const s of statements)
      switch (s.kind) {
        case "assign":
          walk(s.value, ld) // a ladder coil takes a BOOL
          break
        case "jump":
        case "return":
          if (s.condition !== undefined) walk(s.condition, true)
          break
        case "wire_def": // boolean or not rides the other wire's uses — not proven
        case "value": // a top-level output goes nowhere
          walk(s.value, false)
          break
        case "empty":
          break
      }
    return any && all
  }

  // ── statements: one per NWL item ────────────────────────────────────────────────────────────

  private parseStatement(): NetworkTextStatement {
    const t = this.peek()

    // The empty statement IS the empty item — a `;` that closes no statement.
    if (isSym(t, ";")) {
      this.next()
      return { kind: "empty", span: this.tokSpan(t) }
    }

    if (isWord(t, "LET")) throw this.err(t, "NETWORK_PARSE", v1Refusal("`LET` statements"))

    if (isWord(t, "IF")) {
      this.next()
      const condTok = this.peek()
      const cond = this.resolve(this.parseValue(true))
      if (cond.kind === "empty_slot")
        throw this.err(condTok, "NETWORK_BAD_EXPRESSION", "IF with no condition: an unconditional jump is `JMP l;`.")
      this.expectWord("THEN", "IF c THEN JMP l; END_IF;")
      const jump = this.parseJump(cond)
      this.expectSym(";", "IF c THEN JMP l; END_IF;")
      this.expectWord("END_IF", "IF c THEN JMP l; END_IF;")
      this.expectSym(";", "every statement ends with `;`, END_IF; included")
      return { ...jump, span: this.span(t.offset, this.lastEnd) }
    }

    if (isWord(t, "JMP") || isWord(t, "RETURN")) {
      const jump = this.parseJump(undefined)
      this.expectSym(";", "every statement ends with `;`")
      return { ...jump, span: this.span(t.offset, this.lastEnd) }
    }

    const first = this.parseValue(false, true)
    if (this.atStorage()) {
      const targets: { tok: Tok; op: Tok }[] = []
      let cur = first
      let value: NetworkValue
      for (;;) {
        if (cur.bare === undefined)
          throw this.err(cur.start, "NETWORK_BAD_EXPRESSION", "an assignment target is one variable: a token, or text between backticks.")
        targets.push({ tok: cur.bare, op: this.takeStorage() })
        const v = this.parseValue(true, true)
        if (this.atStorage()) {
          cur = v
          continue
        }
        value = this.resolve(v)
        break
      }
      this.expectSym(";", "every statement ends with `;`")
      return this.buildAssign(targets, value, t)
    }

    const value = this.resolve(first)
    this.expectSym(";", "every statement ends with `;`")
    return { kind: "value", value, span: this.span(t.offset, this.lastEnd) }
  }

  /** `:=`, or ExST's `S=` / `R=` — a word `S` or `R` and `=`, however spaced. After a target nothing else can follow in
   *  that shape, while inside a group `(R = x)` is a comparison; so the position decides, never the spacing. */
  private atStorage(): boolean {
    const t = this.peek()
    return isSym(t, ":=") || ((isWord(t, "S") || isWord(t, "R")) && this.lx.equalsFollows())
  }

  private takeStorage(): Tok {
    const t = this.next()
    if (isSym(t, ":=")) return t
    const eq = this.next()
    return { kind: "sym", text: `${t.text.toUpperCase()}=`, offset: t.offset, length: eq.offset + eq.length - t.offset, atLineStart: t.atLineStart }
  }

  private buildAssign(targets: { tok: Tok; op: Tok }[], value: NetworkValue, start: Tok): NetworkTextStatement {
    for (const { tok } of targets) {
      const w = tok.kind === "word" ? this.wires.get(tok.text.toUpperCase()) : undefined
      if (w === undefined) continue
      const name = w.wire.name.text
      if (targets.length > 1)
        throw this.err(tok, "NETWORK_BAD_EXPRESSION", `the wire ${name} is defined inside a chain; a wire's definition is its own statement \`${name} := value;\`.`)
      if (targets[0]!.op.text !== ":=")
        throw this.err(targets[0]!.op, "NETWORK_BAD_EXPRESSION", `the wire ${name} is defined with ${targets[0]!.op.text}; a wire is defined with \`:=\`, and S=/R= are coils.`)
      if (w.defined) throw this.err(tok, "NETWORK_DUPLICATE_NAME", `the wire ${name} is defined twice.`)
      w.defined = true
      const def = { kind: "wire_def" as const, wire: this.name(tok), value, span: this.span(start.offset, this.lastEnd) }
      w.wire.definition = def
      return def
    }
    const out: NetworkAssign = {
      kind: "assign",
      targets: targets.map(({ tok, op }) => this.target(tok, op.text as NetworkTarget["op"])),
      value,
      span: this.span(start.offset, this.lastEnd),
    }
    return out
  }

  /** `JMP label` / `RETURN`. After JMP a word can be nothing but the label, words of the text included. */
  private parseJump(
    condition: NetworkValue | undefined,
  ): { kind: "jump"; target: NetworkName; condition?: NetworkValue } | { kind: "return"; condition?: NetworkValue } {
    const t = this.next()
    const cond = condition !== undefined ? { condition } : {}
    if (isWord(t, "JMP")) {
      const l = this.next()
      if (l.kind !== "word" || !IDENTIFIER.test(l.text))
        throw this.err(l, "NETWORK_BAD_EXPRESSION", "JMP takes one label, an identifier.")
      this.addOtherWords(l, l.text)
      return { kind: "jump", target: this.name(l), ...cond }
    }
    if (isWord(t, "RETURN")) return { kind: "return", ...cond }
    throw this.err(t, "NETWORK_PARSE", "IF c THEN takes `JMP label;` or `RETURN;`.")
  }

  // ── values ──────────────────────────────────────────────────────────────────────────────────

  /** @param consumed whether something consumes this value — as opposed to a top-level item whose output goes nowhere.
   *  @param defer keep a bare token unresolved: it may turn out to be a target or a pin's name. */
  private parseValue(consumed: boolean, defer = false): PVal {
    const t = this.peek()
    if (this.isEmptyHere(t)) return { node: { kind: "empty_slot", span: this.emptySpan(t) }, start: t }

    if (isWord(t, "NOT")) {
      this.next()
      const n = this.peek()
      if (this.isEmptyHere(n))
        throw this.err(t, "NETWORK_UNSUPPORTED", "a flag on an empty slot: an unconnected position has no text to modify.")
      if (isSym(n, "(")) return { node: this.parseAfterNotParen(t, consumed), start: t }
      // The vendor negates BEFORE it detects the edge (DIALECT N17), so the one spelling is R_EDGE(NOT x).
      if (isWord(n, "R_EDGE") || isWord(n, "F_EDGE"))
        throw this.err(
          t,
          "NETWORK_BAD_EXPRESSION",
          `NOT outside ${n.text.toUpperCase()}(…): the IDE negates before it detects the edge, so the one spelling is ${n.text.toUpperCase()}(NOT x).`,
        )
      const core = this.held(this.resolve(this.parseCore(consumed, false)), t)
      return { node: { kind: "not", operand: core, span: this.span(t.offset, this.lastEnd) }, start: t }
    }

    if (isWord(t, "R_EDGE") || isWord(t, "F_EDGE")) return { node: this.parseEdge(consumed), start: t }

    const v = this.parseCore(consumed, defer)
    return defer || v.node !== undefined ? v : { node: this.resolve(v), start: t }
  }

  /** `R_EDGE(x)` / `F_EDGE(x)`: a flag on `x`, never a box. */
  private parseEdge(consumed: boolean): NetworkValue {
    const kw = this.next()
    const rising = isWord(kw, "R_EDGE")
    const word = kw.text.toUpperCase()
    // Asked BEFORE the argument list is read as the edge's: a call of a POU named so has pins the edge does not.
    if (this.constructTaken(word))
      throw this.err(kw, "NETWORK_UNSUPPORTED", `a POU or instance named ${word}: the text reads ${word}(…) as the edge flag, so the call has no spelling.`)
    this.expectSym("(", `${word}(x)`)
    let n = this.peek()
    // `NOT(a)` — NOT with a pair holding no operator — is the NOT BOX, an argument like any other. Any other NOT is the
    // negation modifier, which belongs inside the edge: the vendor negates before it detects the edge (DIALECT N17).
    let not: Tok | undefined
    if (isWord(n, "NOT") && !(this.lx.peekChar() === "(" && !this.lx.pairAheadHoldsOperator())) {
      not = this.next()
      n = this.peek()
      if (isWord(n, "NOT") && !(this.lx.peekChar() === "(" && !this.lx.pairAheadHoldsOperator()))
        throw this.err(n, "NETWORK_BAD_EXPRESSION", `a second modifier inside ${word}(…): the one modifier an edge's argument carries is one NOT.`)
    }
    if (isWord(n, "R_EDGE") || isWord(n, "F_EDGE"))
      throw this.err(n, "NETWORK_UNSUPPORTED", "nested edges: one operand carries one edge flag, and rising with falling has no spelling.")
    if (this.isEmptyHere(n))
      throw this.err(not ?? kw, "NETWORK_UNSUPPORTED", "a flag on an empty slot: an unconnected position has no text to modify.")
    let core: NetworkValue
    if (not === undefined) core = this.resolve(this.parseCore(consumed, false))
    else if (isSym(n, "(")) core = this.parseAfterNotParen(not, consumed)
    else {
      const inner = this.held(this.resolve(this.parseCore(consumed, false)), not)
      core = { kind: "not", operand: inner, span: this.span(not.offset, this.lastEnd) }
    }
    this.expectSym(")", `${word}(x)`)
    return { kind: "edge", rising, operand: this.held(core, kw), span: this.span(kw.offset, this.lastEnd) }
  }

  private parseCore(consumed: boolean, defer: boolean): PVal {
    const t = this.peek()
    switch (t.kind) {
      case "sym":
        if (t.text === "(") {
          this.next()
          return { node: this.parseGroupRest(t, this.resolve(this.parseValue(true))), start: t }
        }
        break
      case "unnamed":
        this.next()
        if (isSym(this.peek(), ":")) {
          // `??? : TYPE(…)` — the vendor's unnamed instance, which carries its type because no declaration can.
          this.next()
          const ty = this.next()
          if (ty.kind !== "word" || !IDENTIFIER.test(ty.text))
            throw this.err(ty, "NETWORK_BAD_EXPRESSION", "`??? : TYPE(…)` names the FB type, an identifier.")
          this.expectSym("(", "??? : TYPE(pins)")
          return { node: this.parseCall(t, consumed, undefined, this.name(ty)), start: t }
        }
        if (isSym(this.peek(), "("))
          throw this.err(t, "NETWORK_BAD_EXPRESSION", "??? is no call head; an unnamed instance is written `??? : TYPE(…)`.")
        return this.bare(t, defer)
      case "word":
        if (isWord(t, "PARALLEL")) return { node: this.parseParallel(), start: t }
        if (isWord(t, "EXECUTE")) return { node: this.parseExecute(consumed), start: t }
        this.next()
        if (isSym(this.peek(), "(")) {
          if (!(isName(t.text) && (!NETWORK_TEXT_WORDS.has(t.text.toUpperCase()) || OPERATOR_HEADS.has(t.text.toUpperCase()))))
            throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' is a keyword of the text and no call head.`)
          this.next()
          return { node: this.parseCall(t, consumed, undefined), start: t }
        }
        if (NETWORK_TEXT_WORDS.has(t.text.toUpperCase()))
          throw this.err(
            t,
            "NETWORK_BAD_EXPRESSION",
            `'${t.text}' at operand position: an operand spelled like a keyword of the text is written between backticks.`,
          )
        return this.bare(t, defer)
      case "backtick":
        this.next()
        if (isSym(this.peek(), "(")) {
          this.next()
          return { node: this.parseCall(t, consumed, undefined), start: t }
        }
        return this.bare(t, defer)
      case "number":
      case "typed":
      case "address":
        this.next()
        if (isSym(this.peek(), "(")) throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' is a literal and no call head.`)
        return this.bare(t, defer)
      default:
        break
    }
    throw this.err(
      t,
      "NETWORK_PARSE",
      t.kind === "eof"
        ? "the body ends inside a statement."
        : `'${t.text}' where a value is expected: an operand that is not one token is written between backticks.`,
    )
  }

  private bare(t: Tok, defer: boolean): PVal {
    return defer ? { bare: t, start: t } : { node: this.resolve({ bare: t, start: t }), start: t }
  }

  /** A group's remainder, after `(` and its first operand: one operator kind, then `)`. Every pair of parentheses is
   *  exactly one box, so a pair holding no operator is refused, not read as grouping. */
  private parseGroupRest(open: Tok, first: NetworkValue): NetworkValue {
    const op = this.peek()
    if (!isOperator(op)) {
      if (isSym(op, ")"))
        throw this.err(open, "NETWORK_BAD_EXPRESSION", "a pair of parentheses that is no box: a group holds an infix operator, and a call's pair follows its head.")
      throw this.notAnOperator(op)
    }
    const sym = operatorSymbol(op)
    const operands = [first]
    while (isOperator(this.peek())) {
      const o = this.next()
      if (operatorSymbol(o) !== sym)
        throw this.err(o, "NETWORK_BAD_EXPRESSION", `'${sym}' and '${o.text}' in one group: a group is one operator box, so it holds one operator kind.`)
      operands.push(this.resolve(this.parseValue(true)))
    }
    if (!isSym(this.peek(), ")")) throw this.notAnOperator(this.peek())
    this.next()
    return { kind: "group", op: sym, operands, span: this.span(open.offset, this.lastEnd) }
  }

  private notAnOperator(t: Tok): ParseError {
    if (t.kind === "word" && NETWORK_TEXT_WORDS.has(t.text.toUpperCase()))
      return this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' at operand position: an operand spelled like a keyword of the text is written between backticks.`)
    if (t.kind === "word" || (t.kind === "sym" && !STRUCTURAL.has(t.text)))
      return this.err(t, "NETWORK_UNKNOWN_OPERATOR", `'${t.text}' is not an operator of the table (AND OR XOR + - * / MOD > < >= <= = <>).`)
    return this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' inside a group: a group is \`(a OP b …)\`.`)
  }

  /** After `NOT` and `(`: a group under the negation modifier if the pair holds an operator, else the NOT box's
   *  argument list. */
  private parseAfterNotParen(not: Tok, consumed: boolean): NetworkValue {
    const open = this.next()
    if (isSym(this.peek(), ")") || isSym(this.peek(), "=>") || this.isPinName(this.peek()))
      return this.parseCall(not, consumed, undefined)
    const v = this.parseValue(true, true)
    if (v.bare !== undefined && (isSym(this.peek(), ":=") || isSym(this.peek(), "=>"))) return this.parseCall(not, consumed, v)
    if (isOperator(this.peek())) {
      const group = this.parseGroupRest(open, this.resolve(v))
      return { kind: "not", operand: group, span: this.span(not.offset, this.lastEnd) }
    }
    return this.parseCall(not, consumed, v)
  }

  /** A call's pins after its `(`, the `)`, and an optional `.ENO`. */
  private parseCall(head: Tok, consumed: boolean, first: PVal | undefined, unnamedType?: NetworkName): NetworkCall {
    const pins: NetworkPin[] = []
    let hadEn = false
    if (first === undefined && isSym(this.peek(), ")")) this.next() // `f()` — a box with no input slot
    else {
      let pre = first
      for (;;) {
        hadEn = this.pin(pre, pins, hadEn)
        pre = undefined
        const sep = this.peek()
        if (isSym(sep, ",")) {
          this.next()
          continue
        }
        if (isSym(sep, ")")) {
          this.next()
          break
        }
        if (isOperator(sep))
          throw this.err(sep, "NETWORK_BAD_EXPRESSION", "an infix operator inside a call's argument list: a group is its own pair of parentheses.")
        throw this.err(sep, "NETWORK_PARSE", `'${sep.text}' in a call: pins are separated by \`,\` and closed by \`)\`.`)
      }
    }

    let eno = false
    if (isSym(this.peek(), ".")) {
      this.next()
      const e = this.next()
      if (!isWord(e, "ENO")) throw this.err(e, "NETWORK_PARSE", "after a call, the one suffix is `.ENO`.")
      eno = true
    }

    const headText = head.kind === "unnamed" ? "???" : head.text
    // The box's TYPE, as the bridge reader decides it: the unnamed instance's own, an instance's FB (asked of the
    // scope), or the head, which names a POU.
    let type: string
    const fbType = unnamedType === undefined ? this.scope?.instanceType(headText) : undefined
    if (unnamedType !== undefined) {
      type = unnamedType.text
      this.addOtherWords(head, type)
    } else if (fbType !== undefined) {
      if (CONSTRUCT_WORDS.has(headText.toUpperCase()))
        throw this.err(head, "NETWORK_UNSUPPORTED", `an instance named ${headText.toUpperCase()}: the text reads it as its own construct.`)
      type = fbType
      this.addOtherWords(head, headText)
      this.addOtherWords(head, fbType)
    } else {
      // A function is a POU and has a name. A head that is none (`fbs[1]`, `SUPER^`) is an FB instance whose declaration
      // names no name, and read as a function it would push a box of a type no POU has in place of the instance call.
      if (!isName(headText))
        throw this.err(
          head,
          "NETWORK_UNSUPPORTED",
          `an FB instance the declarations do not name: '${headText}' is no POU name, and no declaration names it an instance, so its type is unknown.`,
        )
      type = headText
      this.addOtherWords(head, headText)
    }
    // Spec, "a POU named like an edge word": a backticked head is still the POU's name, and an instance's FB type is a
    // POU too — the writer could spell none of them back.
    if (CONSTRUCT_WORDS.has(type.toUpperCase()))
      throw this.err(
        head,
        "NETWORK_UNSUPPORTED",
        `a POU named ${type.toUpperCase()}: the text reads ${type.toUpperCase()}(…) as its own construct, so a call of it has no spelling.`,
      )
    if (eno && !consumed)
      throw this.err(head, "NETWORK_BAD_EXPRESSION", `\`.ENO\` on '${headText}', which nothing consumes: a top-level box's output goes nowhere.`)

    const headName: NetworkName =
      head.kind === "backtick"
        ? { text: head.text, span: this.span(head.offset + 1, head.offset + head.length - 1) }
        : this.name(head)
    // The head as ST: an FB instance may be a PATH (`Mach1_AuxData.IEC_TIMERS.TON_Blocked(IN := …)`, lenze-mid), which
    // the text lexes as one token and ST reads as a member chain.
    const headExpr =
      head.kind === "word"
        ? this.stExpr(head.offset, head.offset + head.length)
        : head.kind === "backtick"
          ? this.stExpr(head.offset + 1, head.offset + head.length - 1)
          : undefined
    const call: NetworkCall = {
      kind: "call",
      head: headName,
      ...(headExpr !== undefined ? { headExpr } : {}),
      backticked: head.kind === "backtick",
      ...(unnamedType !== undefined ? { unnamedType } : {}),
      boxType: type,
      pins,
      eno,
      span: this.span(head.offset, this.lastEnd),
    }
    return call
  }

  /** One pin; returns whether the call has named EN so far. */
  private pin(pre: PVal | undefined, pins: NetworkPin[], hadEn: boolean): boolean {
    const at = this.peek()
    if (pre === undefined && isSym(at, "=>")) {
      this.next()
      // `=> v` fills the next output slot; a bare `=>` passes one over.
      const target = this.isEmptyHere(this.peek()) ? undefined : this.target(this.next())
      pins.push({ kind: "output", ...(target !== undefined ? { target } : {}), span: this.span(at.offset, this.lastEnd) })
      return hadEn
    }

    // A pin name is decided by the `:=` / `=>` after it, BEFORE the word is read as a value: read first,
    // `execute := x` would open an EXECUTE body.
    const pinName =
      pre === undefined
        ? this.isPinName(at)
          ? this.next()
          : undefined
        : pre.bare?.kind === "word" && (isSym(this.peek(), ":=") || isSym(this.peek(), "=>"))
          ? pre.bare
          : undefined
    if (pinName !== undefined) {
      if (!IDENTIFIER.test(pinName.text)) throw this.err(pinName, "NETWORK_BAD_EXPRESSION", `a pin name is an identifier, not '${pinName.text}'.`)
      const isEn = pinName.text.toUpperCase() === "EN"
      if (this.next().text === ":=") {
        const value = this.resolve(this.parseValue(true))
        if (isEn) {
          if (hadEn) throw this.err(pinName, "NETWORK_BAD_EXPRESSION", "a call names EN twice.")
          hadEn = true
        }
        pins.push({ kind: "input", name: this.name(pinName), value, span: this.span(pinName.offset, this.lastEnd) })
        return hadEn
      }
      if (isEn || pinName.text.toUpperCase() === "ENO")
        throw this.err(pinName, "NETWORK_BAD_EXPRESSION", `\`${pinName.text} =>\`: EN is an input, and ENO is never an output pin — a consumer of ENO says \`.ENO\`.`)
      if (this.isEmptyHere(this.peek()))
        throw this.err(pinName, "NETWORK_BAD_EXPRESSION", `\`${pinName.text} =>\` wired to nothing: a named output pin holds a target, and an unwired one is not written.`)
      const target = this.target(this.next())
      pins.push({ kind: "output", name: this.name(pinName), target, span: this.span(pinName.offset, this.lastEnd) })
      return hadEn
    }

    const value = this.resolve(pre ?? this.parseValue(true, true))
    pins.push({ kind: "input", value, span: value.span })
    return hadEn
  }

  /** `PARALLEL([MODE := m,] [IN := feed,] b1, b2, …)` — never an AND/OR box. No `IN` is no feed; `IN := ,` is refused. */
  private parseParallel(): NetworkParallel {
    const kw = this.next()
    if (this.constructTaken("PARALLEL"))
      throw this.err(kw, "NETWORK_UNSUPPORTED", "a POU or instance named PARALLEL: the text reads PARALLEL(…) as the parallel branch, so the call has no spelling.")
    this.expectSym("(", "PARALLEL([IN := feed,] b1, b2, …)")
    let mode: NetworkName | undefined
    let input: NetworkValue | undefined
    const branches: NetworkValue[] = []
    if (isSym(this.peek(), ")")) throw this.err(kw, "NETWORK_BAD_EXPRESSION", "a PARALLEL with no branch.")
    for (;;) {
      const v = this.parseValue(true, true)
      if (v.bare?.kind === "word" && isSym(this.peek(), ":=")) {
        const b = v.bare
        this.next()
        if (isWord(b, "MODE")) {
          if (mode !== undefined || input !== undefined || branches.length > 0)
            throw this.err(b, "NETWORK_BAD_EXPRESSION", "PARALLEL takes MODE := first, once.")
          const m = this.next()
          if (m.kind !== "word" || !MEASURED_MODES.has(m.text))
            throw this.err(m, "NETWORK_UNSUPPORTED", `the Parallel mode '${m.text}': the measured modes are BoxShortCircuit and Sequential.`)
          mode = this.name(m)
        } else if (isWord(b, "IN")) {
          if (input !== undefined || branches.length > 0)
            throw this.err(b, "NETWORK_BAD_EXPRESSION", "PARALLEL takes IN := before its branches, once.")
          if (this.isEmptyHere(this.peek()))
            throw this.err(
              b,
              "NETWORK_UNSUPPORTED",
              "a Parallel fed by the empty terminator: census 1.2 found none — an unfed Parallel is PARALLEL(a, b), with no IN.",
            )
          input = this.resolve(this.parseValue(true))
        } else throw this.err(b, "NETWORK_BAD_EXPRESSION", "PARALLEL takes MODE :=, IN := and its branches.")
      } else branches.push(this.resolve(v))

      const sep = this.peek()
      if (isSym(sep, ",")) {
        this.next()
        continue
      }
      if (isSym(sep, ")")) {
        this.next()
        break
      }
      throw this.err(sep, "NETWORK_PARSE", `'${sep.text}' in PARALLEL: branches are separated by \`,\` and closed by \`)\`.`)
    }
    if (branches.length === 0) throw this.err(kw, "NETWORK_BAD_EXPRESSION", "a PARALLEL with no branch.")
    return {
      kind: "parallel",
      ...(mode !== undefined ? { mode } : {}),
      ...(input !== undefined ? { input } : {}),
      branches,
      span: this.span(kw.offset, this.lastEnd),
    }
  }

  /** `EXECUTE[(EN := c)]`, the verbatim ST lines, `END_EXECUTE`, and `.ENO` where consumed — an Execute box's only
   *  output is ENO, so its `.ENO` needs no EN. */
  private parseExecute(consumed: boolean): NetworkExecute {
    const kw = this.next()
    let en: NetworkValue | undefined
    if (this.lx.peekOnLine() === "(") {
      this.expectSym("(", "EXECUTE(EN := c)")
      const e = this.next()
      if (!isWord(e, "EN")) throw this.err(e, "NETWORK_BAD_EXPRESSION", "EXECUTE takes one pin, `(EN := c)`.")
      this.expectSym(":=", "EXECUTE(EN := c)")
      en = this.resolve(this.parseValue(true))
      this.expectSym(")", "EXECUTE(EN := c)")
    }
    const { snippet, end } = this.lx.executeBody()
    if (snippet.kind === "error") throw this.err(snippet, (snippet.code ?? "NETWORK_PARSE") as NetworkDiagnosticCode, snippet.text)
    this.lastEnd = end.offset + end.length
    const parsed = this.stStatements(snippet.offset, snippet.offset + snippet.length)

    let eno = false
    if (isSym(this.peek(), ".")) {
      this.next()
      const e = this.next()
      if (!isWord(e, "ENO")) throw this.err(e, "NETWORK_PARSE", "after END_EXECUTE, the one suffix is `.ENO`.")
      eno = true
    }
    if (consumed && !eno) throw this.err(kw, "NETWORK_BAD_EXPRESSION", "a consumed EXECUTE box says `.ENO`: its only output is ENO.")
    if (!consumed && eno) throw this.err(kw, "NETWORK_BAD_EXPRESSION", "`.ENO` on an EXECUTE box nothing consumes.")
    return {
      kind: "execute",
      ...(en !== undefined ? { en } : {}),
      statements: parsed.statements,
      ok: parsed.ok,
      eno,
      span: this.span(kw.offset, this.lastEnd),
    }
  }

  // ── operands ────────────────────────────────────────────────────────────────────────────────

  private resolve(v: PVal): NetworkValue {
    if (v.node !== undefined) return v.node
    const t = v.bare!
    const w = t.kind === "word" ? this.wires.get(t.text.toUpperCase()) : undefined
    if (w !== undefined) {
      if (!w.defined)
        throw this.err(
          t,
          "NETWORK_BAD_EXPRESSION",
          `the wire ${w.wire.name.text} is referenced before its definition: a wire is defined by \`${w.wire.name.text} := value;\` before its first use.`,
        )
      return { kind: "wire_ref", name: this.name(t), span: this.tokSpan(t) }
    }
    if (t.kind === "word") this.refuseUndeclaredWire(t)
    this.addOtherWords(t, t.text)
    const unnamed = t.kind === "unnamed"
    const backticked = t.kind === "backtick"
    const expr = unnamed ? undefined : backticked ? this.stExpr(t.offset + 1, t.offset + t.length - 1) : this.stExpr(t.offset, t.offset + t.length)
    return { kind: "operand", text: t.text, backticked, unnamed, ...(expr !== undefined ? { expr } : {}), span: this.tokSpan(t) }
  }

  /** An assignment target (`op` its storage operator) or a `=>` pin's (no operator): a token or backticked text. */
  private target(t: Tok, op?: NetworkTarget["op"]): NetworkTarget {
    switch (t.kind) {
      case "word":
        if (NETWORK_TEXT_WORDS.has(t.text.toUpperCase()))
          throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target spelled like a keyword of the text is written between backticks.`)
        this.refuseUndeclaredWire(t)
        this.addOtherWords(t, t.text)
        return this.targetOf(t, op, this.stExpr(t.offset, t.offset + t.length))
      case "backtick":
        this.addOtherWords(t, t.text)
        return this.targetOf(t, op, this.stExpr(t.offset + 1, t.offset + t.length - 1))
      case "unnamed":
        return this.targetOf(t, op, undefined)
      case "address":
        return this.targetOf(t, op, this.stExpr(t.offset, t.offset + t.length))
      default:
        throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target is a variable, a token or text between backticks.`)
    }
  }

  private targetOf(t: Tok, op: NetworkTarget["op"] | undefined, expr: Expr | undefined): NetworkTarget {
    return {
      text: t.text,
      ...(expr !== undefined ? { expr } : {}),
      ...(op !== undefined ? { op } : {}),
      backticked: t.kind === "backtick",
      unnamed: t.kind === "unnamed",
      span: this.tokSpan(t),
    }
  }

  /** A BARE word shaped like a wire that neither this network nor the scope declares is a wire someone forgot to
   *  declare — read as a variable it would compile against nothing. Between backticks it is the variable of that name,
   *  which is how the writer spells one the scope does not hold (`NetworkSpelling.ReadsAsUndeclaredWire`). */
  private refuseUndeclaredWire(t: Tok): void {
    if (this.scope === undefined || !WIRE_NAME.test(t.text) || this.wires.has(t.text.toUpperCase()) || this.scope.contains(t.text)) return
    throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' is shaped like a wire and is declared neither in this network's VAR_TEMP block nor in scope.`)
  }

  /** Whether a POU or FB instance in scope carries a construct word (`NetworkSpelling.ConstructTaken`). */
  private constructTaken(word: string): boolean {
    return (
      this.scope !== undefined &&
      CONSTRUCT_WORDS.has(word.toUpperCase()) &&
      (this.scope.isPou(word) || this.scope.instanceType(word) !== undefined)
    )
  }

  /** A word spelled where a wire name may not appear — the writer reserves the same words, so a wire equal to one would
   *  be renamed on the way out. Reported on the spot; it stops nothing. */
  private addOtherWords(at: Tok, text: string): void {
    for (const m of text.matchAll(WORD)) {
      const w = this.wires.get(m[0].toUpperCase())
      if (w !== undefined)
        this.diag(
          "NETWORK_DUPLICATE_NAME",
          `the wire ${w.wire.name.text} is also spelled as a name in this network ('${at.text}'); a wire's name must be no other name the network or its scope uses, case-insensitively.`,
          this.tokSpan(at),
        )
    }
  }

  /** DIALECT N20: the IDE holds no flag on a wire reference or a Parallel, so `NOT g3`, `R_EDGE(g3)` and
   *  `NOT PARALLEL(…)` state logic the push would drop. */
  private held(core: NetworkValue, modifier: Tok): NetworkValue {
    if (core.kind === "wire_ref")
      throw this.err(
        modifier,
        "NETWORK_UNSUPPORTED",
        `${modifier.text.toUpperCase()} on a wire reference: the IDE holds no flag on a wire; put it on the wire's producer.`,
      )
    if (core.kind === "parallel")
      throw this.err(modifier, "NETWORK_UNSUPPORTED", `${modifier.text.toUpperCase()} on PARALLEL(…): the IDE holds no flag on a Parallel.`)
    return core
  }

  // ── ST inside the text ──────────────────────────────────────────────────────────────────────

  /** The ST tokens of `[from, to)` of the body text, positioned in the document. */
  private stTokens(from: number, to: number): Token[] {
    const at = this.position(from)
    return lex(this.text.slice(from, to), this.dialect)
      .filter((t) => t.kind !== "eof" && !isTrivia(t.kind))
      .map((t) => ({ ...t, span: shift(t.span, at) }))
  }

  /** `[from, to)` parsed as one ST expression, or undefined when it is none. */
  private stExpr(from: number, to: number): Expr | undefined {
    const toks = this.stTokens(from, to)
    if (toks.some((t) => t.kind === "unknown")) return undefined
    return parseExprFromTokens(toks)
  }

  /** An EXECUTE body's lines, parsed as the ST they are. */
  private stStatements(from: number, to: number): { statements: StatementList; ok: boolean } {
    const toks = this.stTokens(from, to)
    const span = this.span(from, to)
    const parsed = parseStatements({ kind: "body", tokens: toks, span })
    return { statements: parsed.statements, ok: parsed.ok }
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────────────

  private peek(): Tok {
    if (this.la !== undefined) return this.la
    const t = this.lx.next()
    if (t.kind === "error") throw this.err(t, (t.code ?? "NETWORK_PARSE") as NetworkDiagnosticCode, t.text)
    this.la = t
    return t
  }

  /** `peek`, reporting a lexical error rather than throwing it (the lexer has already moved past it). */
  private peekSafe(): Tok | undefined {
    try {
      return this.peek()
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.report(e)
      return undefined
    }
  }

  private next(): Tok {
    const t = this.peek()
    this.la = undefined
    if (t.kind !== "eof") this.lastEnd = t.offset + t.length
    return t
  }

  private expectSym(sym: string, form: string): void {
    const t = this.peek()
    if (!isSym(t, sym))
      throw this.err(
        t,
        "NETWORK_PARSE",
        t.kind === "eof" ? `the body ends where \`${sym}\` is expected (${form}).` : `expected \`${sym}\` and found '${t.text}' (${form}).`,
      )
    this.next()
  }

  private expectOnLine(sym: string, line: number, form: string): void {
    const t = this.peek()
    if (this.line(t) !== line) throw this.err(t, "NETWORK_PARSE", `the NETWORK header ends at its newline; \`${form}\` is on one line.`)
    this.expectSym(sym, form)
  }

  private expectWord(word: string, form: string): void {
    const t = this.peek()
    if (!isWord(t, word)) throw this.err(t, "NETWORK_PARSE", `expected ${word} and found '${t.text}' (${form}).`)
    this.next()
  }

  /** An empty position: nothing stands where a value could. An operator word is a call head only when the pair after it
   *  is an argument list; a pair holding an operator is a group, so the word was the operator after an empty slot.
   *  Called only on the lookahead token, so the lexer stands right after it. */
  private isEmptyHere(t: Tok): boolean {
    return (
      isSym(t, ",") ||
      isSym(t, ")") ||
      isSym(t, ";") ||
      isWord(t, "THEN") ||
      (isOperator(t) && !(t.kind === "word" && this.lx.peekChar() === "(" && !this.lx.pairAheadHoldsOperator()))
    )
  }

  private isPinName(t: Tok): boolean {
    return t.kind === "word" && this.lx.pinOperatorFollows()
  }

  // ── positions ───────────────────────────────────────────────────────────────────────────────

  private lineIndex(offset: number): number {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  private line(t: Tok): number {
    return this.lineIndex(t.offset)
  }

  private position(offset: number): { offset: number; line: number; col: number } {
    const li = this.lineIndex(offset)
    const col = li === 0 ? this.base.startCol + offset : offset - this.lineStarts[li]!
    return { offset: this.base.start + offset, line: this.base.startLine + li, col }
  }

  private span(from: number, to: number): Span {
    const a = this.position(from)
    const b = this.position(Math.max(from, to))
    return { start: a.offset, end: b.offset, startLine: a.line, startCol: a.col, endLine: b.line, endCol: b.col }
  }

  private tokSpan(t: Tok): Span {
    return this.span(t.offset, t.offset + t.length)
  }

  /** An empty slot has no text; it is reported at the token that shows it is empty, zero-width. */
  private emptySpan(t: Tok): Span {
    return this.span(t.offset, t.offset)
  }

  private name(t: Tok): NetworkName {
    return { text: t.text, span: this.tokSpan(t) }
  }

  private err(t: Tok, code: NetworkDiagnosticCode, message: string): ParseError {
    return new ParseError(code, message, t.offset, Math.max(1, t.length))
  }

  private report(e: ParseError): void {
    this.diag(e.code, e.message, this.span(e.offset, e.offset + e.length))
  }

  private diag(code: NetworkDiagnosticCode, message: string, span: Span): void {
    this.diagnostics.push({ code, message, span })
  }
}

/** The operator a token spells, as a group compares it: a word upper-cased, a symbol as written. */
function operatorSymbol(t: Tok): string {
  return t.kind === "word" ? t.text.toUpperCase() : t.text
}

/** A span the ST lexer gave relative to a slice, moved to where the slice stands in the document. */
function shift(s: Span, at: { offset: number; line: number; col: number }): Span {
  return {
    start: at.offset + s.start,
    end: at.offset + s.end,
    startLine: at.line + s.startLine - 1,
    startCol: s.startLine === 1 ? at.col + s.startCol : s.startCol,
    endLine: at.line + s.endLine - 1,
    endCol: s.endLine === 1 ? at.col + s.endCol : s.endCol,
  }
}

// ── a wire's type, read off its producer (`NetworkSpelling`) ────────────────────────────────────

const BOOL = "BOOL"
/** IEC ANY_BIT: an AND/OR/XOR/NOT box is bitwise on any of them. */
const BIT_STRINGS: ReadonlySet<string> = new Set(["BOOL", "BYTE", "WORD", "DWORD", "LWORD"])
/** A group's operator → its box type: the lexer's table (`SYMBOL_TO_TYPE`), the one the group's operator was accepted
 *  by (`isOperator`), so a miss is a drift between the two and fails loudly rather than naming a box by its symbol. */
function operatorType(op: string): string {
  const type = SYMBOL_TO_TYPE.get(op)
  if (type === undefined) throw new Error(`network text: the group operator '${op}' has no box type in the lexer's table`)
  return type
}

/** What a producer says of a wire's type: an exact type, "BOOL or another bit string", or nothing. */
interface Produced {
  exact?: string
  anyBit?: boolean
}

/** A box's word on its output, with no stored output type (the text carries none). */
function boxProduces(type: string): Produced {
  const t = type.toUpperCase()
  if (COMPARISON_FUNCTIONS.has(t)) return { exact: BOOL }
  if (BIT_OPERATOR_FUNCTIONS.has(t)) return { anyBit: true }
  return {}
}

/** A type as the comparison reads it: its tokens, not its layout (`STRING (80)` is `STRING(80)`). */
const typeKey = (t: string): string => t.replace(/\s+/g, "").toUpperCase()

/** How `p` disagrees with a DECLARED type — what the producer says instead — or undefined (`NetworkSpelling.Disagreement`). */
function disagreement(p: Produced, declared: string): string | undefined {
  if (p.exact !== undefined) return typeKey(p.exact) === typeKey(declared) ? undefined : p.exact
  return p.anyBit === true && !BIT_STRINGS.has(typeKey(declared))
    ? "a bit operator, whose result is BOOL or another bit string (BYTE, WORD, DWORD, LWORD)"
    : undefined
}
