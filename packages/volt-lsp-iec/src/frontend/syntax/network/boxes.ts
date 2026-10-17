/**
 * The reader's BOXES — the half of the bridge reader's values (`NetworkTextReader.cs`, openspec ld-fbd-coverage 2R.3)
 * that builds what a level parsed: a leaf, a modifier on a value (N17, N20), a SLOT's and an OPERAND's value (P4), and a
 * box given its ROLE — a top-level item, an open line a later `ENO` takes, or a value — the one place the refusals that
 * depend on the role are raised (`Finalize`). The level parsing itself is `values.ts`, the targets `targets.ts`.
 */
import type { Expr } from "../ast/nodes/index.js"
import type { NetworkCall, NetworkExecute, NetworkName, NetworkPin, NetworkPinFlags, NetworkTarget, NetworkValue } from "./ast.js"
import { NetworkCursor } from "./cursor.js"
import { type Tok, isSym } from "./lexer.js"
import { BIT_OPERATORS, COMPARISONS, OPERATOR_WORDS, TWO_INPUT_OPERATORS } from "./words.js"

/** Who consumes a box: nothing (a top-level item), a later line's ENO (an open line), or a consumer reading its data. */
export type Role = "top" | "eno" | "value"

/** A box as written, before its role is known to the value it stands in. */
export interface BoxSyn {
  kind: "word" | "call" | "execute"
  /** The box's type: a word upper-cased, an operator's call form as written, a call's head or FB type. */
  type: string
  /** Where the box is named — the word, the call's head, EXECUTE. */
  head: Tok
  /** The box's first token, and the end of its text. */
  from: Tok
  to: number
  operands: NetworkValue[]
  /** The inputs as the vendor holds them: a default formal read back as none (P5). */
  inputs: { formal?: string; value: NetworkValue; negated: boolean; edge?: "rising" | "falling" }[]
  outputs: { formal?: string; target?: Tok; positional: boolean }[]
  wordOutputs: NetworkTarget[]
  pins: NetworkPin[]
  en?: NetworkValue
  enTok?: Tok
  /** The EN pin's own modifiers, `NOT EN c` (2R.5). */
  enFlags?: NetworkPinFlags
  hadEn: boolean
  named?: Tok
  modifiers: { kind: "not" | "rise" | "fall"; tok: Tok }[]
  operatorCall: boolean
  instance: boolean
  backticked: boolean
  headExpr?: Expr
  unnamedType?: NetworkName
  execute?: Omit<NetworkExecute, "kind" | "en" | "enSpan" | "span">
}

/** A value as parsed: a built node, or a box whose role its consumer decides. `word` is a box word, MOVE's word form or a
 *  parallel — what P4 (1) brackets as an operand of another word. */
export interface Syn {
  node?: NetworkValue
  box?: BoxSyn
  start: Tok
  bracketed: boolean
  word: boolean
  empty: boolean
  /** A modifier's brackets carry the value whole (`NOT (a GT b EN c)`, `R_EDGE(…)`): no bracket rule applies to it. */
  covered: boolean
}

export const syn = (start: Tok, rest: Partial<Syn>): Syn => ({ start, bracketed: false, word: false, empty: false, covered: false, ...rest })

/** An empty slot, or a negated one (`NOT ;`, 2R.5) — a position, never a box word's operand. */
export const isEmptyValue = (v: NetworkValue): boolean => v.kind === "empty_slot" || (v.kind === "not" && v.operand.kind === "empty_slot")

export const enabledComparison = (s: Syn): boolean =>

  !s.covered && s.box !== undefined && s.box.hadEn && COMPARISONS.has(s.box.type.toUpperCase())

export abstract class BoxReader extends NetworkCursor {
  /** One bracket level (`values.ts`): a slot holds one. */
  protected abstract parseLevel(): Syn

  protected leaf(t: Tok): Syn {
    const expr = this.tokExpr(t)
    const node: NetworkValue = {
      kind: "operand",
      text: t.text,
      backticked: t.kind === "backtick",
      unnamed: t.kind === "unnamed",
      ...(expr !== undefined ? { expr } : {}),
      span: this.tokSpan(t),
    }
    return syn(t, { node })
  }

