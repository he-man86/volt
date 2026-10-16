/**
 * The reader's CALLS — a port of the bridge reader's `ParseCall` and `Pin` (`NetworkTextReader.cs`, openspec
 * ld-fbd-coverage 2R.3): a call's pins after its `(` — positional or named inputs, a negated pin `NOT F := v` (S6), output
 * pins `F => v`, a positional `=> v`, a bare `=>` passing a slot over, the named ENO pin `ENO => v` (P5) — the `)`, an
 * optional `.name` (S4), and what the head is: an FB instance the declarations name, the vendor's unnamed instance, an
 * operator's own word (its call form, P5), or a POU.
 */
import type { NetworkPin } from "./ast.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import type { Syn } from "./boxes.js"
import { ValueReader } from "./values.js"
import { CONSTRUCT_WORDS, defaultFormal, IDENTIFIER, isName, isReserved } from "./words.js"

export abstract class CallReader extends ValueReader {
  protected parseCall(head: Tok, unnamedType: Tok | undefined, operatorCall: boolean, type: string | undefined): Syn {
    const box = this.newBox("call", "", head, head)
    box.operatorCall = operatorCall
    box.backticked = head.kind === "backtick"
    let positional = false
    if (isSym(this.peek(), ")")) this.next() // `f()` — a box with no input slot
    else
      for (;;) {
        positional = this.pin(box.pins, box) || positional
        const sep = this.peek()
        if (isSym(sep, ",")) {
          this.next()
          continue
        }
        if (isSym(sep, ")")) {
          this.next()
          break
        }
        if (isWord(sep, "EN"))
          throw this.err(sep, "NETWORK_BAD_EXPRESSION", "EN inside a call's argument: an enabled comparison as a value stands in brackets, `f((a GT b EN c), d)` (P4).")
        throw this.unexpected(sep, "pins are separated by `,` and closed by `)`")
      }

    if (isSym(this.peek(), ".")) {
      const dot = this.next()
      const e = this.peek()
      if (isWord(e, "ENO")) this.oldEno(dot)
      if (e.kind === "word" && IDENTIFIER.test(e.text) && !isWord(e, "EN") && !isReserved(e.text)) box.named = this.next()
      else throw this.err(e, "NETWORK_PARSE", "after a call, `.name` names the output a consumer reads (S4).")
    }

    if (unnamedType !== undefined) {
      box.type = unnamedType.text
      box.unnamedType = this.name(unnamedType)
    } else if (operatorCall) box.type = type!
    else {
      const fbType = this.scope.instanceType(head.text)
      if (fbType !== undefined) {
        if (CONSTRUCT_WORDS.has(head.text.toUpperCase()))
          throw this.err(head, "NETWORK_UNSUPPORTED", `an instance named ${head.text.toUpperCase()}: the text reads it as its own construct.`)
        box.instance = true
        box.type = fbType
      } else {
        if (!isName(head.text))
          throw this.err(
            head,
            "NETWORK_UNSUPPORTED",
            `an FB instance the declarations do not name: '${head.text}' is no POU name, and no declaration names it an instance, so its type is unknown.`,
          )
        box.type = head.text
      }
      const expr = this.tokExpr(head)
      if (expr !== undefined) box.headExpr = expr
    }
    if (CONSTRUCT_WORDS.has(box.type.toUpperCase()))
      throw this.err(
        head,
        "NETWORK_UNSUPPORTED",
        `a POU named ${box.type.toUpperCase()}: the text reads ${box.type.toUpperCase()}(…) as its own construct, so a call of it has no spelling.`,
      )

    // An operator's pins named by its default formal (P5) read back unnamed, the vendor's own (census 1.13).
    box.inputs.forEach((p, i) => {
      if (p.formal !== undefined && defaultFormal(box.type, i)?.toUpperCase() === p.formal.toUpperCase()) delete p.formal
    })
    if (box.type.toUpperCase() === "NOT" && operatorCall && positional)
      throw this.err(head, "NETWORK_BAD_EXPRESSION", "the NOT box names its input: `NOT(IN := a)` (P5).")

    if (box.named !== undefined && box.outputs.some((o) => o.positional))
      throw this.err(
        box.named,
        "NETWORK_UNSUPPORTED",
        `a positional \`=>\` pin beside \`.${box.named.text}\`: positional pins fill the slots after the one a consumer reads, and \`.${box.named.text}\` states no slot. Name the pin.`,
      )
    box.to = this.lastEnd()
    return { box, start: head, bracketed: false, word: false, empty: false, covered: false }
  }

