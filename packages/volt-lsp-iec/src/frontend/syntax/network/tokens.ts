/**
 * The reader's token-level rules (`parser.ts` composes the reader): a node's modifiers, a target, the old spellings refused
 * by name with the word that replaces them, the finding for a token where something else should stand, and the token
 * classes every level of the descent asks.
 */
import type { NetworkPinFlags, NetworkTarget, NetworkValue } from "./ast.js"
import { NetworkCursor, type ParseError } from "./cursor.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { IDENTIFIER, OPERATOR_WORDS, SPLIT_SHAPE, isReserved } from "./words.js"

export type Mods = NetworkPinFlags

export const noMods = (m: Mods): boolean => m.negated === undefined && m.edge === undefined

export abstract class TokenReader extends NetworkCursor {
  /** A pin's, a coil's or a value's modifiers `k` ahead — `[R_EDGE|F_EDGE] [NOT]` — and how many tokens they take. */
  protected modifiersAt(k: number): { flags: Mods; count: number } {
    const from = k
    const flags: Mods = {}
    if (isWord(this.peekAt(k), "R_EDGE") || isWord(this.peekAt(k), "F_EDGE")) {
      flags.edge = isWord(this.peekAt(k), "R_EDGE") ? "rising" : "falling"
      k++
    }
    if (isWord(this.peekAt(k), "NOT")) {
      flags.negated = true
      k++
    }
    return { flags, count: k - from }
  }

  // ── targets ─────────────────────────────────────────────────────────────────────────────────

  protected checkedTarget(t: Tok): Tok {
    switch (t.kind) {
      case "word":
        if (SPLIT_SHAPE.test(t.text))
          throw this.err(
            t,
            "NETWORK_BAD_EXPRESSION",
            `${t.text} as a coil target: a split is defined by \`${t.text} := value;\` and is never a coil's or a pin's target.`,
          )
        if (isReserved(t.text))
          throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target spelled like a word of the text is written between backticks.`)
        return t
      case "backtick":
      case "unnamed":
      case "address":
        return t
      default:
        throw this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' as a target: a target is a variable, \`???\`, an address or text between backticks.`)
    }
  }

  protected targetNode(t: Tok): NetworkTarget {
    const expr = this.tokExpr(t)
    return { text: t.text, ...(expr !== undefined ? { expr } : {}), backticked: t.kind === "backtick", unnamed: t.kind === "unnamed", span: this.tokSpan(t) }
  }

  // ── findings ────────────────────────────────────────────────────────────────────────────────

  protected oldEno(dot: Tok): ParseError {
    return this.err(
      dot,
      "NETWORK_PARSE",
      "`.ENO` is not network text: a box read through its ENO shows `ENO` after its outputs, `x := MOVE 1 => t ENO EN c;`.",
    )
  }

  /** ST's operator symbols are not network text — refused BY NAME with the word that replaces them. */
  protected oldSymbol(t: Tok): ParseError | undefined {
    if (t.kind !== "sym") return undefined
    const word: string | undefined = (
      { "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", ">": "GT", "<": "LT", ">=": "GE", "<=": "LE", "=": "EQ", "<>": "NE" } as Record<string, string>
    )[t.text]
    if (word === undefined)
      return ["(", ")", ",", ";", ":", ":=", "=>", ".", "S=", "R="].includes(t.text) || /[^\x00-\x7f]|[A-Za-z0-9]/.test(t.text)
        ? undefined
        : this.err(
            t,
            "NETWORK_UNKNOWN_OPERATOR",
            `'${t.text}' is no operator of network text: a box is its name — the words are AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT MOVE, and every other box is a call, \`f(IN := a)\`.`,
          )
    const after = this.raw(this.p + 1)
    if ((t.text === "-" || t.text === "+") && after.kind === "number")
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `'${t.text} ${after.text}': a negative literal is the minus touching its digit, -1, and a '+' sign is not written.`,
      )
    if (t.text === "-" && after.kind === "word" && after.offset === t.offset + 1)
      return this.err(t, "NETWORK_BAD_EXPRESSION", `'-${after.text}': a negation of a value is a box, \`0 SUB ${after.text}\`.`)
    return this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' is not network text: a box is its name — write ${word} (\`a ${word} b\`).`)
  }

  /** The finding for a token where something else should stand, named by what it is (`Unexpected`). */
  protected unexpected(t: Tok, what: string): ParseError {
    if (t.kind === "error") return this.err(t, (t.code ?? "NETWORK_PARSE") as never, t.text)
    if (this.isMissingSemicolon(t)) return this.missingSemicolon(t)
    const old = this.oldSymbol(t)
    if (old !== undefined) return old
    if (isSym(t, ".") && isWord(this.raw(this.p + 1), "ENO")) return this.oldEno(t)
    if (isWord(t, "EN") || isWord(t, "ENO"))
      return this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `${t.text.toUpperCase()} where no box takes it: ENO and EN follow the box they belong to (its outputs first), and a box that is another word's operand is bracketed with them.`,
      )
    if (isSym(t, "=>"))
      return this.err(t, "NETWORK_BAD_EXPRESSION", "`=>` here: a box word writes its outputs after its operands, a call inside its brackets.")
    if (isWord(t, "BRANCH"))
      return this.err(t, "NETWORK_BAD_EXPRESSION", "BRANCH after a box: a feed that is a box is bracketed, `(a AND b) BRANCH (x, y)`.")
    if (isWord(t, "SHORTCIRCUIT"))
      return this.err(t, "NETWORK_BAD_EXPRESSION", "SHORTCIRCUIT after something no parallel: it follows a parallel's branch list.")
    if (isBoxWord(t))
      return this.err(t, "NETWORK_BAD_EXPRESSION", `'${t.text}' after a box at its level: one word is one box, and brackets separate boxes.`)
    if (t.kind === "eof") return this.err(t, "NETWORK_PARSE", `the body ends inside an item: ${what}.`)
    return this.err(t, "NETWORK_PARSE", `'${t.text}': ${what}.`)
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────────────

  protected expectSym(sym: string, form: string): void {
    const t = this.peek()
    if (!isSym(t, sym))
      throw this.err(
        t,
        "NETWORK_PARSE",
        t.kind === "eof" ? `the item ends where \`${sym}\` is expected (${form}).` : `expected \`${sym}\` and found '${t.text}' (${form}).`,
      )
    this.next()
  }

  protected expectClose(what: string): void {
    if (!isSym(this.peek(), ")")) throw this.unexpected(this.peek(), what)
    this.next()
  }

  protected expectOnLine(sym: string, line: number, form: string): void {
    const t = this.raw(this.p)
    if (this.line(t) !== line) throw this.err(t, "NETWORK_PARSE", `the NETWORK header ends at its newline; \`${form}\` is on one line.`)
    this.expectSym(sym, form)
  }
}

