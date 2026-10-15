/**
 * A wire's type, read off its producer (`NetworkSpelling`): what a box or a leaf says about the type of the wire it
 * feeds, and how that disagrees with the wire's declaration. Moved out of `parser.ts` unchanged (openspec
 * ld-fbd-coverage 1b.4, the size ratchet); the parser's producer walk asks these.
 */
import { SYMBOL_TO_TYPE } from "./lexer.js"

/** The two questions these ask of the type layer — the parser's `NetworkWireTyping`, named here by shape so this module
 *  does not import the parser that imports it. */
interface OperatorTyping {
  operatorResult(name: string): { exact: "BOOL" } | { group: "ANY_BIT" } | undefined
  isBitWireType(name: string): boolean
}

export const BOOL = "BOOL"

/** A group's operator → its box type: the lexer's table (`SYMBOL_TO_TYPE`), the one the group's operator was accepted
 *  by (`isOperator`), so a miss is a drift between the two and fails loudly rather than naming a box by its symbol. */
export function operatorType(op: string): string {
  const type = SYMBOL_TO_TYPE.get(op)
  if (type === undefined)
    throw new Error(`network text: the group operator '${op}' has no box type in the lexer's table`)
  return type
}

/** A bit operator box (AND, OR, XOR, NOT): the rule types it ANY_BIT — in ladder, its inputs are contacts. */
export function isBitOperatorBox(type: string, typing: OperatorTyping): boolean {
  const result = typing.operatorResult(type)
  return result !== undefined && "group" in result
}

/** What a producer says of a wire's type: an exact type, "BOOL or another bit string", or nothing. */
export interface Produced {
  exact?: string
  anyBit?: boolean
}

/** A box's word on its output, with no stored output type (the text carries none): the operators' own rule
 *  (`types/arith/operators` `operatorFunctionResult`) — a comparison BOOL, a bit operator a type of ANY_BIT. */
export function boxProduces(type: string, typing: OperatorTyping): Produced {
  const result = typing.operatorResult(type)
  if (result === undefined) return {}
  return "exact" in result ? { exact: result.exact } : { anyBit: true }
}

/** A type as the comparison reads it: its tokens, not its layout (`STRING (80)` is `STRING(80)`). */
const typeKey = (t: string): string => t.replace(/\s+/g, "").toUpperCase()

/** How `p` disagrees with a DECLARED type — what the producer says instead — or undefined (`NetworkSpelling.Disagreement`). */
export function disagreement(p: Produced, declared: string, typing: OperatorTyping): string | undefined {
  if (p.exact !== undefined) return typeKey(p.exact) === typeKey(declared) ? undefined : p.exact
  return p.anyBit === true && !typing.isBitWireType(typeKey(declared))
    ? "a bit operator, whose result is BOOL or another bit string (BYTE, WORD, DWORD, LWORD)"
    : undefined
}
