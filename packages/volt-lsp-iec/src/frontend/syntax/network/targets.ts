/**
 * The reader's TARGETS and PINS — the part of the bridge reader's values (`NetworkTextReader.cs`, openspec ld-fbd-coverage
 * 2R.3) that reads what a box writes to: a box word's `=> v` pins and its `EN` tail (B1–B3, P4), MOVE's operand bracket
 * (B2), an assignment below the top level (S2), a target or coil (P1, P9), a split's VarId, and the old spellings refused
 * by name with the word that replaces them (P12).
 */
import type { NetworkName, NetworkNestedAssign, NetworkPinFlags, NetworkTarget, NetworkValue } from "./ast.js"
import { BoxReader, type BoxSyn } from "./boxes.js"
import type { NetworkCursor } from "./cursor.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { IDENTIFIER, OPERATOR_WORDS, SPLIT_PREFIX, SPLIT_SHAPE, isReserved, UNMEASURED_FLOW, UNMEASURED_EDGE_COIL, UNMEASURED_EDGE_EN, UNMEASURED_MODIFIED_FAN_OUT } from "./words.js"

/** One coil head as read (`ParseCoilHeads`): its target and its storage operator, and whether it is control flow alone and
 *  plain — P7's `JMP l := c`. */
interface CoilHead {
  target: NetworkTarget
  op: Tok
  lone: boolean
}

export abstract class TargetReader extends BoxReader {
  /** The network's split points defined so far: VarId → the definition's name. */
  protected splits = new Map<number, { name: NetworkName }>()
  /** Every reference to a split, by VarId, in text order — a reference may stand above its definition (2R.5, #19), so the
   *  network's end checks that each is defined somewhere (`never defined`). */
  protected splitRefs = new Map<number, NetworkName[]>()
  /** The first reference's token, by VarId — where a split never defined is reported. */
  protected splitRefAt = new Map<number, Tok>()
  /** The splits whose definition's value is being read — a reference to one is a split feeding itself (2R.5, unmeasured). */
  protected defining = new Set<number>()

  /**
   * B2, B5: whether the bracket after `MOVE` is its OPERAND's (`MOVE (a ADD b) => x`) and not its call's pins (`MOVE(a,
   * b)`). Tokens decide, never spacing: a call whose brackets hold exactly one positional input, no output pin and no
   * formal IS the word form's tree, so such a bracket is the operand's (`MoveOperandBracket`).
   */
  protected moveOperandBracket(): boolean {
    const first = this.p + 2
    if (first < this.end && isSym(this.raw(first), ")")) return false
    if (first + 1 < this.end && isWord(this.raw(first), "IN") && isSym(this.raw(first + 1), ":=")) return false
    if (first + 2 < this.end && isWord(this.raw(first), "NOT") && isWord(this.raw(first + 1), "IN") && isSym(this.raw(first + 2), ":=")) return false
    let depth = 0
    for (let i = this.p + 1; i < this.end; i++) {
      const t = this.raw(i)
      if (isSym(t, "(")) depth++
      else if (isSym(t, ")") && --depth === 0) return true
      else if (depth === 1 && (isSym(t, ",") || isSym(t, "=>"))) return false
    }
    return false
  }

  /** A box word's `=> v` pins (B1, B2), before its EN (P4: `MOVE b EN c => a` is refused). */
  protected parseArrows(box: BoxSyn): void {
    while (isSym(this.peek(), "=>")) {
      const arrow = this.next()
      if (this.atEnd() || isSym(this.peek(), "=>") || !this.isTargetToken(this.peek()))
        throw this.err(
          arrow,
          "NETWORK_BAD_EXPRESSION",
          "`=>` with no target: a box word writes each output to a target, and a slot passed over is the call form's (P5).",
        )
      const target = this.target(this.next())
      box.outputs.push({ target, positional: true })
      box.wordOutputs.push(this.targetNode(target))
    }
  }

