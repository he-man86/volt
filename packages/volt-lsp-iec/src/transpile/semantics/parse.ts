/** STRING → NUMBER: the prefix a STRING_TO_* conversion reads (conformance `string_conversions*`, `string_to_real_parse`). */

/** A decimal prefix after spaces/tabs: '.5', '5.', '1.5E' (1.5), '2e2', '1,5' (1); none at all is 0 (`string_to_real_parse`). */
export function parseReal(text: string): number {
  const m = /^[ \t]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text)
  return m === null ? 0 : Number(m[1])
}

/**
 * STRING → integer: leading spaces and tabs skipped, then
 *   - with no sign, a based number written `2#`, `8#` or `16#` — its digits in that base, either case ('16#FF' and '16#ff'
 *     are 255, '2#101' 5, '8#17' 15); no other base ('3#12' is 3, '10#99' 10, '016#F' 16), and none after a sign ('-16#F' is
 *     -16, '+16#F' 16);
 *   - else an optional sign and decimal digits ('+5' 5, '$T7' 7);
 * an underscore ANYWHERE among the digits skipped ('1_000' 1000, '_5' 5, '-_5' -5, '16#_F' 15, '16#FF_FF' 65535), the first
 * other character ending them ('12abc' 12, '8#19' 1, '1 0' 1, '16#G' and 'INT#5' 0, '- 5' and '' 0). The value is stored at
 * the target's width ('16#FFFF' is INT -1, '16#123456789' DINT 591751049). Recorded: conformance `string_conversions*`,
 * `xf_string_to_int_*`, the `tr_a10_*` cells of `parse.cases.ts` (6.A.10). UNASKED: a base written with an underscore in it
 * ('1_6#F'), and a number PAST 2^64 — the one recorded ('16#1FFFFFFFFFFFFFFFF' LWORD all ones, `tr_a10_string_to_64bit_based`)
 * has its low 64 bits all ones, where wrapping, saturating and dropping the extra digits agree; this wraps at 64 bits, and
 * any other such number (where they part) is niche: accepted loss (0 occurrences in the corpora — no STRING_TO_LWORD,
 * _ULINT or _LINT call; 6Aa+6Ae gate review).
 */
export function parseInteger(text: string): bigint {
  let i = /^[ \t]*/.exec(text)![0].length
  const sign = text[i] === "-" || text[i] === "+" ? text[i++] : ""
  const based = sign === "" ? /^(2|8|16)#/.exec(text.slice(i)) : null
  const radix = based === null ? 10 : Number(based[1])
  if (based !== null) i += based[0].length
  let value = 0n
  for (; i < text.length; i++) {
    if (text[i] === "_") continue
    const digit = parseInt(text[i]!, radix)
    if (Number.isNaN(digit)) break
    value = BigInt.asUintN(64, value * BigInt(radix) + BigInt(digit))
  }
  return sign === "-" ? -value : value
}
