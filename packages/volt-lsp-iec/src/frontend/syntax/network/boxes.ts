/**
 * The reader's BOXES (`parser.ts` composes the reader): a box word, MOVE, an EXECUTE box and a call, each with its outputs
 * and its pin state — `[ENO [=> v]] [[mods] EN [src]]` — and the one place a box's connection is decided from the text,
 * its consumer (`finalize`); and the parallel. The values a box holds are the value reader's (`values.ts`).
 */
import type { NetworkCall, NetworkExecute, NetworkInputPin, NetworkPin, NetworkTarget, NetworkValue, NetworkWordBox } from "./ast.js"
import { type Tok, isSym, isWord } from "./lexer.js"
import { type Mods, TokenReader, isBoxWord, isTargetToken, nameText, noMods } from "./tokens.js"
import { IDENTIFIER, OPERATOR_WORDS, isDefaultFormal, isOperatorBox, isReserved } from "./words.js"

/** A box as read, before the consumer it stands in decides its connection. */
export interface BoxSyn {
  form: "word" | "call" | "execute"
  /** The type as written: a word, MOVE, a callee, an FB's type, EXECUTE. */
  type: string
  head: Tok
  /** Where the box's text starts, when not at its head: a word box at its first operand. */
  start?: Tok
  typeTok?: Tok
  isFb: boolean
  operatorCall: boolean
  operands: NetworkValue[]
  pins: NetworkPin[]
  /** A word's `=> v` targets; a call's outputs live in its pins. */
  arrows: NetworkTarget[]
  enoShown: boolean
  enoTok?: Tok
  enoTarget?: NetworkTarget
  enable?: NetworkValue
  enTok?: Tok
  enableFlags: Mods
  named?: Tok
  st?: { statements: NetworkExecute["statements"]; ok: boolean }
}

/** A value as read: a built node, or a call whose consumer decides its connection. */
export interface Syn {
  node?: NetworkValue
  call?: BoxSyn
  /** A modifier read before a call: applied once the call is built. */
  mods?: { flags: Mods; at: Tok }
  start: Tok
  empty: boolean
  bracketed: boolean
}

export abstract class BoxReader extends TokenReader {
  protected abstract slot(consumed: boolean, at: Tok): NetworkValue
  protected abstract operand(): Syn
  protected abstract built(s: Syn, consumed: boolean): NetworkValue

  protected newBox(form: BoxSyn["form"], type: string, head: Tok): BoxSyn {
    return { form, type, head, isFb: false, operatorCall: false, operands: [], pins: [], arrows: [], enoShown: false, enableFlags: {} }
  }

