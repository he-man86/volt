import { test, expect } from "bun:test"
import { addressShape } from "./address.js"

test("an address is complete, incomplete, missing its position, or malformed — as the vendor echoes it (A1, A2)", () => {
  // `addr_*`, `lit_address_{lword,lowercase,bit_8}` build — the bit number is not checked against a byte
  for (const a of ["%IX0.0", "%QX0.0", "%MX10.8", "%mx9.2", "%IB8", "%MW6", "%MD0", "%ML1"]) expect(addressShape(a)).toEqual({ kind: "complete" })
  // `lit_address_incomplete*`
  for (const a of ["%I*", "%Q*", "%M*"]) expect(addressShape(a)).toEqual({ kind: "incomplete" })
  // `lit_address_incomplete_sized` (`%IW*` lexes `%IW` then `*`), `lit_address_no_position`: "Direct address expected
  // after AT instead of %IW"
  for (const a of ["%IW", "%MW"]) expect(addressShape(a)).toEqual({ kind: "no-position" })
  // `lit_address_unsized*`: "Direct address '%I?0.0' malformed" — the missing size letter echoed as `?`
  expect(addressShape("%I0.0")).toEqual({ kind: "malformed", echo: "%I?0.0" })
  expect(addressShape("%M0")).toEqual({ kind: "malformed", echo: "%M?0" })
  // `lit_address_bit_no_bit`, `_bit_three_segments`, `_two_segments`, `_multi_segment`: a bit is X with exactly two
  // segments, every other size exactly one
  for (const a of ["%MX3", "%MX1.2.3", "%MW2.5", "%IW2.5.7.1"]) expect(addressShape(a)).toEqual({ kind: "malformed", echo: a })
})
