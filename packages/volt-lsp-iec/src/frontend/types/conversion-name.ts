/**
 * A CONVERSION OPERATOR'S NAME — `INT_TO_REAL`, `TO_STRING`, `ANY_TO_DWORD` — read as its source and target types.
 */
import type { Target } from "../syntax/index.js"
import { ANY_FAMILIES, ELEMENTARY_TYPES, type ElementaryType } from "./elementary.js"
import { canonicalElem, isPlatformInteger } from "./platform.js"

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
export function parseConversionName(name: string, target: Target | undefined): { from?: ElementaryType; to: ElementaryType } | undefined {
  const parts = conversionParts(name)
  if (parts === undefined) return undefined
  const to = sideType(parts.to, target)
  if (to === undefined) return undefined
  if (parts.from === undefined) return { to }
  const from = sideType(parts.from, target)
  return from === undefined ? undefined : { from, to }
}

/**
 * Is `name` a conversion operator — on EVERY target? The platform-alias names (`__XINT_TO_DINT`, `DINT_TO___UXINT`) are
 * conversions whatever the pointer width; only their facts are the target's (`parseConversionName`). Rule TY11, recorded
 * on both vendors 2026-10-03 (`ty_xint_to_dint`, `ty_dint_to_uxint`).
 */
export function isConversionName(name: string): boolean {
  return conversionParts(name) !== undefined
}

/** A conversion name's two sides as written (upper-cased) — `from` undefined for `TO_X` and an ANY family — whatever the
 *  target: what a name's spelling decides (is it a TwinCAT operator? what does a hover say?), not its facts. */
export function conversionSides(name: string): { from?: string; to: string } | undefined {
  return conversionParts(name)
}

/** A side of a conversion name: an elementary type as the table spells it, or a platform integer. */
const SIDE = String.raw`__U?X(?:INT|WORD)|[A-Za-z]+`
// case-insensitive, as every ST name is — `int_to_real` is `INT_TO_REAL` (the test caught a missing `i` here)
const CONVERSION = new RegExp(`^(?:(${SIDE}|[A-Za-z]+_[A-Za-z]+)_)?TO_(${SIDE})$`, "i")

/** The two sides of a conversion name, each a type this table or the platform names — `from` undefined for `TO_X` and
 *  for an ANY family (`ANY_TO_INT` names no concrete source, exactly as the bare `TO_INT` does — the corpus writes them
 *  72 times). */
function conversionParts(name: string): { from?: string; to: string } | undefined {
  const m = CONVERSION.exec(name)
  if (m === null) return undefined
  const to = m[2]!.toUpperCase()
  if (!isSide(to)) return undefined
  if (m[1] === undefined) return { to }
  const from = m[1].toUpperCase()
  if (ANY_CONVERSION_PREFIXES.has(from)) return { to }
  return isSide(from) ? { from, to } : undefined
}

const isSide = (upper: string): boolean => ELEMENTARY_TYPES.has(upper) || isPlatformInteger(upper)

/** A side's facts on `target` — undefined for a platform integer on an unknown target. */
const sideType = (upper: string, target: Target | undefined): ElementaryType | undefined => ELEMENTARY_TYPES.get(canonicalElem(upper, target))
