/**
 * A DIRECT ADDRESS'S SHAPE — `%<area>[<size>]<position>`, or `%<area>*` — as both vendors take it or refuse it. The
 * lexer reads `%`, the area, an optional size letter and a run of digits and dots (or the `*` right after the area);
 * whether that is an address is decided here, once, for the declaration (`AT`) and for an address used as an operand.
 *
 * Measured on CODESYS and TwinCAT alike (`lit_address_*`, `addr_*`, 2026-10-01):
 *   complete     `%IX0.0` `%MX10.8` `%IB8` `%MW6` `%MD0` `%ML1`, any case — X with exactly two segments, B/W/D/L with
 *                exactly one; the bit number is NOT checked against a byte (`%MX10.8` builds)
 *   incomplete   `%I*` `%Q*` `%M*`
 *   no-position  `%IW` (and `%IW*`, which lexes `%IW` then `*`) — "Direct address expected after AT instead of %IW"
 *   malformed    no size letter, or the wrong number of segments — "Direct address '%I?0.0' malformed", the missing
 *                size letter echoed as `?`
 */
export type AddressShape =
  | { kind: "complete" }
  | { kind: "incomplete" }
  | { kind: "no-position" }
  | { kind: "malformed"; echo: string }

const ADDRESS = /^%([IQM])(\*|([XBWDL]?)([\d.]*))$/i

/** The shape of an `address_lit` token's text. A text the lexer cannot produce is refused by name. */
export function addressShape(text: string): AddressShape {
  const m = ADDRESS.exec(text)
  if (m === null) throw new Error(`'${text}' is not an address token`)
  const [, area, rest, size, position] = m
  if (rest === "*") return { kind: "incomplete" }
  if (position === "") return { kind: "no-position" }
  if (size === "") return { kind: "malformed", echo: `%${area}?${position}` }
  const segments = position.split(".")
  const wanted = size.toUpperCase() === "X" ? 2 : 1
  return segments.length === wanted && segments.every((s) => s !== "") ? { kind: "complete" } : { kind: "malformed", echo: text }
}
