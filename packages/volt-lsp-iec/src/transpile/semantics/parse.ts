/** STRING → NUMBER: the prefix a STRING_TO_* conversion reads (conformance `string_conversions*`, `string_to_real_parse`). */

/** A decimal prefix after spaces/tabs: '.5', '5.', '1.5E' (1.5), '2e2', '1,5' (1); none at all is 0 (`string_to_real_parse`). */
export function parseReal(text: string): number {
  const m = /^[ \t]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text)
  return m === null ? 0 : Number(m[1])
}

/** Leading spaces and tabs skipped, an optional sign and the digits that follow, stopping at the first other character —
 *  '12abc' is 12, '$T7' is 7, '+5' is 5, '- 5' and '' are 0 (conformance `string_conversions*`). */
export function parseInteger(text: string): bigint {
  const m = /^[ \t]*([+-]?)(\d*)/.exec(text)!
  const magnitude = BigInt(m[2] || "0")
  return m[1] === "-" ? -magnitude : magnitude
}
