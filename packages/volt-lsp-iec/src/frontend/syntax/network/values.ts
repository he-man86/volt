/**
 * The reader's VALUES — a port of the bridge reader's `ParseLevel` … `Finalize` (`NetworkTextReader.cs`, openspec
 * ld-fbd-coverage 2R.3): one BRACKET LEVEL (P4) — a box word with its operands, MOVE and its operand, a parallel, or one
 * operand — each with its `=>` pins and its `EN` tail; an operand (a leaf, a split, `ENO`, a call, `NOT x`, an edge, a
 * bracket); the bracket rules (B5, P4); and a box given its ROLE — a top-level item, an open line a later `ENO` takes, or
 * a value — the one place the refusals that depend on the role are raised. The same messages at the same tokens, so what
 * the editor underlines is what the push refuses.
 */
import type { NetworkCall, NetworkExecute, NetworkValue, NetworkWordBox } from "./ast.js"
import { type Syn, enabledComparison, isEmptyValue, syn } from "./boxes.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { TargetReader } from "./targets.js"
import { CONSTRUCT_WORDS, OPERATOR_WORDS, SPLIT_SHAPE, TWO_INPUT_OPERATORS, isLiteral, isReserved, UNMEASURED_NEGATED_EMPTY } from "./words.js"

/** One item's OPEN LINES (P3): each line without `;` hands its root box to the queue, and each `ENO` takes the oldest one
 *  not yet taken. */
interface OpenLine {
  box: NetworkWordBox | NetworkCall | NetworkExecute
  at: Tok
}

export abstract class ValueReader extends TargetReader {
  protected open: OpenLine[] = []
  /** The token index where a negated empty slot is a coil's value, `x := NOT ;` — the one place it is measured; -1 none. */
  protected negatedEmptyAt = -1

  protected abstract parseCall(head: Tok, unnamedType: Tok | undefined, operatorCall: boolean, type: string | undefined): Syn

  // ── one bracket level ───────────────────────────────────────────────────────────────────────

