/**
 * THE NETWORK-TEXT READER, TYPED — `syntax/network` reads a graphical body and types its wires by the operators' rule,
 * which is this layer's (`arith/operators`); this is where the two meet, and the one entry every caller uses.
 */
import { readNetworkText, type BodySpan, type Dialect, type NetworkScopeView, type NetworkTextBody, type NetworkWireTyping, type STRUCTURE_ONLY } from "../../syntax/index.js"
import { isBitOperatorWireType, operatorFunctionResult } from "../arith/operators.js"

const WIRE_TYPING: NetworkWireTyping = { operatorResult: operatorFunctionResult, isBitWireType: isBitOperatorWireType }

/** Parse a graphical body into networks, statements and the bridge reader's structural findings. Everything that reads
 *  the statements passes the POU's scope (`types/network/network-analyze`). */
export function parseNetworkText(
  body: BodySpan,
  scope: NetworkScopeView | typeof STRUCTURE_ONLY,
  dialect: Dialect,
): NetworkTextBody {
  return readNetworkText(body, scope, dialect, WIRE_TYPING)
}
