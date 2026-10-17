/**
 * The reader's ITEMS and VALUES (`parser.ts` composes the reader): an item's coils, a split's definition, a slot and its
 * bracket rule, an operand and its modifiers, the bracket. Recursive descent: whether something consumes a value is passed
 * down from its parent.
 */
import type { NetworkName, NetworkNestedAssign, NetworkNestedSplit, NetworkSplitDef, NetworkTarget, NetworkTextStatement, NetworkValue } from "./ast.js"
import { BoxReader, type BoxSyn, type Syn, isWordOrMoveCall } from "./boxes.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { type Mods, endsOperand, isBoxNode, isBoxWord, isSplitWord, isStorage, isTargetToken } from "./tokens.js"
import { IDENTIFIER, SPLIT_PREFIX, SPLIT_SHAPE, isLiteral, isReserved } from "./words.js"

export abstract class ValueReader extends BoxReader {
  // ── items ───────────────────────────────────────────────────────────────────────────────────

  /** One item: `[top] ;` — a coil list and its value, a split's definition, or a value. */
  protected parseItem(): NetworkTextStatement {
    const first = this.raw(this.p)
    this.itemStart = this.p
    this.itemColumn = this.column(first)
    try {
      if (isSym(first, ";")) {
        this.next()
        return { kind: "empty", span: this.tokSpan(first) }
      }
      if (isSym(first, "(") && (this.coilAt(1) || this.splitDefinitionAt(1)))
        throw this.err(
          first,
          "NETWORK_BAD_EXPRESSION",
          "a redundant bracket: an item's own assignment or split is not bracketed, `x := a;` — a nested one is, `y := (x := a);`.",
        )
      let s: NetworkTextStatement
      if (this.coilAt(0)) {
        const a = this.parseAssign(first)
        s = { kind: "assign", targets: a.targets, value: a.value, span: a.span }
      } else if (this.splitDefinitionAt(0)) {
        const d = this.parseSplitDefinition(first)
        s = { kind: "split_def", split: d.split, value: d.value, span: d.span }
      } else {
        const value = this.slot(false, first)
        s = { kind: "value", value, span: this.spanFrom(first) }
      }
      const end = this.peek()
      if (!isSym(end, ";")) throw this.unexpected(end, "an item ends with `;`")
      this.next()
      return s
    } finally {
      this.itemStart = -1
    }
  }

  /** A COIL starts `k` ahead: `[R_EDGE|F_EDGE] [NOT] head` and its storage, `:=`, `S=` or `R=`; the head a target,
   *  `JMP label` or `RETURN`. */
  protected coilAt(k: number): boolean {
    if (isWord(this.peekAt(k), "R_EDGE") || isWord(this.peekAt(k), "F_EDGE")) k++
    if (isWord(this.peekAt(k), "NOT")) k++
    const t = this.peekAt(k)
    if (isWord(t, "JMP")) k += 2
    else if (isWord(t, "RETURN")) k += 1
    else if (isTargetToken(t) || (isSplitWord(t) && !isSym(this.peekAt(k + 1), ":="))) k += 1 // a split as a coil: refused by name
    else return false
    return isStorage(this.peekAt(k))
  }

  protected splitDefinitionAt(k: number): boolean {
    const t = this.peekAt(k)
    return isSplitWord(t) && isSym(this.peekAt(k + 1), ":=")
  }

  /** `coil coil … value` — ONE vendor Assign, its coils in order, the value after the last. */
  protected parseAssign(first: Tok): { targets: NetworkTarget[]; value: NetworkValue; span: NetworkNestedAssign["span"] } {
    const targets: NetworkTarget[] = []
    while (this.coilAt(0)) targets.push(this.parseCoil())
    const value = this.coilValue()
    return { targets, value, span: this.spanFrom(first) }
  }

