/**
 * The reader's CALLS — a box: its head and the type the bridge reader decides for it, its pins (named, positional,
 * `=> v`, EN), its suffix (`.ENO`, a named main output); and the two constructs spelled like a call, `PARALLEL(…)` and
 * the inline-ST `EXECUTE … END_EXECUTE` box.
 */
import type { NetworkCall, NetworkDiagnosticCode, NetworkExecute, NetworkName, NetworkParallel, NetworkPin, NetworkValue } from "./ast.js"
import type { PVal } from "./cursor.js"
import { IDENTIFIER, isName } from "./cursor.js"
import { type Tok, isOperator, isSym, isWord } from "./lexer.js"
import { isOutputName, namedOutputRefusal } from "./shown.js"
import { ValueReader } from "./values.js"
import { CONSTRUCT_WORDS } from "./words.js"

const MEASURED_MODES = new Set(["BoxShortCircuit", "Sequential"])

export abstract class CallReader extends ValueReader {
  /** A call's pins after its `(`, the `)`, and an optional `.ENO`. */
  protected parseCall(head: Tok, consumed: boolean, first: PVal | undefined, unnamedType?: NetworkName): NetworkCall {
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
    // The box's stored members, after its closing paren and before the suffix (ld-fbd-coverage 2.3).
    const pragmas = this.readPragmas()

    const { eno, output } = this.callSuffix()

    const headText = head.kind === "unnamed" ? "???" : head.text
    const { type, fbType } = this.boxType(head, headText, unnamedType)
    if (eno && !consumed)
      throw this.err(head, "NETWORK_BAD_EXPRESSION", `\`.ENO\` on '${headText}', which nothing consumes: a top-level box's output goes nowhere.`)
    const named = output !== undefined ? namedOutputRefusal(output, headText, type, consumed, pins) : undefined
    if (named !== undefined) throw this.err(named.at, named.code, named.message)

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
      ...(output !== undefined ? { output: this.name(output) } : {}),
      ...(fbType !== undefined ? { instance: true as const } : {}),
      ...(pragmas !== undefined ? { pragmas } : {}),
      span: this.span(head.offset, this.lastEnd),
    }
    return call
  }

  /** The box's TYPE, as the bridge reader decides it: the unnamed instance's own, an instance's FB (asked of the scope),
   *  or the head, which names a POU. `fbType`: the head is an instance of it. */
  private boxType(head: Tok, headText: string, unnamedType: NetworkName | undefined): { type: string; fbType?: string } {
    let type: string
    const fbType = unnamedType === undefined ? this.scope?.instanceType(headText) : undefined
    if (unnamedType !== undefined) {
      type = unnamedType.text
    } else if (fbType !== undefined) {
      if (CONSTRUCT_WORDS.has(headText.toUpperCase()))
        throw this.err(head, "NETWORK_UNSUPPORTED", `an instance named ${headText.toUpperCase()}: the text reads it as its own construct.`)
      type = fbType
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
    }
    // Spec, "a POU named like an edge word": a backticked head is still the POU's name, and an instance's FB type is a
    // POU too — the writer could spell none of them back.
    if (CONSTRUCT_WORDS.has(type.toUpperCase()))
      throw this.err(
        head,
        "NETWORK_UNSUPPORTED",
        `a POU named ${type.toUpperCase()}: the text reads ${type.toUpperCase()}(…) as its own construct, so a call of it has no spelling.`,
      )
    return { type, ...(fbType !== undefined ? { fbType } : {}) }
  }

  /** A call's suffix after its `)`: `.ENO`, `.name` (a named main output, `shown.ts`), or none. */
  private callSuffix(): { eno: boolean; output?: Tok } {
    if (!isSym(this.peek(), ".")) return { eno: false }
    this.next()
    const e = this.next()
    if (isWord(e, "ENO")) return { eno: true }
    if (isOutputName(e)) return { eno: false, output: e }
    throw this.err(e, "NETWORK_PARSE", "after a call, the suffix is `.ENO` or the name of the output a consumer reads.")
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

    // S6: `NOT name := v` negates the PIN; the enable is the rung itself and holds no flag of its own.
    let negated = false
    if (pre === undefined && isWord(at, "NOT") && this.lx.namedPinFollows()) {
      const not = this.next()
      if (isWord(this.peek(), "EN"))
        throw this.err(not, "NETWORK_UNSUPPORTED", "a flag on the EN pin: the enable is the rung itself, and the IDE holds no modifier on it — negate what feeds it.")
      negated = true
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
        pins.push({
          kind: "input",
          name: this.name(pinName),
          value,
          ...(negated ? { negated: true as const } : {}),
          span: this.span(negated ? at.offset : pinName.offset, this.lastEnd),
        })
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
  protected parseParallel(): NetworkParallel {
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
  protected parseExecute(consumed: boolean): NetworkExecute {
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
    const pragmas = this.readPragmas()

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
      ...(pragmas !== undefined ? { pragmas } : {}),
      span: this.span(kw.offset, this.lastEnd),
    }
  }
}
