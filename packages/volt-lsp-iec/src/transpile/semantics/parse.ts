/** STRING → NUMBER: the prefix a STRING_TO_* conversion reads (conformance `string_conversions*`, `string_to_real_parse`), and
 *  the whole text a WSTRING_TO_<integer> reads (`wstring_parse_grammar`). */

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
 * _ULINT or _LINT call; 6Aa+6Ae gate review). A NEGATIVE text into an UNSIGNED type is 0, where a signed one wraps it ('-5'
 * into UINT, BYTE, ULINT is 0, into INT -5; `wstring_parse_widths`, gate 8c) — `unsigned` says which the target is.
 */
export function parseInteger(text: string, unsigned: boolean): bigint {
  const { value, negative } = scanInteger(text)
  return unsigned && negative ? 0n : value
}

/**
 * WSTRING → integer (transpile-restructure 8.2, `wstring_parse_grammar`): what `parseInteger` reads, answered only when it
 * read the WHOLE text — a character it stops at makes the parse 0 ('12abc', '1 0', '5 ', '16#1FZ', '-16#F' are 0; ' 5',
 * '5_', '-_5', '16#FF_FF' read through), where the STRING parse answers the digits before it. A text with no digits is 0
 * either way. The value is the STRING parse's, so it reaches every integer type as that one does — past 32 and 64 bits,
 * and a negative text into an unsigned type is 0 (`wstring_parse_widths`, gate 8c: 108 cells, the wide and the narrow parse
 * alike).
 */
export function parseIntegerWide(text: string, unsigned: boolean): bigint {
  const { value, end, negative } = scanInteger(text)
  return end === text.length && !(unsigned && negative) ? value : 0n
}

/** The one integer scan both parses read: its value, where it stopped (the text's length when it read all of it), and
 *  whether a minus sign stood before the digits. */
function scanInteger(text: string): { value: bigint; end: number; negative: boolean } {
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
  return { value: sign === "-" ? -value : value, end: i, negative: sign === "-" }
}
