/**
 * locations (Layer E · shared). The ONE `Symbol → LSP Location` mapping (defining identifier range).
 */
import type { Location } from "vscode-languageserver-protocol"
import type { Symbol } from "../../symbols/index.js"
import { rangeFromSpan } from "./positions.js"

export function locationOf(sym: Symbol): Location {
  return { uri: sym.uri, range: rangeFromSpan(sym.span) }
}
