/**
 * The reader's STATEMENTS — one per NWL item: the empty item, an assignment (a chain of targets, each with its storage
 * operator) or a wire's definition, a value whose output goes nowhere, and a jump (`JMP`, `RETURN`, under `IF … THEN`).
 */
import type { NetworkAssign, NetworkName, NetworkTarget, NetworkTextStatement, NetworkValue } from "./ast.js"
import { IDENTIFIER } from "./cursor.js"
import { CallReader } from "./calls.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { isStorageAt } from "./pair-kind.js"
import { v1Refusal } from "./words.js"

export abstract class StatementReader extends CallReader {
  protected parseStatement(): NetworkTextStatement {
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

  /** A storage operator next (`pair-kind.ts` `isStorageAt`). */
  private atStorage(): boolean {
    return isStorageAt(this.peek(), this.lx)
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
      return { kind: "jump", target: this.name(l), ...cond }
    }
    if (isWord(t, "RETURN")) return { kind: "return", ...cond }
    throw this.err(t, "NETWORK_PARSE", "IF c THEN takes `JMP label;` or `RETURN;`.")
  }
}