  /** `opnd WORD opnd { WORD opnd } { => v }` and its pin state — one word, one box. */
  protected parseWordBox(first: Syn, consumed: boolean): NetworkValue {
    const w = this.peek()
    const syn = this.newBox("word", w.text, w)
    if (!first.empty) syn.start = first.start
    syn.operands.push(this.operandNode(first, w))
    while (isBoxWord(this.peek())) {
      const next = this.next()
      if (next.text.toUpperCase() !== syn.type.toUpperCase())
        throw this.err(
          next,
          "NETWORK_BAD_EXPRESSION",
          `'${syn.type.toUpperCase()}' and '${next.text.toUpperCase()}' at one level: one word is one box, so brackets separate boxes — \`a ${syn.type.toUpperCase()} (b ${next.text.toUpperCase()} c)\`.`,
        )
      syn.operands.push(this.operandNode(this.operand(), next))
    }
    if (isWord(this.peek(), "BRANCH"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "BRANCH after a box word: a feed that is a box word is bracketed, `(a AND b) BRANCH (x, y)`.")
    if (isWord(this.peek(), "MOVE") || isWord(this.peek(), "EXECUTE"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "a box after a word's operand: an operand that is a box stands in brackets.")
    this.arrows(syn)
    this.pinState(syn)
    return this.finalize(syn, consumed)
  }

  /** An operand as a node: the empty slot where nothing stands. */
  protected operandNode(s: Syn, at: Tok): NetworkValue {
    return s.empty ? { kind: "empty_slot", span: this.emptySpan(at) } : this.built(s, true)
  }

  /** `MOVE opnd { => v }` and its pin state. */
  protected parseMove(consumed: boolean): NetworkValue {
    const head = this.next()
    const syn = this.newBox("word", head.text, head)
    syn.operands.push(this.operandNode(this.operand(), head))
    if (isBoxWord(this.peek()))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "a box word after MOVE's operand: MOVE takes one operand — bracket a box, `MOVE (a ADD b) => x`.")
    if (isWord(this.peek(), "BRANCH"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "BRANCH after MOVE's operand: a parallel as MOVE's operand stands in brackets.")
    this.arrows(syn)
    this.pinState(syn)
    return this.finalize(syn, consumed)
  }

  /** `EXECUTE` ⏎ the ST ⏎ `END_EXECUTE` and its pin state. */
  protected parseExecute(consumed: boolean): NetworkValue {
    const kw = this.next()
    const snippet = this.next()
    if (snippet.kind !== "snippet")
      throw this.err(snippet, "NETWORK_PARSE", "EXECUTE ends its line; its ST starts on the next line and END_EXECUTE ends it.")
    const end = this.next()
    if (!isWord(end, "END_EXECUTE")) throw this.err(end, "NETWORK_PARSE", "an EXECUTE body ends with END_EXECUTE.")
    const syn = this.newBox("execute", "EXECUTE", kw)
    syn.st = this.stStatements(snippet.offset, snippet.offset + snippet.length)
    if (isSym(this.peek(), "=>")) throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "an EXECUTE box has no output pin: its one output is its ENO.")
    this.pinState(syn)
    return this.finalize(syn, consumed)
  }

  protected arrows(syn: BoxSyn): void {
    while (isSym(this.peek(), "=>")) {
      const arrow = this.next()
      if (!isTargetToken(this.peek()))
        throw this.err(arrow, "NETWORK_BAD_EXPRESSION", "`=>` with no target: a box word writes each output to a target.")
      syn.arrows.push(this.targetNode(this.next()))
    }
  }

  /** `[ENO [=> v]] [[mods] EN [src]]` — ENO where the box shows it, its EN last; `EN` alone is the empty enable. */
  protected pinState(syn: BoxSyn): void {
    if (isWord(this.peek(), "ENO")) {
      syn.enoTok = this.next()
      syn.enoShown = true
      if (isSym(this.peek(), "=>")) {
        const arrow = this.next()
        if (!isTargetToken(this.peek())) throw this.err(arrow, "NETWORK_BAD_EXPRESSION", "`ENO =>` with no target.")
        syn.enoTarget = this.targetNode(this.next())
      }
    }
    const { flags: mods, count } = this.modifiersAt(0)
    if (!isWord(this.peekAt(count), "EN")) {
      if (isSym(this.peek(), "=>"))
        throw this.err(
          this.peek(),
          "NETWORK_BAD_EXPRESSION",
          "`=>` after ENO or EN: a box writes its outputs first, then ENO, then EN — `MOVE b => a ENO EN c`.",
        )
      return
    }
    for (let k = 0; k < count; k++) this.next()
    syn.enTok = this.next()
    syn.enableFlags = mods
    const at = this.peek()
    syn.enable = at.kind === "eof" || isSym(at, ";") || isSym(at, ",") || isSym(at, ")") ? { kind: "empty_slot", span: this.emptySpan(at) } : this.slot(true, at)
    if (isWord(this.peek(), "ENO"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "ENO after EN: a box writes ENO before its EN — `MOVE b => a ENO EN c`.")
    if (isSym(this.peek(), "=>"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "`=>` after EN: a box writes its outputs before its EN — `MOVE b => a EN c`.")
  }

  /** `head(pins)[.name]`, `inst : TYPE(pins)[.name]`, `??? : TYPE(pins)` — the cursor after the head. */
  protected call(head: Tok): Syn {
    const syn = this.newBox("call", head.text, head)
    if (isSym(this.peek(), ":")) {
      this.next()
      const type = this.next()
      if (!(type.kind === "backtick" || (type.kind === "word" && !isReserved(type.text))))
        throw this.err(type, "NETWORK_BAD_EXPRESSION", "`inst : TYPE(…)` names the FB type: a name, or one between backticks.")
      if (!isSym(this.peek(), "(")) throw this.err(this.peek(), "NETWORK_PARSE", "`inst : TYPE(pins)`: the call's pins follow its type.")
      syn.isFb = true
      syn.type = type.text
      syn.typeTok = type
      const declared = head.kind !== "unnamed" ? this.scope.instanceType(head.text) : undefined
      if (declared !== undefined && !sameType(declared, type.text))
        throw this.err(type, "NETWORK_BAD_EXPRESSION", `the instance '${head.text}' is declared a '${declared}', and this call names it a '${type.text}'.`)
    } else if (head.kind === "backtick" && isOperatorBox(head.text)) {
      syn.operatorCall = true
    } else {
      const fbType = this.scope.instanceType(head.text)
      if (fbType !== undefined)
        throw this.err(head, "NETWORK_BAD_EXPRESSION", `'${head.text}' is an FB instance: its call names its type, \`${nameText(head.text)} : ${nameText(fbType)}(…)\`.`)
    }

    this.next() // (
    if (!isSym(this.peek(), ")")) {
      for (;;) {
        this.pin(syn)
        const sep = this.peek()
        if (isSym(sep, ",")) {
          this.next()
          continue
        }
        if (isSym(sep, ")")) break
        if (isWord(sep, "EN") || isWord(sep, "ENO"))
          throw this.err(
            sep,
            "NETWORK_BAD_EXPRESSION",
            `${sep.text.toUpperCase()} inside a call's brackets: a call's ENO and EN follow it, \`f(a) ENO EN c\` — a box with them is bracketed as a pin's operand.`,
          )
        throw this.unexpected(sep, "a call's pins are separated by `,` and closed by `)`")
      }
    }
    this.next() // )

    if (isSym(this.peek(), ".")) {
      const dot = this.next()
      const e = this.peek()
      if (isWord(e, "ENO")) throw this.oldEno(dot)
      if (e.kind === "backtick" || (e.kind === "word" && IDENTIFIER.test(e.text) && !isReserved(e.text))) syn.named = this.next()
      else throw this.err(e, "NETWORK_PARSE", "after a call, `.name` names the FB output a consumer reads.")
    }
    return { call: syn, start: head, empty: false, bracketed: false }
  }

  /** One pin: `[mods] name := v`, `[mods] name => t`, a positional `=> t` (a bare `=>` passes a slot over), or a
   *  positional value. */
  protected pin(syn: BoxSyn): void {
    const start = this.peek()
    if (isSym(start, "=>")) {
      this.next()
      const target = isSym(this.peek(), ",") || isSym(this.peek(), ")") ? undefined : this.targetNode(this.checkedTarget(this.next()))
      syn.pins.push({ kind: "output", ...(target !== undefined ? { target } : {}), span: this.spanFrom(start) })
      return
    }

    const { flags: mods, count } = this.modifiersAt(0)
    const nameTok = this.peekAt(count)
    const op = this.peekAt(count + 1)
    if ((nameTok.kind === "word" || nameTok.kind === "backtick") && (isSym(op, ":=") || isSym(op, "=>"))) {
      for (let k = 0; k < count; k++) this.next()
      const name = this.next()
      if (name.kind === "word" && isReserved(name.text)) {
        if (isWord(name, "EN"))
          throw this.err(name, "NETWORK_BAD_EXPRESSION", "`EN :=` in a call: the enable follows the box, `f(…) EN c`, its modifier before the word — `NOT EN c`.")
        if (isWord(name, "ENO")) throw this.err(name, "NETWORK_BAD_EXPRESSION", "`ENO =>` in a call: ENO follows the call, `f(…) ENO => v EN c`.")
        throw this.err(name, "NETWORK_BAD_EXPRESSION", `a pin named '${name.text}', a word of the text: it is written between backticks, \`${name.text}\`.`)
      }
      this.next() // := or =>
      if (isSym(op, ":=")) {
        const at = this.peek()
        const value: NetworkValue = isSym(at, ",") || isSym(at, ")") ? { kind: "empty_slot", span: this.emptySpan(op) } : this.slot(true, at)
        syn.pins.push({ kind: "input", name: this.name(name), value, ...mods, span: this.spanFrom(start) })
        return
      }
      if (!noMods(mods)) throw this.err(nameTok, "NETWORK_UNSUPPORTED", "a flag on an output pin: a modified output pin is not measured.")
      if (isSym(this.peek(), ",") || isSym(this.peek(), ")"))
        throw this.err(name, "NETWORK_BAD_EXPRESSION", `\`${name.text} =>\` wired to nothing: a named output pin holds a target, and an unwired one is not written.`)
      syn.pins.push({ kind: "output", name: this.name(name), target: this.targetNode(this.checkedTarget(this.next())), span: this.spanFrom(start) })
      return
    }
    const value = this.operand()
    syn.pins.push({ kind: "input", value: this.operandNode(value, start), span: this.spanFrom(start) })
  }

  /** `[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]` — the cursor on BRANCH. */
  protected parseParallel(feed: NetworkValue | undefined, start: Tok): NetworkValue {
    const word = this.next() // BRANCH
    const open = this.peek()
    if (!isSym(open, "(")) throw this.err(open, "NETWORK_PARSE", "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)`.")
    this.next()
    if (isSym(this.peek(), ")")) throw this.err(this.peek(), "NETWORK_UNSUPPORTED", "a parallel with no branch: `BRANCH ()` holds none.")
    const branches: NetworkValue[] = []
    for (;;) {
      const at = this.peek()
      branches.push(isSym(at, ",") || isSym(at, ")") ? { kind: "empty_slot", span: this.emptySpan(at) } : this.slot(true, at))
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
    let shortCircuit = false
    if (isWord(this.peek(), "SHORTCIRCUIT")) {
      this.next()
      shortCircuit = true
    }
    if (isWord(this.peek(), "EN") || isWord(this.peek(), "ENO") || isSym(this.peek(), "=>"))
      throw this.err(this.peek(), "NETWORK_BAD_EXPRESSION", "a pin after a parallel: a parallel is no box, and has no EN, ENO or output.")
    return {
      kind: "parallel",
      ...(feed !== undefined ? { input: feed } : {}),
      branches,
      shortCircuit,
      branchWord: this.tokSpan(word),
      span: this.spanFrom(start),
    }
  }

  // ── building the box ────────────────────────────────────────────────────────────────────────

  /**
   * A box given its consumer — the one place its connection is decided from the text: a top-level box is connected to
   * nothing; a box that shows ENO, an Execute box, and an FB read with nothing after its call (its declared ENO) are read
   * through ENO; an FB read by `.name` by that output; any other box by its value.
   */
  protected finalize(s: BoxSyn, consumed: boolean): NetworkValue {
    const isExecute = s.form === "execute"
    const isFb = s.isFb
    if (s.enoShown && s.enable === undefined && (isFb || isExecute || s.operatorCall || s.form !== "call"))
      throw this.err(
        s.head,
        "NETWORK_BAD_EXPRESSION",
        "ENO without EN: the text shows ENO on an enabled box, `MOVE b => a ENO EN c`, or on a function's, `x := f(a) ENO` — an operator's does not build without EN, and an FB's declared ENO and an EXECUTE box's are read with nothing after the box (X9).",
      )
    if (s.named !== undefined && !consumed)
      throw this.err(s.named, "NETWORK_BAD_EXPRESSION", `\`.${s.named.text}\` on a box nothing consumes: a top-level box's output goes nowhere.`)
    if (s.named !== undefined && !isFb)
      throw this.err(
        s.named,
        "NETWORK_UNSUPPORTED",
        `\`.${s.named.text}\` on '${s.head.text}', which is no FB: a function is read by its value (a function read by a declared output is not measured).`,
      )
    const hasEno = s.enoShown || isExecute || (isFb && consumed && s.named === undefined && s.enable === undefined)
    if (isFb && consumed && s.enable !== undefined && !s.enoShown && s.named === undefined)
      throw this.err(s.head, "NETWORK_BAD_EXPRESSION", "a consumed FB with EN and no ENO is read through an output: write it, `t1 : TON(…).Q EN c` — or show its ENO.")
    const readBy: NetworkWordBox["readBy"] = !consumed ? undefined : hasEno && s.named === undefined ? "eno" : isFb ? "name" : "value"

    const state = {
      ...(s.enoShown ? { eno: { span: this.tokSpan(s.enoTok!), ...(s.enoTarget !== undefined ? { target: s.enoTarget } : {}) } } : {}),
      ...(s.enable !== undefined ? { en: s.enable, enSpan: this.tokSpan(s.enTok!) } : {}),
      ...(!noMods(s.enableFlags) ? { enFlags: s.enableFlags } : {}),
      hasEno,
      ...(readBy !== undefined ? { readBy } : {}),
    }
    const span = this.spanFrom(s.start ?? s.head)

    if (s.form === "execute") return { kind: "execute", statements: s.st!.statements, ok: s.st!.ok, ...state, span }
    if (s.form === "word")
      return { kind: "word", word: s.type.toUpperCase(), head: this.name(s.head), operands: s.operands, outputs: s.arrows, ...state, span }

    const headExpr = s.head.kind !== "unnamed" ? this.tokExpr(s.head) : undefined
    const call: NetworkCall = {
      kind: "call",
      head: this.name(s.head),
      ...(headExpr !== undefined ? { headExpr } : {}),
      backticked: s.head.kind === "backtick",
      ...(s.typeTok !== undefined ? { type: this.name(s.typeTok) } : {}),
      boxType: s.type,
      pins: s.pins,
      ...(s.named !== undefined ? { output: this.name(s.named) } : {}),
      ...(isFb ? { instance: true as const } : {}),
      unnamed: s.head.kind === "unnamed",
      ...(s.operatorCall ? { operatorCall: true as const } : {}),
      ...state,
      span,
    }
    // One tree, one text: an operator in its backticked call form where its word holds it.
    if (s.operatorCall && isWordOrMoveCall(call))
      throw this.err(
        s.head,
        "NETWORK_BAD_EXPRESSION",
        s.type.toUpperCase() === "MOVE"
          ? "`MOVE`(…) in its call form where its word holds it: write `MOVE b => a`."
          : `\`${s.type}\`(…) in its call form where its word holds it: write \`a ${s.type} b\`.`,
      )
    return call
  }
}

/**
 * Whether an operator call is a tree its word or `MOVE b` writes (`NetworkTextWriter.IsWordOrMoveForm`): two or more inputs
 * of a box word (one of MOVE), none flagged, every formal its default or none, and only positional outputs filling the
 * free slots in order.
 */
export function isWordOrMoveCall(c: NetworkCall): boolean {
  if (c.instance === true) return false
  const type = c.boxType.toUpperCase()
  const inputs = c.pins.filter((p): p is NetworkInputPin => p.kind === "input")
  const shaped = (OPERATOR_WORDS.has(type) && inputs.length >= 2) || (type === "MOVE" && inputs.length === 1)
  if (!shaped) return false
  if (!inputs.every((p, i) => p.negated === undefined && p.edge === undefined && isDefaultFormal(type, i, p.name?.text))) return false
  // Positional outputs in order: a named one, or a bare `=>` passing a slot over before a wired one, is no word's.
  let gap = false
  for (const p of c.pins) {
    if (p.kind !== "output") continue
    if (p.name !== undefined) return false
    if (p.target === undefined) gap = true
    else if (gap) return false
  }
  return true
}

/** One FB type spelled two ways — IEC names are case-insensitive, and a namespace qualifies a name without changing it
 *  (`StDeclaration.SameType`). */
function sameType(declared: string, written: string): boolean {
  const qualifies = (q: string, bare: string): boolean => !bare.includes(".") && q.toUpperCase().endsWith("." + bare.toUpperCase())
  return declared.toUpperCase() === written.toUpperCase() || qualifies(declared, written) || qualifies(written, declared)
}