  /** A coil's or a split's value: nothing (the empty slot) where the item or bracket ends. */
  protected coilValue(): NetworkValue {
    const t = this.peek()
    if (isSym(t, ";") || isSym(t, ")") || t.kind === "eof") return { kind: "empty_slot", span: this.emptySpan(t) }
    return this.slot(true, t)
  }

  protected parseCoil(): NetworkTarget {
    const start = this.peek()
    const mods: Mods = {}
    if (isWord(this.peek(), "R_EDGE") || isWord(this.peek(), "F_EDGE")) mods.edge = isWord(this.next(), "R_EDGE") ? "rising" : "falling"
    if (isWord(this.peek(), "NOT")) {
      this.next()
      mods.negated = true
    }
    let target: NetworkTarget
    const h = this.next()
    if (isWord(h, "JMP")) {
      const l = this.next()
      if (l.kind !== "word" || !IDENTIFIER.test(l.text)) throw this.err(l, "NETWORK_BAD_EXPRESSION", "JMP takes one label, an identifier.")
      target = { text: l.text, jump: true, backticked: false, unnamed: false, span: this.tokSpan(l) }
    } else if (isWord(h, "RETURN")) target = { text: "RETURN", ret: true, backticked: false, unnamed: false, span: this.tokSpan(h) }
    else target = this.targetNode(this.checkedTarget(h))

    const op = this.next()
    const storage = op.text as ":=" | "S=" | "R="
    // The vendor spells a coil kind with two bits, Negation and Set: a negated set coil IS the reset coil, and a negated
    // reset coil none it holds apart from it.
    if (mods.negated !== undefined && storage === "S=")
      throw this.err(start, "NETWORK_BAD_EXPRESSION", `\`NOT ${target.text} S=\`: the IDE stores a negated set coil as the reset coil — write \`${target.text} R= …\`.`)
    if (mods.negated !== undefined && storage === "R=")
      throw this.err(start, "NETWORK_BAD_EXPRESSION", `\`NOT ${target.text} R=\`: a negated reset coil is no coil the IDE stores apart from the reset coil.`)
    return { ...target, op: storage, ...mods }
  }

  /** `split<n> := value` — the split's one definition. */
  protected parseSplitDefinition(first: Tok): { split: NetworkName; value: NetworkValue; span: NetworkSplitDef["span"] } {
    const name = this.next()
    this.splitId(name)
    this.next() // :=
    const value = this.coilValue()
    return { split: this.name(name), value, span: this.spanFrom(first) }
  }

  protected splitId(name: Tok): number {
    const digits = name.text.slice(SPLIT_PREFIX.length)
    if (digits.length > 1 && digits[0] === "0")
      throw this.err(name, "NETWORK_BAD_EXPRESSION", `the split ${name.text}: its number is the VarId, with no leading zeros.`)
    const id = Number(digits)
    if (!Number.isSafeInteger(id) || id > 2147483647) throw this.err(name, "NETWORK_BAD_EXPRESSION", `the split ${name.text} carries a VarId out of range.`)
    return id
  }

  // ── values ──────────────────────────────────────────────────────────────────────────────────

  /**
   * A SLOT — a coil's or a split's value, a pin, an EN source, a branch: a box (its word, MOVE, a call or an EXECUTE, each
   * with its outputs and pin state), a parallel, a term, or a bracketed assignment or split. A bracket around anything
   * else is redundant: no tree prints it.
   */
  protected slot(consumed: boolean, at: Tok): NetworkValue {
    const s = this.compound(consumed)
    if (s.empty)
      throw isWord(at, "ENO") || isWord(at, "EN") || isSym(at, "=>") || isWord(at, "SHORTCIRCUIT")
        ? this.unexpected(at, "a value is expected here")
        : this.err(at, "NETWORK_PARSE", "a value is expected here.")
    if (s.bracketed && s.node?.kind !== "nested_assign" && s.node?.kind !== "nested_split")
      throw this.err(
        s.start,
        "NETWORK_BAD_EXPRESSION",
        "a redundant bracket: brackets mark a compound as another word's operand, after a modifier, or a nested assignment — a slot holds one box bare.",
      )
    return this.built(s, consumed)
  }

