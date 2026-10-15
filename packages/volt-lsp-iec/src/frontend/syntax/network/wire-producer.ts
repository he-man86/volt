/**
 * A wire's type, read off its producer (`NetworkSpelling`): what a box or a leaf says about the type of the wire it
 * feeds (`producerType`, over the text's tree), and how that disagrees with the wire's declaration. The reader's
 * `checkWireTypes` (`parser.ts`) asks these once a network is read.
 */
import type { NetworkLanguage, NetworkTextStatement, NetworkValue, NetworkWire } from "./ast.js"
import type { NetworkWireTyping } from "./cursor.js"
import { SYMBOL_TO_TYPE } from "./lexer.js"

const BOOL = "BOOL"

/** A group's operator → its box type: the lexer's table (`SYMBOL_TO_TYPE`), the one the group's operator was accepted
 *  by (`isOperator`), so a miss is a drift between the two and fails loudly rather than naming a box by its symbol. */
function operatorType(op: string): string {
  const type = SYMBOL_TO_TYPE.get(op)
  if (type === undefined)
    throw new Error(`network text: the group operator '${op}' has no box type in the lexer's table`)
  return type
}

/** A bit operator box (AND, OR, XOR, NOT): the rule types it ANY_BIT — in ladder, its inputs are contacts. */
function isBitOperatorBox(type: string, typing: NetworkWireTyping): boolean {
  const result = typing.operatorResult(type)
  return result !== undefined && "group" in result
}

/** What a producer says of a wire's type: an exact type, "BOOL or another bit string", or nothing. */
interface Produced {
  exact?: string
  anyBit?: boolean
}

/** A box's word on its output, with no stored output type (the text carries none): the operators' own rule
 *  (`types/arith/operators` `operatorFunctionResult`) — a comparison BOOL, a bit operator a type of ANY_BIT. */
function boxProduces(type: string, typing: NetworkWireTyping): Produced {
  const result = typing.operatorResult(type)
  if (result === undefined) return {}
  return "exact" in result ? { exact: result.exact } : { anyBit: true }
}

/** A type as the comparison reads it: its tokens, not its layout (`STRING (80)` is `STRING(80)`). */
const typeKey = (t: string): string => t.replace(/\s+/g, "").toUpperCase()

/** How `p` disagrees with a DECLARED type — what the producer says instead — or undefined (`NetworkSpelling.Disagreement`). */
export function disagreement(p: Produced, declared: string, typing: NetworkWireTyping): string | undefined {
  if (p.exact !== undefined) return typeKey(p.exact) === typeKey(declared) ? undefined : p.exact
  return p.anyBit === true && !typing.isBitWireType(typeKey(declared))
    ? "a bit operator, whose result is BOOL or another bit string (BYTE, WORD, DWORD, LWORD)"
    : undefined
}

/** `NetworkSpelling.ProducerType` over the text's tree. A modifier (`NOT`) is a flag on the node it stands on, so it
 *  is looked through; an edge flag makes anything BOOL. */
export function producerType(
  v: NetworkValue,
  wire: NetworkWire,
  statements: readonly NetworkTextStatement[],
  wires: readonly NetworkWire[],
  language: NetworkLanguage,
  typing: NetworkWireTyping,
): Produced {
  switch (v.kind) {
    case "edge":
    case "parallel":
    case "execute":
      return { exact: BOOL }
    case "not":
      return producerType(v.operand, wire, statements, wires, language, typing)
    case "operand":
      if (/^(TRUE|FALSE)$/i.test(v.text)) return { exact: BOOL }
      return everyUseIsBoolean(wire, statements, language, typing) ? { exact: BOOL } : {}
    case "wire_ref": {
      const other = wires.find((w) => w.name.text.toUpperCase() === v.name.text.toUpperCase())
      return other !== undefined ? { exact: other.typeText } : {}
    }
    case "group":
      return boxProduces(operatorType(v.op), typing)
    case "call":
      return v.eno ? { exact: BOOL } : boxProduces(v.boxType, typing)
    case "empty_slot":
      return {}
  }
}

/** Whether `wire` is referenced at least once and only where a BOOL is taken (`NetworkSpelling.EveryUseIsBoolean`):
 *  an EN, a Parallel, a jump condition, and in ladder a coil or a contact (a bit operator's input). */
function everyUseIsBoolean(
  wire: NetworkWire,
  statements: readonly NetworkTextStatement[],
  language: NetworkLanguage,
  typing: NetworkWireTyping,
): boolean {
  const key = wire.name.text.toUpperCase()
  const ld = language === "LD"
  let any = false
  let all = true
  const walk = (v: NetworkValue, boolean: boolean): void => {
    switch (v.kind) {
      case "wire_ref":
        if (v.name.text.toUpperCase() !== key) return
        any = true
        all &&= boolean
        return
      case "not":
      case "edge":
        return walk(v.operand, boolean)
      case "group": {
        const contacts = ld && isBitOperatorBox(operatorType(v.op), typing)
        for (const o of v.operands) walk(o, contacts)
        return
      }
      case "call": {
        const contacts = ld && isBitOperatorBox(v.boxType.toUpperCase(), typing)
        for (const p of v.pins) if (p.kind === "input") walk(p.value, p.name?.text.toUpperCase() === "EN" || contacts)
        return
      }
      case "execute":
        if (v.en !== undefined) walk(v.en, true)
        return
      case "parallel":
        if (v.input !== undefined) walk(v.input, true)
        for (const b of v.branches) walk(b, true)
        return
      default:
        return
    }
  }
  for (const s of statements)
    switch (s.kind) {
      case "assign":
        walk(s.value, ld) // a ladder coil takes a BOOL
        break
      case "jump":
      case "return":
        if (s.condition !== undefined) walk(s.condition, true)
        break
      case "wire_def": // boolean or not rides the other wire's uses — not proven
      case "value": // a top-level output goes nowhere
        walk(s.value, false)
        break
      case "empty":
        break
    }
  return any && all
}