  /** B3: `EN c` after the box, its tail a slot running to `;`, `)`, `,` or the line's end (P4); `EN` alone is the empty
   *  enable. */
  protected parseEn(box: BoxSyn): void {
    // 2R.5 (#16): the EN pin's own modifier before the word — `NOT EN c` negates the pin, `EN NOT c` the contact.
    const mods = this.modifiersAt(this.p)
    if (!isWord(this.peekAt(mods.count), "EN")) return
    if (mods.flags.edge !== undefined) throw this.err(this.peek(), "NETWORK_UNSUPPORTED", UNMEASURED_EDGE_EN)
    for (let k = 0; k < mods.count; k++) this.next()
    if (mods.flags.negated !== undefined || mods.flags.edge !== undefined) box.enFlags = mods.flags
    const en = this.next()
    box.hadEn = true
    box.enTok = en
    const p = this.peek()
    if (this.atEnd() || isSym(p, ",") || isSym(p, ")") || isSym(p, ";") || p.kind === "snippet")
      box.en = { kind: "empty_slot", span: this.emptySpan(this.peek()) }
    else box.en = this.slotHere()
    if (isSym(this.peek(), "=>"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "`=>` after EN: a box writes its outputs before its EN — `MOVE b => a EN c` (P4).")
    if (isWord(this.peek(), "EN")) throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "EN twice on one box.")
  }

  /** `(t1 := t2 S= … value)` after its `(` (S2): one Assign item below the top level — a jump or a return among its coils
   *  (2R.5). A split is never a coil target. */
  protected parseNestedAssign(open: Tok): NetworkNestedAssign {
    const heads = this.parseCoilHeads()
    const value = this.slotValue(heads[heads.length - 1]!.op)
    if (!isSym(this.peek(), ")")) throw this.unexpected(this.peek(), "an assignment's pair `(t := value)` closes after its value")
    this.next()
    return { kind: "nested_assign", targets: heads.map((h) => h.target), value, span: this.spanFrom(open) }
  }

  /** A pin's or a coil's modifiers at `i` — `[R_EDGE|F_EDGE] [NOT]`, the edge around the negation (N17's one order) — and
   *  how many tokens they take. An edge word followed by `(` is an edge VALUE (`ModifiersAt`). */
  protected modifiersAt(i: number): { flags: NetworkPinFlags; count: number } {
    let k = i
    let flags: NetworkPinFlags = {}
    if (k < this.end && (isWord(this.raw(k), "R_EDGE") || isWord(this.raw(k), "F_EDGE")) && !(k + 1 < this.end && isSym(this.raw(k + 1), "("))) {
      flags = { edge: isWord(this.raw(k), "R_EDGE") ? "rising" : "falling" }
      k++
    }
    if (k < this.end && isWord(this.raw(k), "NOT")) {
      flags = { ...flags, negated: true }
      k++
    }
    return { flags, count: k - i }
  }

  /** Where a COIL HEAD starting at `i` ends (its storage operator's index), or -1 where none starts there:
   *  `[R_EDGE|F_EDGE] [NOT] (JMP label | RETURN | target)` (2R.5, `CoilHeadEnd`). */
  protected coilHeadEnd(i: number): number {
    const k = i + this.modifiersAt(i).count
    if (k >= this.end) return -1
    const t = this.raw(k)
    if (isWord(t, "JMP")) return k + 2 <= this.end ? k + 2 : -1
    if (isWord(t, "RETURN")) return k + 1
    return this.isTargetToken(t) ? k + 1 : -1
  }

