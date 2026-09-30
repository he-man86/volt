/**
 * A NETWORK-TEXT BODY'S HEADER, as the Volt file format recognizes one (rule FMT8): the test a body is held against its
 * stated language by — the bridge's `NetworkText.OpensNetwork`. The network-text grammar itself is `network-text/`'s.
 */
import type { Token } from "../lex/tokens.js"
import { lineAround, nextSignificant } from "./lines.js"

// `NETWORK` opening a line with a header FIELD after it — the way a network-text body opens and no ST statement can —
// or `NETWORK` alone on its line with an `END_NETWORK` line later, which no ST statement wrapped after a name `network`
// has. The bridge's `NetworkText.OpensNetwork`, the one test a body is held against its stated language by.
const FIELDED_HEADER = /^\s*NETWORK\s+(LABEL\s*:|TITLE\s*:|DISABLED\b|\d)/i
const BARE_HEADER = /^\s*NETWORK\s*$/i
const END_NETWORK = /^\s*END_NETWORK\b/i

export function opensNetwork(code: readonly Token[]): boolean {
  const at = nextSignificant(code, 0)
  if (at >= code.length || code[at]!.kind === "eof") return false
  const line = lineAround(code, at, true).text
  if (FIELDED_HEADER.test(line)) return true
  if (!BARE_HEADER.test(line)) return false
  for (let i = at + 1; i < code.length; i++)
    if (code[i]!.kind === "identifier" && code[i]!.text.toUpperCase() === "END_NETWORK" && END_NETWORK.test(lineAround(code, i, true).text))
      return true
  return false
}
