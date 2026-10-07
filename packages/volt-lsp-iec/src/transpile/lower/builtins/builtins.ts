/**
 * The built-in functions — the operators the COMPILER provides, never a library's elements: the value functions, type
 * conversions, SIZEOF and the other system operators, and the clock (`TIME()`/`LTIME()`). A library element (`LEN`, `TON`)
 * is an ordinary call of the body the library repo (`libraries/`) supplies.
 */

import type { Lowering } from "../lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr } from "../../ir/index.js"
import { lowerSystemCall } from "./system.js"
import { lowerClock } from "./clock.js"
import { elementaryRef, parseConversionName, PLATFORM_ALIASES, UNKNOWN } from "../../../frontend/types/index.js"
import { lowerConversion } from "./conversions.js"
import { BUILTIN_ARITY } from "./arity.js"
import { lowerValueFunction } from "./value-functions.js"
import { lowerInvoke } from "../calls/invoke.js"

/**
 * The value functions MAX/MIN/LIMIT/SEL → one `builtin` node. Every rule is MEASURED on CODESYS 3.5.21.40
 * (conformance `max_*`, `limit_*`, `sel_basic`), not recalled:
 *   - MAX/MIN are extensible — `MAX(1, 5, 3)` is 5, `MIN(8, 4, 6, 9)` is 4;
 *   - the arguments MEET like a binary operator's operands — `MAX(i3, r25)` is REAL 3, and
 *     `MAX(us200, sMinus1)` (USINT 200, SINT -1) is 200, a comparison of VALUES after promotion;
 *   - `LIMIT(MN, IN, MX)` is exactly `MIN(MAX(IN, MN), MX)` — with MN > MX it returns MX for every IN;
 *   - `SEL(G, IN0, IN1)` is IN0 on FALSE, IN1 on TRUE.
 * Any other call — a project function, a library, a conversion — is still `expr-call`, and counted.
 */
export function lowerBuiltin(lw: Lowering, e: Extract<Expr, { kind: "call" }>): IrExpr | undefined {
  const name = e.callee.kind === "ident_expr" ? e.callee.name.toUpperCase() : undefined
  // `X_TO_Y` / `TO_Y` — `types/parseConversionName`, the one parser: both names elementary and spelled as CODESYS
  // spells them. A project function called `GO_TO_START` is an ordinary call, and `TIME_OF_DAY_TO_UDINT` is no
  // conversion at all (it is not defined — this used to read it as one).
  const system = name === undefined ? null : lowerSystemCall(lw, e, name)
  if (system !== null) return system
  const clock = name === undefined ? null : lowerClock(lw, e, name)
  if (clock !== null) return clock
  // `__XINT_TO_DINT` and its family: the pointer-width types are the target's own width, so the conversion NAME carries
  // one too (the corpus writes `__XWORD` 963 times). `parseConversionName` reads elementary names only, so the prefix is
  // resolved to what the platform makes it before the split (conformance `ct_pointer_width_types`). The names come from
  // `PLATFORM_ALIASES` — the ONE home — rather than a third spelling of the same three rows, which is what this read.
  const platform = name === undefined ? undefined : /^(__U?X(?:INT|WORD))_TO_/i.exec(name)?.[1]
  const conv = name === undefined ? undefined : parseConversionName(platform === undefined ? name : name.replace(platform, PLATFORM_ALIASES.get(platform.toUpperCase())!), undefined)
  if (conv !== undefined) return lowerConversion(lw, e, conv.from && elementaryRef(conv.from.name), elementaryRef(conv.to.name))
  const arity = name === undefined ? undefined : BUILTIN_ARITY[name]
  if (name === undefined || arity === undefined) {
    // a METHOD of an instance, or a project FUNCTION — a routine with a result
    const value = lowerInvoke(lw, e)
    if (value === undefined) return undefined
    return value.type === UNKNOWN ? lw.bail("call-no-result", "a call without a result used as a value", e.span) : value
  }
  if (e.args.some((a) => a.param !== undefined || a.output || a.value === undefined))
    return lw.bail("call-named-args", `${name} with named or output arguments`, e.span)
  if (e.args.length < arity.min || (arity.max !== undefined && e.args.length > arity.max))
    return lw.bail("call-arity", `${name} with ${e.args.length} arguments`, e.span)
  return lowerValueFunction(lw, e, name, e.args.map((a) => a.value!))
}