  /** The coil heads of an item, each with its storage: `x1 := JMP Done := R_EDGE xe := …` (`ParseCoilHeads`). */
  protected parseCoilHeads(): CoilHead[] {
    const heads: CoilHead[] = []
    let modified: Tok | undefined
    for (let e = this.coilHeadEnd(this.p); e > 0 && this.storageAt(e); e = this.coilHeadEnd(this.p)) {
      const start = this.peek()
      const mods = this.modifiersAt(this.p)
      if (mods.count > 0) modified ??= start
      for (let k = 0; k < mods.count; k++) this.next()
      const t = this.peek()
      let target: NetworkTarget
      const flow = isWord(t, "JMP") || isWord(t, "RETURN")
      if (isWord(t, "JMP")) {
        this.next()
        const l = this.next()
        if (l.kind !== "word" || !IDENTIFIER.test(l.text)) throw this.err(l, "NETWORK_BAD_EXPRESSION", "JMP takes one label, an identifier.")
        target = { text: l.text, jump: true, backticked: false, unnamed: false, span: this.tokSpan(l) }
      } else if (isWord(t, "RETURN")) {
        this.next()
        target = { text: "RETURN", ret: true, backticked: false, unnamed: false, span: this.tokSpan(t) }
      } else target = this.lvalue(this.next())
      const op = this.takeStorage()
      const storage = op.text.toUpperCase()
      // The vendor spells a coil kind with two bits, Negation and Set (`Flags.CoilFromVendor`): a negated SET coil IS the
      // reset coil, and a negated reset coil none it holds apart from it.
      if (mods.flags.negated !== undefined && storage === "S=")
        throw this.err(start, "NETWORK_BAD_EXPRESSION", `NOT on a set coil: the IDE stores a negated set coil as the reset coil — write \`${target.text} R= …\`.`)
      if (mods.flags.negated !== undefined && storage === "R=")
        throw this.err(
          start,
          "NETWORK_BAD_EXPRESSION",
          "NOT on a reset coil: a negated reset coil is no coil the IDE stores apart from the reset coil (R= is Negation + Set).",
        )
      // Measured per row before its spelling ships (2R.5): a jump or a return takes `S=` alone, a coil one edge alone.
      if (flow && (mods.count > 0 || storage === "R="))
        throw this.err(start, "NETWORK_UNSUPPORTED", UNMEASURED_FLOW)
      if (!flow && mods.flags.edge !== undefined && (mods.flags.negated !== undefined || storage !== ":="))
        throw this.err(start, "NETWORK_UNSUPPORTED", UNMEASURED_EDGE_COIL)
      heads.push({
        target: { ...target, op: storage as ":=" | "S=" | "R=", ...mods.flags },
        op,
        lone: flow && mods.count === 0 && storage === ":=",
      })
    }
    // …and a negated or edge coil alone on its item (2R.5).
    if (heads.length > 1 && modified !== undefined) throw this.err(modified, "NETWORK_UNSUPPORTED", UNMEASURED_MODIFIED_FAN_OUT)
    return heads
  }


  // ── targets ─────────────────────────────────────────────────────────────────────────────────

  protected isTargetToken(t: Tok): boolean {
    return (
      t.kind === "backtick" ||
      t.kind === "unnamed" ||
      t.kind === "address" ||
      (t.kind === "word" && !isReserved(t.text)) ||
      (t.kind === "word" && SPLIT_SHAPE.test(t.text))
    )
  }

