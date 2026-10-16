/**
 * The reader's STATEMENTS — a port of the bridge reader's `ParseStatement` (`NetworkTextReader.cs`, openspec
 * ld-fbd-coverage 2R.3): one per LINE — the empty item, a jump or return (B4b, a coil: `JMP l := c;`), an EXECUTE box
 * (P8), a split's definition (B6), a coil (a chain of targets, each with its storage operator), or a box — and the line's
 * end: `;` where the item ends, or none where it is an OPEN line a later `ENO` takes (B4, P3).
 */
import type { NetworkName, NetworkTarget, NetworkTextStatement, NetworkValue, NetworkWordBox, NetworkCall, NetworkExecute } from "./ast.js"
import { CallReader } from "./calls.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import type { Role } from "./boxes.js"
import { IDENTIFIER, NETWORK_TEXT_WORDS, SPLIT_SHAPE } from "./words.js"

/** What one line read: the statement it is, or — on an open line — the box a later ENO takes. */
type LineRead = { statement: NetworkTextStatement } | { open: NetworkWordBox | NetworkCall | NetworkExecute } | { notABox: true }

export abstract class StatementReader extends CallReader {
  /** One line, `semi` whether it ends with `;`. */
  protected parseLine(semi: boolean): LineRead {
    const t = this.peek()
    const role: Role = semi ? "top" : "eno"

    // The empty statement IS the empty item — a `;` that closes no statement.
    if (isSym(t, ";")) {
      this.next()
      this.atLineEnd("the empty item is `;` alone")
      return { statement: { kind: "empty", span: this.tokSpan(t) } }
    }

    if (isWord(t, "JMP") || isWord(t, "RETURN")) return { statement: this.parseJump(t, semi) }

    if (isWord(t, "EXECUTE")) return this.parseExecute(role, semi)

    if ((isWord(t, "IF") || isWord(t, "VAR_TEMP")) && !this.storageAt(this.p + 1))
      throw this.err(
        t,
        "NETWORK_PARSE",
        isWord(t, "IF")
          ? "IF … THEN is gone: a jump is a coil, `JMP l := c;`, and a return `RETURN := c;` (B4b, P12)."
          : "VAR_TEMP is gone: a split is defined by `split<VarId> := value;` and needs no declaration (B6, P12).",
      )

    if (t.kind === "word" && SPLIT_SHAPE.test(t.text) && (isSym(this.peekAt(1), ":=") || isSym(this.peekAt(1), ":")))
      return { statement: this.parseSplitDefinition(semi) }

    if (t.kind === "word" && NETWORK_TEXT_WORDS.has(t.text.toUpperCase()) && this.storageAt(this.p + 1))
      throw this.err(
        t,
        "NETWORK_BAD_EXPRESSION",
        `'${t.text}' as a target: a target spelled like a word of the text is written between backticks, \`${t.text}\` (P1).`,
      )

    if (this.isTargetToken(t) && this.storageAt(this.p + 1)) {
      const targets: NetworkTarget[] = []
      let op: Tok = t
      while (this.isTargetToken(this.peek()) && this.storageAt(this.p + 1)) {
        const tt = this.next()
        op = this.takeStorage()
        targets.push(this.lvalue(tt, op))
      }
      const value = this.slotValue(op)
      this.endStatement(semi, "a coil")
      return { statement: { kind: "assign", targets, value, span: this.spanFrom(t) } }
    }

    const root = this.parseLevel()
    if (root.empty) throw this.err(t, "NETWORK_PARSE", "a value is expected here.")
    if (root.bracketed)
      throw this.err(root.start, "NETWORK_BAD_EXPRESSION", "brackets around a line's whole value: a line holds one box, never bracketed (B5, P4).")
    const node = root.box !== undefined ? this.finalize(root.box, role) : root.node!
    this.endStatement(semi, undefined)
    if (semi) return { statement: { kind: "value", value: node, span: this.spanFrom(t) } }
    return node.kind === "word" || node.kind === "call" || node.kind === "execute" ? { open: node } : { notABox: true }
  }