  protected parseLevel(): Syn {
    const start = this.peek()
    if (isWord(start, "BRANCH")) {
      if (!isSym(this.peekAt(1), "("))
        throw this.err(start, "NETWORK_PARSE", "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)` — a BRANCH line is gone (B8, P12).")
      this.next()
      return this.parseParallel(undefined, start, start)
    }
    if (isWord(start, "MOVE") && (!isSym(this.peekAt(1), "(") || this.moveOperandBracket())) return this.parseMove(start)

    const first = this.parseOperand()
    const t = this.peek()

    if (t.kind === "word" && OPERATOR_WORDS.has(t.text.toUpperCase())) return this.parseWordLevel(first, t)

    if (isWord(t, "MOVE"))
      throw this.err(t, "NETWORK_BAD_EXPRESSION", "`a MOVE b` is not network text: MOVE writes its target as an output pin, `MOVE b => a` (B2, P12).")

    if (isWord(t, "BRANCH")) {
      if (first.empty) throw this.err(t, "NETWORK_PARSE", "BRANCH with an empty feed before it: an unfed parallel is `BRANCH (a, b)` alone (B8).")
      if (first.node?.kind === "empty_slot") throw this.err(t, "NETWORK_UNSUPPORTED", "a parallel fed by the empty terminator (B8, P6).")
      if (!isSym(this.peekAt(1), "(")) throw this.err(t, "NETWORK_PARSE", "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)` (B8).")
      const feed = this.operand(first)
      this.next()
      return this.parseParallel(feed, first.start, t)
    }

    if (first.box !== undefined && !first.bracketed) {
      this.parseEn(first.box)
      first.box.to = this.lastEnd()
    } else if (isWord(t, "EN") && !first.empty)
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        first.bracketed
          ? "EN after a bracket: EN belongs to the box of its own bracket level — write it inside the brackets (P4)."
          : "EN after a value that is no box: EN follows the box it enables (B3).",
      )
    return first
  }

  /** B2: `MOVE b => a EN c`. */
  private parseMove(start: Tok): Syn {
    this.next()
    const operand = this.parseOperand()
    if (operand.empty || (operand.node !== undefined && isEmptyValue(operand.node)))
      throw this.err(start, "NETWORK_BAD_EXPRESSION", "MOVE takes one operand (B2); an empty input is `MOVE(IN := , => x)` (P5).")
    const box = this.newBox("word", "MOVE", start, start)
    const value = this.operand(operand)
    box.operands.push(value)
    box.inputs.push({ value, negated: false })
    if (this.peek().kind === "word" && OPERATOR_WORDS.has(this.peek().text.toUpperCase()))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "a box word after MOVE's operand: MOVE takes ONE operand — bracket a box (B2, P4).")
    if (isWord(this.peek(), "BRANCH"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "BRANCH after MOVE's operand: a parallel as MOVE's operand stands in brackets (B8, P4).")
    this.parseArrows(box)
    this.parseEn(box)
    box.to = this.lastEnd()
    return syn(start, { box, word: true })
  }

  /** B1: `a ADD b ADD c` — one word, one box, n inputs. */
  private parseWordLevel(first: Syn, t: Tok): Syn {
    if (first.empty || (first.node !== undefined && isEmptyValue(first.node)))
      throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' with no operand before it.`)
    const word = t.text.toUpperCase()
    const box = this.newBox("word", word, t, first.start)
    const add = (v: NetworkValue): void => {
      box.operands.push(v)
      box.inputs.push({ value: v, negated: false })
    }
    add(this.operand(first))
    for (let w = this.peek(); w.kind === "word" && OPERATOR_WORDS.has(w.text.toUpperCase()); w = this.peek()) {
      if (w.text.toUpperCase() !== word)
        throw this.err(
          w,
          "NETWORK_BAD_EXPRESSION",
          `'${word}' and '${w.text.toUpperCase()}' at one bracket level: one word = one box, so brackets separate boxes — \`a ${word} (b ${w.text.toUpperCase()} c)\` (B1, P4).`,
        )
      this.next()
      const op = this.parseOperand()
      if (op.empty || (op.node !== undefined && isEmptyValue(op.node))) throw this.err(w, "NETWORK_BAD_EXPRESSION", `'${word}' with no operand after it.`)
      add(this.operand(op))
    }
    if (isWord(this.peek(), "MOVE"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "MOVE inside another word's level: MOVE is a box of its own, bracketed (B2, P4).")
    if (isWord(this.peek(), "BRANCH"))
      throw this.err(
        this.peek(),
        "NETWORK_BAD_EXPRESSION",
        "BRANCH after a box word at its level: a feed that is a box word is bracketed, `(a AND b) BRANCH (x, y)` (B8, P4).",
      )
    if (TWO_INPUT_OPERATORS.has(word) && box.inputs.length > 2)
      throw this.err(
        t,
        "NETWORK_UNSUPPORTED",
        `${word} takes 2 inputs, and this one holds ${box.inputs.length}: the build refuses it ("needs exactly '2' operands", C3) — bracket one box per two operands (B1).`,
      )
    this.parseArrows(box)
    this.parseEn(box)
    box.to = this.lastEnd()
    return syn(first.start, { box, word: true })
  }

  /** B8, P6: the parallel's branch list after `BRANCH` — a bracketed comma list of slots, at least two, none empty — and
   *  its mode: `SHORTCIRCUIT` where it is not the editor's. */
  private parseParallel(feed: NetworkValue | undefined, start: Tok, branch: Tok): Syn {
    const open = this.next()
    if (!isSym(open, "(")) throw this.err(open, "NETWORK_PARSE", "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)` (B8).")
    const branches: NetworkValue[] = []
    if (isSym(this.peek(), ")")) throw this.err(this.peek(), "NETWORK_UNSUPPORTED", "a parallel with no branch: `BRANCH ()` holds none (B8, P6).")
    for (;;) {
      // 2R.5 (readability Open c): an EMPTY branch stores, builds and runs (a shorted branch, CODESYS SP21) — nothing
      // between its commas.
      const at = this.peek()
      branches.push(isSym(at, ",") || isSym(at, ")") ? { kind: "empty_slot", span: this.emptySpan(at) } : this.slot(this.parseLevel(), at))

      const sep = this.peek()
      if (isSym(sep, ",")) {
        this.next()
        continue
      }
      if (isSym(sep, ")")) {
        this.next()
        break
      }
      throw this.unexpected(sep, "a parallel's branches are separated by `,` and closed by `)`")
    }
    if (branches.length === 1)
      throw this.err(
        open,
        "NETWORK_UNSUPPORTED",
        "a parallel with one branch: it pushes, and does not compile (C0023) — write the branch as the value itself (B8, P6).",
      )
    let shortCircuit = false
    if (isWord(this.peek(), "SHORTCIRCUIT")) {
      this.next()
      shortCircuit = true
    }
    if (isWord(this.peek(), "EN")) throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "EN after a parallel: a parallel is no box, and has no enable (B8).")
    if (isSym(this.peek(), "=>"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "`=>` after a parallel: a parallel is no box, and has no output pin (B8).")
    const node: NetworkValue = {
      kind: "parallel",
      ...(feed !== undefined ? { input: feed } : {}),
      branches,
      shortCircuit,
      branchWord: this.tokSpan(branch),
      span: this.spanFrom(start),
    }
    return syn(start, { node, word: true })
  }

  // ── one operand ─────────────────────────────────────────────────────────────────────────────

  /** One operand of a level: a leaf, a split, `ENO`, a call, `NOT x`, an edge, or a bracket holding a box word, a
   *  parallel or an enabled comparison — never a bare box word. */
  protected parseOperand(): Syn {
    const t = this.peek()
    if (this.atEnd() || isSym(t, ",") || isSym(t, ")") || isSym(t, ";") || t.kind === "snippet") return syn(t, { empty: true })

    if (isWord(t, "NOT")) return this.parseNot(t)
    if (isWord(t, "R_EDGE") || isWord(t, "F_EDGE")) return this.parseEdge(t)

    switch (t.kind) {
      case "sym":
        if (t.text === "(") return this.parseBracket(t)
        break
      case "unnamed": {
        this.next()
        if (isSym(this.peek(), ":")) {
          // `??? : TYPE(…)` — the vendor's unnamed instance, which carries its type because no declaration can.
          this.next()
          const ty = this.next()
          if (ty.kind !== "word" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ty.text))
            throw this.err(ty, "NETWORK_BAD_EXPRESSION", "`??? : TYPE(…)` names the FB type, an identifier.")
          this.expectSym("(", "??? : TYPE(pins)")
          return this.parseCall(t, ty, false, undefined)
        }
        if (isSym(this.peek(), "(")) throw this.err(t, "NETWORK_BAD_EXPRESSION", "??? is no call head; an unnamed instance is written `??? : TYPE(…)`.")
        return this.leaf(t)
      }
      case "word":
        return this.parseWord(t)
      case "backtick":
        this.next()
        if (isSym(this.peek(), "(")) {
          this.next()
          return this.parseCall(t, undefined, false, undefined)
        }
        if (isLiteral(t.text)) throw this.err(t, "NETWORK_BAD_EXPRESSION", `a literal between backticks: write it bare, ${t.text} (P12).`)
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
    }
    const old = this.oldSymbol(t)
    if (old !== undefined) throw old
    throw this.err(
      t,
      "NETWORK_PARSE",
      t.kind === "eof"
        ? "the body ends inside a statement."
        : `'${t.text}' where a value is expected: an operand that is not one token is written between backticks.`,
    )
  }

  private parseNot(t: Tok): Syn {
    const at = this.p
    this.next()
    const n = this.peek()
    if (
      isSym(n, "(") &&
      ((isWord(this.peekAt(1), "IN") && isSym(this.peekAt(2), ":=")) || (isWord(this.peekAt(1), "NOT") && isWord(this.peekAt(2), "IN") && isSym(this.peekAt(3), ":=")))
    ) {
      // P5: `NOT(IN := a)` is the NOT box; `NOT (` + anything else negates that bracket.
      this.next()
      return this.parseCall(t, undefined, true, "NOT")
    }
    if (isWord(n, "R_EDGE") || isWord(n, "F_EDGE"))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `NOT outside ${n.text.toUpperCase()}(…): the IDE negates before it detects the edge, so the one spelling is ${n.text.toUpperCase()}(NOT x).`,
      )
    // 2R.5 (#6a): a negated empty slot, `x := NOT ;` — it stores and builds.
    if (this.atEnd() || isSym(n, ",") || isSym(n, ")") || isSym(n, ";")) {
      if (at !== this.negatedEmptyAt) throw this.err(t, "NETWORK_UNSUPPORTED", UNMEASURED_NEGATED_EMPTY)
      const empty = this.emptySpan(n)
      return syn(t, { node: { kind: "not", operand: { kind: "empty_slot", span: empty }, span: this.span(t.offset, t.offset + t.length) } })
    }
    const inner = this.parseOperand()
    return this.flagged(inner, t, "not")
  }

  private parseEdge(t: Tok): Syn {
    this.next()
    if (CONSTRUCT_WORDS.has(t.text.toUpperCase()) && this.isCallable(t.text))
      throw this.err(
        t,
        "NETWORK_UNSUPPORTED",
        `a POU or instance named ${t.text.toUpperCase()}: the text reads ${t.text.toUpperCase()}(…) as the edge flag, so the call has no spelling.`,
      )
    this.expectSym("(", `${t.text.toUpperCase()}(x)`)
    const inner = this.parseLevel()
    if (inner.empty) throw this.err(t, "NETWORK_UNSUPPORTED", "a flag on an empty slot: an unconnected position has no text to modify.")
    if (inner.bracketed)
      throw this.err(
        inner.start,
        "NETWORK_BAD_EXPRESSION",
        `${t.text.toUpperCase()}((…)): an edge's brackets carry its argument whole — a redundant bracket is refused (P4).`,
      )
    this.expectSym(")", `${t.text.toUpperCase()}(x)`)
    const flagged = this.flagged(inner, t, isWord(t, "R_EDGE") ? "rise" : "fall")
    flagged.word = false
    flagged.bracketed = false
    return flagged
  }

  private parseBracket(t: Tok): Syn {
    this.next()
    // 2R.5 (#20): a split defined below the top level, `(split1 := value)`, in a nested assignment's brackets.
    if (this.peek().kind === "word" && SPLIT_SHAPE.test(this.peek().text) && isSym(this.peekAt(1), ":=")) return syn(t, { node: this.parseNestedSplit(t) })
    // S2: a coil head and a storage operator at the pair's own depth — an assignment below the top level.
    const headEnd = this.coilHeadEnd(this.p)
    if (headEnd > 0 && this.storageAt(headEnd)) return syn(t, { node: this.parseNestedAssign(t) })
    const inner = this.parseLevel()
    if (!isSym(this.peek(), ")")) throw this.unexpected(this.peek(), "a bracket closes after the box it holds")
    this.next()
    if (inner.empty || inner.bracketed || !(inner.word || enabledComparison(inner)))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        "a redundant bracket: brackets mark a box word or a parallel as another word's operand, an enabled comparison, and a nested assignment — nothing else (B5, P4).",
      )
    inner.bracketed = true
    inner.start = t
    if (inner.box !== undefined) inner.box.from = t
    return inner
  }

  private parseWord(t: Tok): Syn {
    if (isWord(t, "ENO")) {
      this.next()
      // P3: the oldest open line of the item not yet taken.
      const line = this.open.shift()
      if (line === undefined)
        throw this.err(
          t,
          "NETWORK_BAD_EXPRESSION",
          "ENO with no open line above it to take: ENO reads the box of the oldest line above it without `;` that no ENO has taken yet (B4, P3).",
        )
      return syn(t, { node: { kind: "eno", box: line.box, span: this.tokSpan(t) } })
    }
    if (SPLIT_SHAPE.test(t.text)) {
      this.next()
      if (isSym(this.peek(), "(")) throw this.err(t, "NETWORK_BAD_EXPRESSION", `${t.text} is a split, never a call head (P9).`)
      const name = this.splitRef(t)
      return syn(t, { node: { kind: "split_ref", name, span: name.span } })
    }
    if ((isWord(t, "MOVE") || OPERATOR_WORDS.has(t.text.toUpperCase())) && isSym(this.peekAt(1), "(")) {
      this.next()
      this.next()
      return this.parseCall(t, undefined, true, t.text)
    }
    if (isWord(t, "PARALLEL") && isSym(this.peekAt(1), "(") && !this.isCallable(t.text))
      throw this.err(
        t,
        "NETWORK_PARSE",
        "PARALLEL(…) is not network text: a parallel is its feed, the word BRANCH and its branches, `feed BRANCH (a, b)` (B8, P12).",
      )
    if (isWord(t, "EXECUTE"))
      throw this.err(t, "NETWORK_BAD_EXPRESSION", "EXECUTE where a value stands: an EXECUTE box is a line of its own, never a value (P8).")
    if (isWord(t, "BRANCH"))
      throw this.err(t, "NETWORK_BAD_EXPRESSION", "an unfed parallel as an operand stands in brackets, `x AND (BRANCH (a, b))` (B8, P4).")
    if (isReserved(t.text))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `'${t.text}' at operand position: a variable spelled like a word of the text is written between backticks (P1).`,
      )
    this.next()
    if (isSym(this.peek(), "(")) {
      this.next()
      return this.parseCall(t, undefined, false, undefined)
    }
    if (isSym(this.peek(), ".") && isWord(this.peekAt(1), "ENO")) throw this.oldEno(this.peek())
    return this.leaf(t)
  }
}