  protected target(t: Tok): Tok {
    if (!this.isTargetToken(t) || (t.kind === "word" && SPLIT_SHAPE.test(t.text)))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        t.kind === "word" && SPLIT_SHAPE.test(t.text)
          ? `${t.text} as an output target: a split is defined by its own statement and is never a target (P9).`
          : `'${t.text}' as a target: a target is a variable, a token or text between backticks.`,
      )
    return t
  }

  /** An assignment or `=>` target as the tree holds it. A reserved word is backticked (P1), a split is never a target. */
  protected lvalue(t: Tok, op?: Tok): NetworkTarget {
    if (t.kind === "word") {
      if (SPLIT_SHAPE.test(t.text))
        throw this.err(
          t,
          "NETWORK_BAD_EXPRESSION",
          `${t.text} as a coil target: a split is defined by \`${t.text} := value;\` and is never a coil's or a pin's target (P9).`,
        )
      if (isReserved(t.text))
        throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target spelled like a word of the text is written between backticks (P1).`)
    } else if (t.kind !== "backtick" && t.kind !== "unnamed" && t.kind !== "address")
      throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target is a variable, a token or text between backticks.`)
    const node = this.targetNode(t)
    return op !== undefined ? { ...node, op: op.text.toUpperCase() as ":=" | "S=" | "R=" } : node
  }

  protected targetNode(t: Tok): NetworkTarget {
    const expr = this.tokExpr(t)
    return { text: t.text, ...(expr !== undefined ? { expr } : {}), backticked: t.kind === "backtick", unnamed: t.kind === "unnamed", span: this.tokSpan(t) }
  }

  // ── names, scope and old spellings ──────────────────────────────────────────────────────────

  /** The VarId a split's name carries (B6, P9: no leading zeros). */
  protected splitId(name: Tok): number {
    const digits = name.text.slice(SPLIT_PREFIX.length)
    if (digits.length > 1 && digits[0] === "0")
      throw this.err(name, "NETWORK_BAD_EXPRESSION", `the split ${name.text}: its number is the VarId, with no leading zeros (P9).`)
    const id = Number(digits)
    if (!Number.isSafeInteger(id) || id > 2147483647) throw this.err(name, "NETWORK_BAD_EXPRESSION", `the split ${name.text} carries a VarId out of range.`)
    return id
  }

  /** A reference to a split: refused inside its own definition (2R.5, unmeasured); it may stand above its definition
   *  (#19, the stored order — it reads the previous scan), so the network's end checks it is defined somewhere. */
  protected splitRef(t: Tok): NetworkName {
    const id = this.splitId(t)
    if (this.defining.has(id))
      throw this.err(t, "NETWORK_UNSUPPORTED", `the split ${t.text} read inside its own definition: a split that feeds itself is not measured (2R.5).`)
    const name = this.name(t)
    this.splitRefs.set(id, [...(this.splitRefs.get(id) ?? []), name])
    if (!this.splitRefAt.has(id)) this.splitRefAt.set(id, t)
    return name
  }

  /** A split definition's value, the split marked as being defined while it is read. */
  protected definingValue(id: number, op: Tok): NetworkValue {
    this.defining.add(id)
    try {
      return this.slotValue(op)
    } finally {
      this.defining.delete(id)
    }
  }

  /** 2R.5 (#20): `(split<n> := value)` after its `(` — a split's one definition below the top level. */
  protected parseNestedSplit(open: Tok): NetworkValue {
    const name = this.next()
    const id = this.splitId(name)
    const op = this.next()
    if (this.splits.has(id)) throw this.err(name, "NETWORK_DUPLICATE_NAME", `the split ${name.text} is defined twice (P9).`)
    // Defined before its value is read: a definition of the same split inside it is the second one (P9).
    this.splits.set(id, { name: this.name(name) })
    const value = this.definingValue(id, op)
    if (!isSym(this.peek(), ")")) throw this.unexpected(this.peek(), "a split's nested definition `(split<n> := value)` closes after its value")
    this.next()
    return { kind: "nested_split", split: this.name(name), value, span: this.spanFrom(open) }
  }

  protected isCallable(name: string): boolean {
    return this.scope.isPou(name) || this.scope.instanceType(name) !== undefined
  }

  protected oldEno(dot: Tok): never {
    throw this.err(
      dot,
      "NETWORK_PARSE",
      "`.ENO` is not network text: write the box on its own line without `;`, and read its ENO on a later line with the word ENO (B4, P12).",
    )
  }

  /** P12: ST's operator symbols are not network text — refused BY NAME with the word that replaces them. */
  protected oldSymbol(t: Tok): ReturnType<NetworkCursor["err"]> | undefined {
    if (t.kind !== "sym") return undefined
    if (t.text === "{")
      return this.err(
        t,
        "NETWORK_PARSE",
        "the member pragma `{Member := value}` is not network text: a member is derived on push, and written only where it differs, in a natural spelling (B7, P12).",
      )
    const word: string | undefined = (
      { "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", ">": "GT", "<": "LT", ">=": "GE", "<=": "LE", "=": "EQ", "<>": "NE" } as Record<string, string>
    )[t.text]
    // A symbol outside the table — an ASCII punctuation mark in operator position, never a structural one, and never a
    // character outside ASCII, which is no symbol of the text at all (NETWORK_PARSE).
    if (word === undefined)
      return ["(", ")", ",", ";", ":", ":=", "=>", "."].includes(t.text) || /[^\x00-\x7f]|[A-Za-z0-9]/.test(t.text)
        ? undefined
        : this.err(
            t,
            "NETWORK_UNKNOWN_OPERATOR",
            `'${t.text}' is no operator of network text: a box is its name — the words are AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT MOVE, and every other box is a call, \`f(a, b)\` (B1, P5).`,
          )
    const after = this.raw(this.p + 1)
    if ((t.text === "-" || t.text === "+") && after.kind === "number")
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `'${t.text} ${after.text}': a negative literal is the minus touching its digit, -1, and a '+' sign is not written (P12).`,
      )
    if (t.text === "-" && after.kind === "word" && after.offset === t.offset + 1)
      return this.err(t, "NETWORK_BAD_EXPRESSION", `'-${after.text}': a negation of a value is a box, \`0 SUB ${after.text}\` (P12).`)
    return this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' is not network text: a box is its name — write ${word} (\`a ${word} b\`, B1, P12).`)
  }

  /** The finding for a token where the line should end, named by what it is (`Unexpected`). */
  protected unexpected(t: Tok, what?: string): ReturnType<NetworkCursor["err"]> {
    if (t.kind === "error") return this.err(t, (t.code ?? "NETWORK_PARSE") as never, t.text)
    const old = this.oldSymbol(t)
    if (old !== undefined) return old
    if (isSym(t, ".") && isWord(this.raw(this.p + 1), "ENO"))
      return this.err(
        t,
        "NETWORK_PARSE",
        "`.ENO` is not network text: write the box on its own line without `;`, and read its ENO on a later line with the word ENO (B4, P12).",
      )
    if (isWord(t, "EN") && this.p > 0)
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        "EN where no box takes it: EN follows the box it enables — its word form, or its call alone at its bracket level (P4).",
      )
    if (isSym(t, "=>"))
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        "`=>` here: a call keeps its output pins inside its brackets, a box word writes them before EN (`a ADD b => x EN c`, P4).",
      )
    if (isWord(t, "INTO") || isWord(t, "BRANCHES"))
      return this.err(
        t,
        "NETWORK_PARSE",
        `'${t.text}' is not network text: a parallel is its feed, the word BRANCH and its branches, \`feed BRANCH (a, b)\` (B8, P12).`,
      )
    if (isWord(t, "BRANCH"))
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        "BRANCH after a box word at its level: a feed that is a box word is bracketed, `(a AND b) BRANCH (x, y)` (B8, P4).",
      )
    if (isWord(t, "SHORTCIRCUIT"))
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        "SHORTCIRCUIT after something no parallel: it follows a parallel's branch list, `feed BRANCH (a, b) SHORTCIRCUIT` (B8).",
      )
    if (t.kind === "word" && OPERATOR_WORDS.has(t.text.toUpperCase()))
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `'${t.text}' after a bracket level that already holds a box: one word = one box, and brackets separate boxes (B1, P4).`,
      )
    return this.err(
      t,
      "NETWORK_PARSE",
      what === undefined
        ? `'${t.text}' where the line ends: each line is one statement, ending with \`;\` or open for a later line's ENO (B4).`
        : `'${t.text}': ${what}.`,
    )
  }
}