  /** A modifier on a parsed value: on a built node, or on a box whose role is still open. N20: no flag on a split or a
   *  parallel. */
  protected flagged(inner: Syn, modifier: Tok, kind: "not" | "rise" | "fall"): Syn {
    const word = modifier.text.toUpperCase()
    if (inner.box !== undefined) {
      this.addFlag(inner.box.modifiers, modifier, kind)
      return syn(modifier, { box: inner.box, covered: true })
    }
    const node = inner.node!
    switch (node.kind) {
      case "split_ref":
      case "nested_split":

        throw this.err(
          modifier,
          "NETWORK_UNSUPPORTED",
          `${word} on a split: the IDE holds no flag on a split (N20); put it on the split's feeder or a consumer.`,
        )
      case "parallel":
        throw this.err(
          modifier,
          "NETWORK_UNSUPPORTED",
          `${word} on a parallel: the IDE holds no flag on a parallel (N20, P6) — \`NOT s BRANCH (a, b)\` negates the feed.`,
        )
      case "empty_slot":
        throw this.err(modifier, "NETWORK_UNSUPPORTED", "a flag on an empty slot: an unconnected position has no text to modify.")
      case "nested_assign":
        throw this.err(
          modifier,
          "NETWORK_UNSUPPORTED",
          `${word} on an assignment below the top level: the IDE holds no flag on an Assign item (census 1.1).`,
        )
    }
    const flags = this.flagsOf(node)
    this.addFlag(flags, modifier, kind)
    return syn(modifier, { node: this.wrap(node, [{ kind, tok: modifier }]) })
  }

  /** The modifiers a built node already carries, outermost last (an edge around a negation, N17). */
  private flagsOf(node: NetworkValue): { kind: "not" | "rise" | "fall"; tok: Tok }[] {
    const out: { kind: "not" | "rise" | "fall"; tok: Tok }[] = []
    for (let n = node; n.kind === "not" || n.kind === "edge"; n = n.operand)
      out.unshift({ kind: n.kind === "not" ? "not" : n.rising ? "rise" : "fall", tok: { kind: "word", text: "", offset: 0, length: 0, atLineStart: false } })
    return out
  }

  private addFlag(flags: { kind: "not" | "rise" | "fall"; tok: Tok }[], modifier: Tok, kind: "not" | "rise" | "fall"): void {
    if (kind === "not" && flags.some((f) => f.kind === "not"))
      throw this.err(modifier, "NETWORK_BAD_EXPRESSION", "NOT twice on one operand: one negation flag.")
    if (kind !== "not" && flags.some((f) => f.kind !== "not"))
      throw this.err(modifier, "NETWORK_UNSUPPORTED", "nested edges: one operand carries one edge flag, and rising with falling has no spelling.")
    flags.push({ kind, tok: modifier })
  }

  /** A node wrapped in its modifiers, innermost first: each spans from its word to the node's end. */
  protected wrap(node: NetworkValue, modifiers: readonly { kind: "not" | "rise" | "fall"; tok: Tok }[]): NetworkValue {
    let out = node
    for (const m of modifiers) {
      const span = this.span(m.tok.offset, Math.max(m.tok.offset + m.tok.length, this.offsetOfEnd(out)))
      out = m.kind === "not" ? { kind: "not", operand: out, span } : { kind: "edge", rising: m.kind === "rise", operand: out, span }
    }
    return out
  }

  /** The body-text offset a node's span ends at. */
  private offsetOfEnd(n: NetworkValue): number {
    return n.span.end - (this.span(0, 0).start)
  }

  // ── slots and operands (P4) ─────────────────────────────────────────────────────────────────

  /** A slot's value parsed from the cursor (`slot`). */
  protected slotHere(): NetworkValue {
    const at = this.peek()
    return this.slot(this.parseLevel(), at)
  }

  /** A slot's value after its storage operator — the empty slot where none stands (`FirstCycle R= ;`, the rail). */
  protected slotValue(op: Tok): NetworkValue {
    const t = this.peek()
    return this.atEnd() || isSym(t, ";") || isSym(t, ")") ? { kind: "empty_slot", span: this.span(op.offset + op.length, op.offset + op.length) } : this.slotHere()
  }

