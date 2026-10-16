/**
 * The reader's TARGETS and PINS — the part of the bridge reader's values (`NetworkTextReader.cs`, openspec ld-fbd-coverage
 * 2R.3) that reads what a box writes to: a box word's `=> v` pins and its `EN` tail (B1–B3, P4), MOVE's operand bracket
 * (B2), an assignment below the top level (S2), a target or coil (P1, P9), a split's VarId, and the old spellings refused
 * by name with the word that replaces them (P12).
 */
import type { NetworkNestedAssign, NetworkTarget } from "./ast.js"
import { BoxReader, type BoxSyn } from "./boxes.js"
import type { NetworkCursor } from "./cursor.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { OPERATOR_WORDS, SPLIT_PREFIX, SPLIT_SHAPE, isReserved } from "./words.js"

export abstract class TargetReader extends BoxReader {
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
    if (!isWord(this.peek(), "EN")) return
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

  /** `(t1 := t2 S= … value)` after its `(` (S2): one Assign item below the top level. A split is never a coil target. */
  protected parseNestedAssign(open: Tok): NetworkNestedAssign {
    const targets: NetworkTarget[] = []
    let op: Tok = open
    while (this.isTargetToken(this.peek()) && this.storageAt(this.p + 1)) {
      const tt = this.next()
      op = this.takeStorage()
      targets.push(this.lvalue(tt, op))
    }
    const value = this.slotValue(op)
    if (!isSym(this.peek(), ")")) throw this.unexpected(this.peek(), "an assignment's pair `(t := value)` closes after its value")
    this.next()
    return { kind: "nested_assign", targets, value, span: this.spanFrom(open) }
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