// ── the token classes ─────────────────────────────────────────────────────────────────────────

export const isBoxWord = (t: Tok): boolean => t.kind === "word" && OPERATOR_WORDS.has(t.text.toUpperCase())

export const isSplitWord = (t: Tok): boolean => t.kind === "word" && SPLIT_SHAPE.test(t.text)

export const isStorage = (t: Tok): boolean => isSym(t, ":=") || isSym(t, "S=") || isSym(t, "R=")

export const isTargetToken = (t: Tok): boolean =>
  t.kind === "backtick" || t.kind === "unnamed" || t.kind === "address" || (t.kind === "word" && !isReserved(t.text))

/** Whether `t` ends an operand: nothing of a value stands there. */
export const endsOperand = (t: Tok): boolean =>
  t.kind === "eof" || isSym(t, ";") || isSym(t, ",") || isSym(t, ")") || isSym(t, "=>") || isBoxWord(t) || isWord(t, "BRANCH") ||
  isWord(t, "SHORTCIRCUIT") || isWord(t, "ENO") || isWord(t, "EN") || t.kind === "snippet" || isWord(t, "END_EXECUTE")

/** A name as the writer spells it: bare where it is a name that is not reserved, else between backticks. */
export const nameText = (text: string): string =>
  (IDENTIFIER.test(text) || /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(text)) && !isReserved(text) ? text : "`" + text.replace(/\$/g, "$$$$").replace(/`/g, "``") + "`"

export const isBoxNode = (v: NetworkValue): boolean => v.kind === "word" || v.kind === "call" || v.kind === "execute"
