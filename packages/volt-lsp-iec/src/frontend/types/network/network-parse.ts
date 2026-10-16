/**
 * THE NETWORK-TEXT READER — the one entry every caller of the type layer uses (`syntax/network`, openspec ld-fbd-coverage
 * 2R.3). A split carries no type of its own (B6), so the reader asks the type layer nothing.
 */
import { readNetworkText, type BodySpan, type Dialect, type NetworkScopeView, type NetworkTextBody, type STRUCTURE_ONLY } from "../../syntax/index.js"

/** Parse a graphical body into networks, statements and the bridge reader's findings. Everything that reads the
 *  statements passes the POU's scope (`types/network/network-analyze`). */
export function parseNetworkText(body: BodySpan, scope: NetworkScopeView | typeof STRUCTURE_ONLY, dialect: Dialect): NetworkTextBody {
  return readNetworkText(body, scope, dialect)
}