  /** P4: a SLOT's value — a coil's, a split's, a jump's, an EN tail, a pin, a call argument, a branch. It holds one box
   *  unbracketed; only an enabled comparison is bracketed, and it always is. */
  protected slot(s: Syn, at: Tok): NetworkValue {
    if (s.empty) throw this.err(at, "NETWORK_PARSE", "a value is expected here.")
    if (s.bracketed && !enabledComparison(s))
      throw this.err(
        s.start,
        "NETWORK_BAD_EXPRESSION",
        "a redundant bracket: a slot (a coil's value, an EN tail, a pin, a call argument, a branch) holds one box without brackets (B5, P4).",
      )
    if (!s.bracketed && enabledComparison(s))
      throw this.err(s.start, "NETWORK_BAD_EXPRESSION", "an enabled comparison used as a value stands in brackets, `(a GT 40 EN c)` (B5, P4).")
    return s.box !== undefined ? this.finalize(s.box, "value") : s.node!
  }

  /** P4: an OPERAND of a box word — its inputs, MOVE's operand, a parallel's feed. */
  protected operand(s: Syn): NetworkValue {
    return s.box !== undefined ? this.finalize(s.box, "value") : s.node!
  }

  // ── a box given its role ────────────────────────────────────────────────────────────────────

  protected newBox(kind: BoxSyn["kind"], type: string, head: Tok, from: Tok): BoxSyn {
    return {
      kind,
      type,
      head,
      from,
      to: head.offset + head.length,
      operands: [],
      inputs: [],
      outputs: [],
      wordOutputs: [],
      pins: [],
      hadEn: false,
      modifiers: [],
      operatorCall: false,
      instance: false,
      backticked: false,
    }
  }

  /** The refusals a box's ROLE alone decides (`Finalize`): an EXECUTE or an enabled box read as a value, and what an
   *  open line's box may not be (B4, P3, N21). */
  private refuseForRole(s: BoxSyn, role: Role, upper: string, isExecute: boolean): void {
    if (role === "value" && isExecute) throw this.err(s.head, "NETWORK_BAD_EXPRESSION", "an EXECUTE box read as a value: its only output is ENO (P8).")
    if (role === "value" && s.hadEn && !COMPARISONS.has(upper))
      throw this.err(
        s.head,
        "NETWORK_BAD_EXPRESSION",
        `an enabled '${s.type}' read as a value: an enabled box is the root of its line, its value leaving only through \`=>\` or ENO (B4, N21) — write \`… => t EN c\`, or the box on its own line and \`coil := ENO;\`.`,
      )
    if (role === "eno") {
      // A comparison is a box like any other (2R.5, awkward-sweep #22): enabled on an open line, its ENO read below.
      if (!s.hadEn && !isExecute && (OPERATOR_WORDS.has(upper) || s.operatorCall || upper === "MOVE"))
        throw this.err(
          s.head,
          "NETWORK_BAD_EXPRESSION",
          `${upper} without EN on an open line: an operator box shows ENO only with EN (N21) — end the line with \`;\` (P3).`,
        )
      if (s.modifiers.length > 0)
        throw this.err(
          s.head,
          "NETWORK_BAD_EXPRESSION",
          "a modifier on an open line: the box a later line reads carries its modifier at the ENO there, `x := NOT ENO;` (P3).",
        )
    }
  }

