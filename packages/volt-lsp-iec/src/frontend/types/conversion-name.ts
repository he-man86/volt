/**
 * A CONVERSION OPERATOR'S NAME — `INT_TO_REAL`, `TO_STRING`, `ANY_TO_DWORD` — read as its source and target types.
 */
import { ANY_FAMILIES, ELEMENTARY_TYPES, type ElementaryType } from "./elementary.js"

/**
 * The ANY families as a CONVERSION FUNCTION spells them — `ANY_TO_DWORD`, exactly as the type group is spelled.
 *
 * The UNDERSCORELESS spelling (`ANYNUM_TO_WORD`) was accepted here for a while, because the corpus writes it 80
 * times. It was measured on SP21 and CODESYS has no such function (`cs_anynum_to_conversions`):
 *
 *   Identifier 'ANYNUM_TO_WORD' not defined
 *
 * All 80 corpus uses sit inside materialized `Library Manager/` files — CAA CiA405's own enum initializers, not
 * user code — so they were never evidence that the compiler accepts it in a POU. A count is not a measurement.
 */
const ANY_CONVERSION_PREFIXES: ReadonlySet<string> = new Set(ANY_FAMILIES.keys())

/**
 * A conversion operator's name — `INT_TO_REAL`, `TO_STRING` — as its source and target types, or undefined when the name is
 * none. Both sides must be an elementary type spelled as this table spells it: CODESYS defines `TOD_TO_UDINT` but not
 * `TIME_OF_DAY_TO_UDINT` ("Identifier 'TIME_OF_DAY_TO_UDINT' not defined", conformance `cc_conv_spelled_*`), and a project
 * function called `GO_TO_START` is no conversion. The ONE parser — lowering, inference, the checks, identifier resolution
 * and the reference catalog all read a conversion name through it; there were six, and they disagreed.
 */
export function parseConversionName(name: string): { from?: ElementaryType; to: ElementaryType } | undefined {
  // case-insensitive, as every ST name is — `int_to_real` is `INT_TO_REAL` (the test caught a missing `i` here)
  const m = /^(?:([A-Za-z]+(?:_[A-Za-z]+)?)_)?TO_([A-Za-z]+)$/i.exec(name)
  if (m === null) return undefined
  const to = ELEMENTARY_TYPES.get(m[2]!.toUpperCase())
  if (to === undefined) return undefined
  if (m[1] === undefined) return { to }
  // `ANY_TO_INT` names no concrete source — the ANY families stand for "whatever the argument is", exactly as the bare
  // `TO_INT` does, and the corpus writes them 72 times. Unknown here, every one of them was an undefined identifier.
  if (ANY_CONVERSION_PREFIXES.has(m[1].toUpperCase())) return { to }
  const from = ELEMENTARY_TYPES.get(m[1].toUpperCase())
  return from === undefined ? undefined : { from, to }
}