  /** What a slot or a bracket holds — `slot` without its bracket rule. */
  protected compound(consumed: boolean): Syn {
    const start = this.peek()
    if (isWord(start, "BRANCH")) return { node: this.parseParallel(undefined, start), start, empty: false, bracketed: false }
    if (isWord(start, "MOVE")) return { node: this.parseMove(consumed), start, empty: false, bracketed: false }
    if (isWord(start, "EXECUTE")) return { node: this.parseExecute(consumed), start, empty: false, bracketed: false }

    const first = this.operand()
    const t = this.peek()
    if (isBoxWord(t)) return { node: this.parseWordBox(first, consumed), start: first.empty ? t : first.start, empty: false, bracketed: false }
    if (isWord(t, "BRANCH")) {
      if (first.empty) throw this.err(t, "NETWORK_PARSE", "BRANCH with an empty feed before it: an unfed parallel is `BRANCH (a, b)` alone.")
      const feed = this.built(first, true)
      return { node: this.parseParallel(feed, first.start), start: first.start, empty: false, bracketed: false }
    }
    if (first.call !== undefined && !first.bracketed && first.mods === undefined) {
      const call: BoxSyn = first.call
      this.pinState(call)
      return { node: this.finalize(call, consumed), start: first.start, empty: false, bracketed: false }
    }
    return first
  }

  protected built(s: Syn, consumed: boolean): NetworkValue {
    if (s.call === undefined) return s.node!
    const box = this.finalize(s.call, consumed)
    return s.mods !== undefined ? this.wrap(box, s.mods.flags, s.mods.at) : box
  }

  /** `v` under its modifiers: the edge around the negation (N17). */
  protected wrap(v: NetworkValue, mods: Mods, at: Tok): NetworkValue {
    const span = this.spanFrom(at)
    const negated: NetworkValue = mods.negated === true ? { kind: "not", operand: v, span } : v
    return mods.edge !== undefined ? { kind: "edge", rising: mods.edge === "rising", operand: negated, span } : negated
  }
  /**
   * An OPERAND — a word's input, MOVE's, a parallel's feed, a positional pin: a term (a leaf, a call with no pin state, a
   * split, `[mods] x`, `mods (box)`, the negated empty slot `NOT`), a bracketed compound, or nothing.
   */
  protected operand(): Syn {
    const t = this.peek()
    if (endsOperand(t)) return { start: t, empty: true, bracketed: false }
    if (isWord(t, "NOT") || isWord(t, "R_EDGE") || isWord(t, "F_EDGE")) return this.modified(t)
    if (isSym(t, "(")) return this.bracket()
    switch (t.kind) {
      case "word":
        return this.wordOperand(t)
      case "backtick":
        this.next()
        if (isSym(this.peek(), "(") || isSym(this.peek(), ":")) return this.call(t)
        if (isLiteral(t.text)) throw this.err(t, "NETWORK_BAD_EXPRESSION", `a literal between backticks: write it bare, ${t.text}.`)
        return this.leaf(t)
      case "unnamed":
        this.next()
        if (isSym(this.peek(), ":")) return this.call(t)
        if (isSym(this.peek(), "(")) throw this.err(t, "NETWORK_BAD_EXPRESSION", "??? is no call head; an unnamed instance is written `??? : TYPE(…)`.")
        return this.leaf(t)
      case "number":
      case "typed":
      case "address":
      case "sstring":
      case "dstring":
        this.next()
        if (isSym(this.peek(), "(")) throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' is a literal and no call head.`)
        return this.leaf(t)
      case "error":
        throw this.err(t, (t.code ?? "NETWORK_PARSE") as never, t.text)
      default: {
        const old = this.oldSymbol(t)
        if (old !== undefined) throw old
        if (this.isMissingSemicolon(t)) throw this.missingSemicolon(t)
        throw this.err(
          t,
          "NETWORK_PARSE",
          t.kind === "eof"
            ? "the item ends here: a value is expected."
            : `'${t.text}' where a value is expected: an operand that is not one token is written between backticks.`,
        )
      }
    }
  }