  /** `JMP label` / `RETURN`, on the rail or driven by `:=` (P7). */
  private parseJump(t: Tok, semi: boolean): NetworkTextStatement {
    this.next()
    let target: NetworkName | undefined
    if (isWord(t, "JMP")) {
      const l = this.next()
      if (l.kind !== "word" || !IDENTIFIER.test(l.text)) throw this.err(l, "NETWORK_BAD_EXPRESSION", "JMP takes one label, an identifier.")
      target = this.name(l)
    }
    let condition: NetworkValue | undefined
    if (isSym(this.peek(), ":=")) {
      const op = this.next()
      if (this.atEnd() || isSym(this.peek(), ";"))
        throw this.err(
          op,
          "NETWORK_BAD_EXPRESSION",
          `\`${t.text.toUpperCase()} … := ;\`: a jump on the rail is \`${isWord(t, "JMP") ? "JMP l;" : "RETURN;"}\` (P7, one spelling).`,
        )
      condition = this.slotHere()
    } else if (this.storageAt(this.p))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", `${t.text.toUpperCase()} with S= or R=: a jump or return is driven by \`:=\` (P7).`)
    this.endStatement(semi, "a jump")
    const span = this.spanFrom(t)
    return target !== undefined
      ? { kind: "jump", target, ...(condition !== undefined ? { condition } : {}), span }
      : { kind: "return", ...(condition !== undefined ? { condition } : {}), span }
  }

  /** P8: `EXECUTE [EN [c]]` on its line, the verbatim ST below it, `END_EXECUTE`, and `;` — or no `;`, where it is an
   *  open line a later ENO takes. Never a value. */
  private parseExecute(role: Role, semi: boolean): LineRead {
    const kw = this.next()
    if (isSym(this.peek(), "(")) throw this.err(this.peek(), "NETWORK_PARSE", "EXECUTE(EN := c) is gone: write `EXECUTE EN c` on the EXECUTE line (B3, P12).")
    const box = this.newBox("execute", "EXECUTE", kw, kw)
    this.parseEn(box)
    // The body's lexical error (a lone CR) stands where the body would: past this line's tokens.
    if (this.atEnd() && this.raw(this.p).kind === "error") {
      const e = this.raw(this.p)
      throw this.err(e, (e.code ?? "NETWORK_PARSE") as never, e.text)
    }
    const snippet = this.next()
    if (snippet.kind !== "snippet")
      throw this.err(snippet, "NETWORK_PARSE", "EXECUTE [EN [c]] ends at its line; its ST starts on the next line (P8).")
    const end = this.next()
    if (!isWord(end, "END_EXECUTE")) throw this.err(end, "NETWORK_PARSE", "an EXECUTE body ends with END_EXECUTE.")
    const st = this.stStatements(snippet.offset, snippet.offset + snippet.length)
    box.execute = { statements: st.statements, ok: st.ok }
    box.to = this.lastEnd()
    const node = this.finalize(box, role)
    this.endStatement(semi, undefined)
    if (semi) return { statement: { kind: "value", value: node, span: this.spanFrom(kw) } }
    return node.kind === "execute" ? { open: node } : { notABox: true }
  }

  /** B6, P9: `split<n> := value;` — the split's one definition, before its references. No type is ever written. */
  private parseSplitDefinition(semi: boolean): NetworkTextStatement {
    const name = this.next()
    const id = this.splitId(name)
    if (isSym(this.peek(), ":"))
      throw this.err(
        this.peek(),
        "NETWORK_BAD_EXPRESSION",
        `a type on the split ${name.text}: a split's type is its feeder's and is never written — \`${name.text} := value;\` (B6, P9).`,
      )
    const op = this.next()
    if (!isSym(op, ":=")) throw this.err(op, "NETWORK_BAD_EXPRESSION", `a split is defined with \`:=\`, and S=/R= are coils (${name.text}, P9).`)
    if (this.splits.has(id)) throw this.err(name, "NETWORK_DUPLICATE_NAME", `the split ${name.text} is defined twice (P9).`)
    const value = this.slotValue(op)
    this.endStatement(semi, "a split's definition")
    this.splits.set(id, { name: this.name(name), references: [] })
    return { kind: "split_def", split: this.name(name), value, span: this.spanFrom(name) }
  }

  /** The line's end: `;` where the line has one (its last token), nothing else after the statement. */
  private endStatement(semi: boolean, what: string | undefined): void {
    if (semi) {
      if (!isSym(this.peek(), ";")) throw this.unexpected(this.peek())
      this.next()
    } else if (what !== undefined)
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", `${what} ends its item with \`;\`: only a box with an ENO stands on an open line (B4, P3).`)
    this.atLineEnd(undefined)
  }

  private atLineEnd(what: string | undefined): void {
    if (this.p < this.end) throw this.unexpected(this.raw(this.p), what)
  }
}
