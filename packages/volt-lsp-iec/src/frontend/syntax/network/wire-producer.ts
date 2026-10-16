/**
 * A wire's type, read off its producer (`NetworkSpelling`): what a box or a leaf says about the type of the wire it
 * feeds (`producerType`, over the text's tree), and how that disagrees with the wire's declaration. The reader's
 * `checkWireTypes` (`parser.ts`) asks these once a network is read.
 */
import type { NetworkLanguage, NetworkPragma, NetworkValue, NetworkWire } from "./ast.js"
import type { NetworkWireTyping } from "./cursor.js"
import { SYMBOL_TO_TYPE } from "./lexer.js"
import { pragmaStrings } from "./pragma.js"

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

/** The output type a box STORES at the slot its consumer reads, where its pragma spells its types (openspec
 *  ld-fbd-coverage 2.3, `NetworkSpelling.ProducerType`): the main output — on a bit operator the stored one, where it
 *  stores an output (S1), or the one slot it types. Undefined where the text spells none, or the slot's is empty. */
function storedType(pragmas: readonly NetworkPragma[] | undefined, bitOperator: boolean): string | undefined {
  const types = pragmaStrings(pragmas, "OutputParam.Types")
  if (types === undefined) return undefined
  const names = pragmaStrings(pragmas, "OutputParam.Names")
  const slot = !bitOperator || (names?.length ?? 0) > 0 || types.length === 1 ? 0 : undefined
  const t = slot !== undefined ? types[slot] : undefined
  return t !== undefined && t.trim().length > 0 ? t : undefined
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
 *  is looked through; an edge flag makes anything BOOL. A leaf says nothing but a literal's BOOL: the type it stores IS
 *  the wire's declaration (S3a, openspec ld-fbd-coverage 2.3 — what replaced reading it off the wire's uses), and in LD
 *  the left rail, a wire fed by nothing, is BOOL (S3b). */
export function producerType(
  v: NetworkValue,
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
      return producerType(v.operand, wires, language, typing)
    case "nested_assign":
      return producerType(v.value, wires, language, typing)
    case "operand":
      return /^(TRUE|FALSE)$/i.test(v.text) ? { exact: BOOL } : {}
    case "wire_ref": {
      const other = wires.find((w) => w.name.text.toUpperCase() === v.name.text.toUpperCase())
      return other !== undefined ? { exact: other.typeText } : {}
    }
    case "group": {
      const type = operatorType(v.op)
      const stored = storedType(v.pragmas, isBitOperatorBox(type, typing))
      return stored !== undefined ? { exact: stored } : boxProduces(type, typing)
    }
    case "call": {
      if (v.eno) return { exact: BOOL }
      const stored = storedType(v.pragmas, isBitOperatorBox(v.boxType.toUpperCase(), typing))
      return stored !== undefined ? { exact: stored } : boxProduces(v.boxType, typing)
    }
    case "empty_slot":
      return language === "LD" ? { exact: BOOL } : {}
  }
}