  /** `[R_EDGE|F_EDGE] [NOT]` and what it modifies: a leaf, a call with no pin state, a bracketed box, or nothing (the
   *  negated empty slot). Before `EN` it is the EN pin's own modifier, and the operand is empty. */
  private modified(t: Tok): Syn {
    const { flags: mods, count } = this.modifiersAt(0)
    const after = this.peekAt(count)
    if (isWord(after, "EN")) return { start: t, empty: true, bracketed: false }
    for (let k = 0; k < count; k++) this.next()
    if (endsOperand(after)) return { node: this.wrap({ kind: "empty_slot", span: this.emptySpan(after) }, mods, t), start: t, empty: false, bracketed: false }
    if (isWord(after, "NOT") || isWord(after, "R_EDGE") || isWord(after, "F_EDGE"))
      throw this.err(after, "NETWORK_BAD_EXPRESSION", "a modifier after a modifier: a node carries one edge and one negation, `R_EDGE NOT x` — the edge first.")
    if (isSym(after, "(")) {
      const inner = this.bracket()
      const n = inner.node!
      if (n.kind === "parallel") throw this.err(t, "NETWORK_UNSUPPORTED", "a modifier on a parallel: the IDE holds no flag on a parallel (N20).")
      if (n.kind === "nested_assign" || n.kind === "nested_split")
        throw this.err(t, "NETWORK_UNSUPPORTED", "a modifier on an assignment or a split: the IDE holds no flag on either (N20, census 1.1).")
      if (n.kind === "not" || n.kind === "edge")
        throw this.err(inner.start, "NETWORK_BAD_EXPRESSION", "a modifier after a modifier: a node carries one edge and one negation, `R_EDGE NOT x` — the edge first.")
      if (!isBoxNode(n))
        throw this.err(
          inner.start,
          "NETWORK_BAD_EXPRESSION",
          "a redundant bracket: after a modifier a box is bracketed, and a single operand or a call is not — `NOT x`, `NOT f(a)`.",
        )
      return { node: this.wrap(n, mods, t), start: t, empty: false, bracketed: false }
    }
    const core = this.operand()
    if (core.node?.kind === "split_ref")
      throw this.err(t, "NETWORK_UNSUPPORTED", "a modifier on a split: the IDE holds no flag on a split (N20) — put it on its feeder or a consumer.")
    if (core.call !== undefined) {
      const m = this.modifiersAt(0)
      if (isWord(this.peek(), "ENO") || isWord(this.peekAt(m.count), "EN"))
        throw this.err(
          this.peek(),
          "NETWORK_BAD_EXPRESSION",
          "a pin state after a modified call: a box with EN or ENO after a modifier is bracketed, `NOT (f(a) EN c)`.",
        )
      return { call: core.call, mods: { flags: mods, at: t }, start: t, empty: false, bracketed: false }
    }
    if (core.node?.kind === "operand") return { node: this.wrap(core.node, mods, t), start: t, empty: false, bracketed: false }
    throw this.err(t, "NETWORK_BAD_EXPRESSION", "a modifier stands before an operand, a call or a bracketed box.")
  }