  /**
   * A box given its role — the one place the refusals that depend on it are raised (`Finalize`): read by a later line's
   * ENO, read by a consumer's data, or a top-level item.
   */
  protected finalize(s: BoxSyn, role: Role): NetworkValue {
    const consumed = role !== "top"
    const byEno = role === "eno"
    const upper = s.type.toUpperCase()
    const isExecute = s.kind === "execute"

    this.refuseForRole(s, role, upper, isExecute)

    const span = this.span(s.from.offset, Math.max(s.from.offset + s.from.length, s.to))
    const enPart = {
      ...(s.en !== undefined ? { en: s.en } : {}),
      ...(s.enTok !== undefined ? { enSpan: this.tokSpan(s.enTok) } : {}),
      ...(s.enFlags !== undefined ? { enFlags: s.enFlags } : {}),
    }
    if (isExecute) return this.wrap({ kind: "execute", ...s.execute!, ...enPart, span }, s.modifiers)

    if (s.named !== undefined) {
      if (!consumed || byEno)
        throw this.err(
          s.named,
          "NETWORK_BAD_EXPRESSION",
          `\`.${s.named.text}\` on '${s.head.text}', which no consumer reads by its data: a top-level box's output goes nowhere.`,
        )
      if (BIT_OPERATORS.has(upper))
        throw this.err(s.named, "NETWORK_BAD_EXPRESSION", `\`.${s.named.text}\` on a ${upper} box: a bit operator stores no main output to read by name.`)
    }

    const hasEno = byEno || (!consumed && s.hadEn)
    if (!hasEno && s.outputs.some((o) => o.formal?.toUpperCase() === "ENO"))
      throw this.err(
        s.head,
        "NETWORK_BAD_EXPRESSION",
        `\`ENO =>\` on a '${s.type}' box that has no ENO: a box shows ENO with EN, or where a later line reads it (P5).`,
      )

    if (s.operatorCall && TWO_INPUT_OPERATORS.has(upper) && s.inputs.length > 2)
      throw this.err(s.head, "NETWORK_UNSUPPORTED", `${upper} takes 2 inputs, and this one holds ${s.inputs.length}: the build refuses it (C3, B1).`)
    // 2R.5 (awkward-sweep #4): fewer than two inputs stores, and the build refuses it on both vendors (ng_r5_one_input_*).
    if (s.operatorCall && OPERATOR_WORDS.has(upper) && s.inputs.length < 2)
      throw this.err(
        s.head,
        "NETWORK_UNSUPPORTED",
        `${upper} takes at least 2 inputs, and this one holds ${s.inputs.length}: the build refuses it ("needs at least '2' operands").`,
      )

    // P5: an operator's call form only where its word form cannot carry the tree — one tree, one text.
    if (s.operatorCall && this.isWordForm(s))
      throw this.err(s.head, "NETWORK_BAD_EXPRESSION", `${s.type}(…) in its call form where its word fits: write \`a ${upper} b\` (B1, P5).`)
    if (s.operatorCall && this.isMoveWordForm(s))
      throw this.err(s.head, "NETWORK_BAD_EXPRESSION", "MOVE(…) in its call form where its word fits: write `MOVE b => a` (B2, P5).")

    if (s.kind === "word")
      return this.wrap({ kind: "word", word: upper, head: this.name(s.head), operands: s.operands, outputs: s.wordOutputs, ...enPart, span }, s.modifiers)
    const call: NetworkCall = {
      kind: "call",
      head: s.backticked ? { text: s.head.text, span: this.tokSpan(s.head) } : this.name(s.head),
      ...(s.headExpr !== undefined ? { headExpr: s.headExpr } : {}),
      backticked: s.backticked,
      ...(s.unnamedType !== undefined ? { unnamedType: s.unnamedType } : {}),
      boxType: s.type,
      pins: s.pins,
      ...(s.named !== undefined ? { output: this.name(s.named) } : {}),
      ...(s.instance ? { instance: true as const } : {}),
      ...(s.operatorCall ? { operatorCall: true as const } : {}),
      ...enPart,
      span,
    }
    return this.wrap(call, s.modifiers)
  }

  /** B1: whether an operator box is written as its WORD (`NetworkSpelling.IsWordForm`): its type the table's word in
   *  capitals, no instance, two or more inputs, none empty or flagged, formals the defaults, outputs positional in order. */
  private isWordForm(s: BoxSyn): boolean {
    return OPERATOR_WORDS.has(s.type) && s.type === s.type.toUpperCase() && !s.instance && s.inputs.length >= 2 && this.wordFormPins(s)
  }

  /** B2: whether a MOVE box is `MOVE b => a` (`NetworkSpelling.IsMoveWordForm`). */
  private isMoveWordForm(s: BoxSyn): boolean {
    return s.type === "MOVE" && !s.instance && s.inputs.length === 1 && this.wordFormPins(s)
  }

  private wordFormPins(s: BoxSyn): boolean {
    return (
      s.inputs.every((p) => !isEmptyValue(p.value) && !p.negated && p.edge === undefined && p.formal === undefined) &&
      s.outputs.every((o) => o.formal === undefined && o.target !== undefined)
    )
  }
}
