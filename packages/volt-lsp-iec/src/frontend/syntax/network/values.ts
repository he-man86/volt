/**
 * The reader's VALUES — an operand, a group, the NOT modifier and the edge flags, and what a bare token resolves to (a
 * wire reference, a variable, a target). A call, PARALLEL and EXECUTE are values too; they are `calls.ts`'s, which
 * builds on this file. Whether a pair after a word is its argument list or a group is `pair-kind.ts`'s.
 */
import type { Expr } from "../ast/nodes/index.js"
import type { NetworkCall, NetworkExecute, NetworkName, NetworkNestedAssign, NetworkParallel, NetworkTarget, NetworkValue } from "./ast.js"
import { NetworkCursor, type ParseError, type PVal, IDENTIFIER, isName } from "./cursor.js"
import { OPERATOR_HEADS, type Tok, isOperator, isSym, isWord } from "./lexer.js"
import { argumentListAhead, isEmptyAt, isPinNameAt, isStorageAt } from "./pair-kind.js"
import { CONSTRUCT_WORDS, NETWORK_TEXT_WORDS } from "./words.js"

const STRUCTURAL = new Set([",", ")", "(", ";", ":=", "=>", ".", ":"])

export abstract class ValueReader extends NetworkCursor {
  /** A call's pins after its `(`, the `)`, and an optional suffix (`calls.ts`). */
  protected abstract parseCall(head: Tok, consumed: boolean, first: PVal | undefined, unnamedType?: NetworkName): NetworkCall
  /** `PARALLEL(…)` (`calls.ts`). */
  protected abstract parseParallel(): NetworkParallel
  /** `EXECUTE … END_EXECUTE` (`calls.ts`). */
  protected abstract parseExecute(consumed: boolean): NetworkExecute

  /** @param consumed whether something consumes this value — as opposed to a top-level item whose output goes nowhere.
   *  @param defer keep a bare token unresolved: it may turn out to be a target or a pin's name. */
  protected parseValue(consumed: boolean, defer = false): PVal {
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
    if (isWord(n, "NOT") && !argumentListAhead(this.lx)) {
      not = this.next()
      n = this.peek()
      if (isWord(n, "NOT") && !argumentListAhead(this.lx))
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
          // THE THIRD PAIR KIND (S2): a target and a storage operator at the pair's own depth — an assignment below
          // the top level. `(R = x)` stays a comparison: storage is decided after a target.
          const first = this.parseValue(true, true)
          if (first.bare !== undefined && this.atStorage()) return { node: this.parseNestedAssign(t, first), start: t }
          return { node: this.parseGroupRest(t, this.resolve(first)), start: t }
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
    const pragmas = this.readPragmas()
    return { kind: "group", op: sym, operands, ...(pragmas !== undefined ? { pragmas } : {}), span: this.span(open.offset, this.lastEnd) }
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

  /** `(t1 := t2 S= … value)` after its `(` and first target (S2, the bridge's `ParseNestedAssign`): one Assign item
   *  below the top level. A wire is defined only by a statement of its own. */
  private parseNestedAssign(open: Tok, first: PVal): NetworkNestedAssign {
    const targets: NetworkTarget[] = []
    let cur = first
    let value: NetworkValue
    for (;;) {
      const bare = cur.bare
      if (bare === undefined)
        throw this.err(cur.start, "NETWORK_BAD_EXPRESSION", "an assignment target is one variable: a token, or text between backticks.")
      const w = bare.kind === "word" ? this.wires.get(bare.text.toUpperCase()) : undefined
      if (w !== undefined)
        throw this.err(
          bare,
          "NETWORK_BAD_EXPRESSION",
          `the wire ${w.wire.name.text} is defined inside an assignment's pair; a wire's definition is its own statement \`${w.wire.name.text} := value;\`.`,
        )
      const op = this.takeStorage()
      targets.push(this.target(bare, op.text as NetworkTarget["op"]))
      const v = this.parseValue(true, true)
      if (v.bare !== undefined && this.atStorage()) {
        cur = v
        continue
      }
      value = this.resolve(v)
      break
    }
    if (!isSym(this.peek(), ")"))
      throw this.err(this.peek(), "NETWORK_PARSE", `'${this.peek().text}' in an assignment's pair: \`(t := value)\` closes after its value.`)
    this.next()
    return { kind: "nested_assign", targets, value, span: this.span(open.offset, this.lastEnd) }
  }

  /** A storage operator next (`pair-kind.ts` `isStorageAt`): `:=`, or ExST's `S=` / `R=`. */
  protected atStorage(): boolean {
    return isStorageAt(this.peek(), this.lx)
  }

  /** The storage operator `atStorage` found, as one token `:=`, `S=` or `R=` spanning both parts. */
  protected takeStorage(): Tok {
    const t = this.next()
    if (isSym(t, ":=")) return t
    const eq = this.next()
    return { kind: "sym", text: `${t.text.toUpperCase()}=`, offset: t.offset, length: eq.offset + eq.length - t.offset, atLineStart: t.atLineStart }
  }

  // ── operands ────────────────────────────────────────────────────────────────────────────────

  protected resolve(v: PVal): NetworkValue {
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
    // A word no VAR_TEMP declares is a variable, whatever its shape: whether it is declared is the build's question
    // (bridge-refusal-review 1.3, `rcc_network_undeclared_wire_shape`), and only this network's own block makes a name
    // a wire. A wire spelled again as another name is no finding either (2.11): the writer names its wires around
    // every other name on the next pull.
    if (t.kind === "word") this.readAsAVariable(t)
    const unnamed = t.kind === "unnamed"
    const backticked = t.kind === "backtick"
    const expr = unnamed ? undefined : backticked ? this.stExpr(t.offset + 1, t.offset + t.length - 1) : this.stExpr(t.offset, t.offset + t.length)
    return { kind: "operand", text: t.text, backticked, unnamed, ...(expr !== undefined ? { expr } : {}), span: this.tokSpan(t) }
  }

  /** An assignment target (`op` its storage operator) or a `=>` pin's (no operator): a token or backticked text. */
  protected target(t: Tok, op?: NetworkTarget["op"]): NetworkTarget {
    switch (t.kind) {
      case "word":
        if (NETWORK_TEXT_WORDS.has(t.text.toUpperCase()))
          throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target spelled like a keyword of the text is written between backticks.`)
        this.readAsAVariable(t)
        return this.targetOf(t, op, this.stExpr(t.offset, t.offset + t.length))
      case "backtick":
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

  /** A bare word read as a variable, remembered at its first reading (`declare`'s late-block rule). */
  private readAsAVariable(t: Tok): void {
    const key = t.text.toUpperCase()
    if (!this.readAsVariable.has(key)) this.readAsVariable.set(key, t)
  }

  /** Whether a POU or FB instance in scope carries a construct word (`NetworkSpelling.ConstructTaken`). */
  protected constructTaken(word: string): boolean {
    return (
      this.scope !== undefined &&
      CONSTRUCT_WORDS.has(word.toUpperCase()) &&
      (this.scope.isPou(word) || this.scope.instanceType(word) !== undefined)
    )
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

  // ── what a position holds (`pair-kind.ts`), asked of the lexer standing after the lookahead ──

  protected isEmptyHere(t: Tok): boolean {
    return isEmptyAt(t, this.lx)
  }

  protected isPinName(t: Tok): boolean {
    return isPinNameAt(t, this.lx)
  }
}

/** The operator a token spells, as a group compares it: a word upper-cased, a symbol as written. */
function operatorSymbol(t: Tok): string {
  return t.kind === "word" ? t.text.toUpperCase() : t.text
}