  /** A word at operand position: a split's reference, a call's head, or a leaf — never a word of the text. */
  private wordOperand(t: Tok): Syn {
    if (SPLIT_SHAPE.test(t.text)) {
      this.next()
      if (isSym(this.peek(), "(")) throw this.err(t, "NETWORK_BAD_EXPRESSION", `${t.text} is a split, never a call head.`)
      if (isSym(this.peek(), ":="))
        throw this.err(t, "NETWORK_BAD_EXPRESSION", `a split defined where a value stands is bracketed, \`(${t.text} := value)\`.`)
      if (isSym(this.peek(), ":"))
        throw this.err(
          this.peek(),
          "NETWORK_BAD_EXPRESSION",
          `a type on the split ${t.text}: a split's type is its feeder's and is never written — \`${t.text} := value;\`.`,
        )
      this.splitId(t)
      return { node: { kind: "split_ref", name: this.name(t), span: this.tokSpan(t) }, start: t, empty: false, bracketed: false }
    }
    if (isWord(t, "JMP") || isWord(t, "RETURN"))
      throw this.err(t, "NETWORK_BAD_EXPRESSION", "a jump or a return is a coil, its value after it: `JMP l := c;`, `RETURN := ;` (C11).")
    if (isWord(t, "MOVE") || isWord(t, "EXECUTE"))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `${t.text.toUpperCase()} as an operand: a box that is another word's operand stands in brackets, \`x AND (${t.text.toUpperCase()} …)\`.`,
      )
    if (isReserved(t.text))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `'${t.text}' at operand position: a name spelled like a word of the text is written between backticks, \`${t.text}\`.`,
      )
    this.next()
    if (isSym(this.peek(), "(") || isSym(this.peek(), ":")) return this.call(t)
    if (isSym(this.peek(), ".") && isWord(this.peekAt(1), "ENO")) throw this.oldEno(this.peek())
    return this.leaf(t)
  }

  /** `( compound )` as an operand: a box with its outputs and pin state, a parallel, an assignment or a split. A term in
   *  brackets — a leaf, a call with no pin state — is redundant. */
  protected bracket(): Syn {
    const open = this.next()
    if (this.coilAt(0) || this.splitDefinitionAt(0)) {
      const first = this.peek()
      let nested: NetworkNestedAssign | NetworkNestedSplit
      if (this.coilAt(0)) {
        const a = this.parseAssign(first)
        this.expectClose("an assignment's bracket `(t := value)` closes after its value")
        nested = { kind: "nested_assign", targets: a.targets, value: a.value, span: this.spanFrom(open) }
      } else {
        const d = this.parseSplitDefinition(first)
        this.expectClose("an assignment's bracket `(t := value)` closes after its value")
        nested = { kind: "nested_split", split: d.split, value: d.value, span: this.spanFrom(open) }
      }
      return { node: nested, start: open, empty: false, bracketed: true }
    }
    const inner = this.compound(true)
    if (inner.empty) throw this.err(open, "NETWORK_PARSE", "an empty bracket: a value is expected in it.")
    this.expectClose("a bracket closes after the compound it holds")
    const n = inner.node
    if (inner.call !== undefined || n === undefined || n.kind === "operand" || n.kind === "empty_slot" || n.kind === "split_ref" ||
        n.kind === "not" || n.kind === "edge" || inner.bracketed)
      throw this.err(
        open,
        "NETWORK_BAD_EXPRESSION",
        "a redundant bracket: brackets hold a box (a word, MOVE, an EXECUTE, a call with EN or ENO), a parallel, an assignment or a split — nothing else.",
      )
    if (n.kind === "call" && n.en === undefined && !isWordOrMoveCall(n))
      throw this.err(
        open,
        "NETWORK_BAD_EXPRESSION",
        "a redundant bracket: a call carries its own brackets, `x AND f(a)` — only a call with EN or ENO is bracketed as an operand.",
      )
    return { node: n, start: open, empty: false, bracketed: true }
  }

  protected leaf(t: Tok): Syn {
    const expr = this.tokExpr(t)
    return {
      node: { kind: "operand", text: t.text, backticked: t.kind === "backtick", unnamed: t.kind === "unnamed", ...(expr !== undefined ? { expr } : {}), span: this.tokSpan(t) },
      start: t,
      empty: false,
      bracketed: false,
    }
  }
}