  /** One pin of a call; true for a positional input. */
  private pin(pins: NetworkPin[], box: ReturnType<ValueReader["newBox"]>): boolean {
    const startTok = this.peek()
    if (isSym(this.peek(), "=>")) {
      this.next()
      // `=> v` fills the next output slot; a bare `=>` passes one over.
      const bare = this.atEnd() || isSym(this.peek(), ",") || isSym(this.peek(), ")")
      const target = bare ? undefined : this.target(this.next())
      box.outputs.push({ ...(target !== undefined ? { target } : {}), positional: true })
      pins.push({ kind: "output", ...(target !== undefined ? { target: this.targetNode(target) } : {}), span: this.spanFrom(startTok) })
      return false
    }

    let not: Tok | undefined
    if (isWord(this.peek(), "NOT") && this.isPinNameAt(this.p + 1) && isSym(this.raw(this.p + 2), ":=")) not = this.next()

    if (this.isPinNameAt(this.p) && (isSym(this.raw(this.p + 1), ":=") || isSym(this.raw(this.p + 1), "=>"))) {
      const name = this.next()
      const isEn = name.kind === "word" && name.text.toUpperCase() === "EN"
      const isEno = name.kind === "word" && name.text.toUpperCase() === "ENO"
      if (name.kind === "word" && isReserved(name.text) && !isEn && !isEno)
        throw this.err(name, "NETWORK_BAD_EXPRESSION", `a pin named '${name.text}', a word of the text: it is written between backticks (P1).`)
      const op = this.next()
      if (op.text === ":=") {
        if (isEn)
          throw this.err(
            name,
            "NETWORK_BAD_EXPRESSION",
            not === undefined
              ? "`EN :=` on a box is not network text: the enable follows the box, `f(…) EN c` (B3, P12)."
              : "a flag on the EN pin: the enable is the rung itself, and the IDE holds no modifier on it — negate what feeds it.",
          )
        if (isEno) throw this.err(name, "NETWORK_BAD_EXPRESSION", "`ENO :=`: ENO is an output — the named ENO pin is `ENO => x` (P5).")
        const at = this.peek()
        const v = this.parseLevel()
        const value = v.empty ? { kind: "empty_slot" as const, span: this.emptySpan(at) } : this.slot(v, at)
        box.inputs.push({ formal: name.text, value, negated: not !== undefined })
        pins.push({ kind: "input", name: this.name(name), value, ...(not !== undefined ? { negated: true as const } : {}), span: this.spanFrom(not ?? name) })
        return false
      }
      if (isEn) throw this.err(name, "NETWORK_BAD_EXPRESSION", "`EN =>`: EN is the enable input, never an output pin (B3).")
      if (this.atEnd() || isSym(this.peek(), ",") || isSym(this.peek(), ")"))
        throw this.err(name, "NETWORK_BAD_EXPRESSION", `\`${name.text} =>\` wired to nothing: a named output pin holds a target, and an unwired one is not written.`)
      const target = this.target(this.next())
      box.outputs.push({ formal: isEno ? "ENO" : name.text, target, positional: false })
      pins.push({ kind: "output", name: this.name(name), target: this.targetNode(target), span: this.spanFrom(name) })
      return false
    }
    if (not !== undefined) throw this.err(not, "NETWORK_PARSE", "NOT before a pin name: `NOT name := v` negates the pin.")

    const v = this.parseLevel()
    const value = v.empty ? { kind: "empty_slot" as const, span: this.emptySpan(v.start) } : this.slot(v, startTok)
    box.inputs.push({ value, negated: false })
    pins.push({ kind: "input", value, span: v.empty ? this.emptySpan(v.start) : this.spanFrom(startTok) })
    return true
  }

  private isPinNameAt(i: number): boolean {
    return i < this.end && (this.raw(i).kind === "word" || this.raw(i).kind === "backtick") && i + 1 < this.end
  }
}
