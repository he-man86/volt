/**
 * The built-in functions: the value functions, the Standard library's string functions, and type conversions.
 */
import type { Expr, Span } from "../../syntax/index.js"
import { libraryOf, lookup } from "../../symbols/index.js"
import {
  commonType,
  elementaryRef,
  PLATFORM_ALIASES,
  elemOf,
  exptResultType,
  isTemporal,
  parseConversionName,
  promoteForRuntime,
  type Type,
  UNKNOWN,
} from "../../types/index.js"
import type { IrBuiltinName, IrExpr } from "../ir/index.js"
import type { Lowering } from "./lowering.js"

import { isBit } from "../ir/index.js"
import { convert } from "./convert.js"
import { withStringCapacity } from "./storage.js"
import { boundOf, lowerPlace } from "./places.js"
import { foldConstant } from "./constants.js"
import { sizeOf } from "./bytes.js"
import { lowerExpr } from "./expressions.js"
import { lowerInvoke } from "./calls.js"

/** The value functions `builtin` lowers, and how many operands each takes. SEL's count includes its selector. */
export const BUILTIN_ARITY: Readonly<Record<string, { min: number; max?: number }>> = {
  MAX: { min: 1 },
  MIN: { min: 1 },
  LIMIT: { min: 3, max: 3 },
  SEL: { min: 3, max: 3 },
  TRUNC: { min: 1, max: 1 },
  TRUNC_INT: { min: 1, max: 1 },
  ABS: { min: 1, max: 1 },
  EXPT: { min: 2, max: 2 },
  SHL: { min: 2, max: 2 },
  SHR: { min: 2, max: 2 },
  ROL: { min: 2, max: 2 },
  ROR: { min: 2, max: 2 },
  MUX: { min: 2 },
  ...Object.fromEntries(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"].map((n) => [n, { min: 1, max: 1 }])),
}

/** The Standard library's string functions — lowered only when the callee resolves into that library (`standardString`). */
export const STANDARD_STRING_FUNCTIONS: ReadonlySet<string> = new Set(["LEN", "LEFT", "RIGHT", "MID", "CONCAT", "INSERT", "DELETE", "REPLACE", "FIND"])

/** The one-argument math functions — same arity, same typing rule (see `builtin`). */
export const UNARY_MATH: ReadonlySet<string> = new Set(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"])

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
  if (name === "SIZEOF" || name === "XSIZEOF") return sizeOf(lw, e)
  // `MOVE(v)` is v — the IEC assignment operator, which the corpus writes around a variable, a constant and a variable
  // AT a direct address (conformance `co_move_operator`).
  if (name === "MOVE") {
    const only = e.args[0]
    if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
      return lw.bail("call-arity", "MOVE takes exactly one positional argument", e.span)
    return lowerExpr(lw, only.value)
  }
  // `__POUNAME()` — the POU's name, or `POU.Member` inside a METHOD or ACTION, as a sizeless STRING (conformance
  // `cp_pouname_operator`: 'FB_CP_named', 'FB_CP_named.Inner', 'FB_CP_named.Marked'; the corpus writes it 304 times).
  if (name === "__POUNAME") {
    if (e.args.length !== 0) return lw.bail("call-arity", "__POUNAME takes no argument", e.span)
    if (lw.displayName === "") return lw.bail("expr-call", "__POUNAME where the POU has no name", e.span)
    return { kind: "const", value: lw.displayName, type: withStringCapacity(elementaryRef("STRING")), span: e.span }
  }
  // lowered as an assignment's whole value, or as an IF condition's leading operand — taken just before the IF, read here
  // (`queryCondition`); anywhere else — a right operand a short-circuit may skip, inside another expression — the timing
  // of its store is not modelled
  if (name === "__QUERYINTERFACE")
    return lw.hoistedQueries.get(e) ?? lw.bail("interface-query", "__QUERYINTERFACE other than an assignment's whole value or an IF condition's leading operand", e.span)
  // LOWER_BOUND(array, dimension) / UPPER_BOUND: a DINT (conformance `callshape_array_star_*`, `callshape_bounds_of_sized_array`)
  if (name === "LOWER_BOUND" || name === "UPPER_BOUND") {
    const [array, dimension] = e.args
    if (e.args.length !== 2 || e.args.some((a) => a.param !== undefined || a.output || a.value === undefined))
      return lw.bail("call-arity", `${name} takes an array and a dimension`, e.span)
    const place = lowerPlace(lw, array!.value!)
    if (place === undefined) return undefined
    const dim = foldConstant(lw, dimension!.value!)
    const bound = typeof dim === "bigint" ? boundOf(lw, place, name === "LOWER_BOUND" ? "lower" : "upper", Number(dim)) : undefined
    return bound ?? lw.bail("array-bound", `${name} of an array whose bounds are not known here`, e.span)
  }
  if (name === "__ISVALIDREF") {
    // a bound reference is valid (conformance `op_sys_isvalidref`: TRUE) — its value is not 0
    const arg = e.args[0]?.value
    if (e.args.length !== 1 || arg === undefined) return lw.bail("call-arity", "__ISVALIDREF takes one argument", e.span)
    const place = lowerPlace(lw, arg)
    if (place === undefined) return undefined
    if (place.type.kind !== "reference" && place.type.kind !== "pointer") return lw.bail("call-arity", "__ISVALIDREF of something that is not a reference", e.span)
    const loaded: IrExpr = { kind: "load", place, type: place.type, span: arg.span }
    return { kind: "binary", op: "ne", left: loaded, right: { kind: "const", value: 0n, type: place.type, span: e.span }, type: elementaryRef("BOOL"), span: e.span }
  }
  // `__XINT_TO_DINT` and its family: the pointer-width types are the target's own width, so the conversion NAME carries
  // one too (the corpus writes `__XWORD` 963 times). `parseConversionName` reads elementary names only, so the prefix is
  // resolved to what the platform makes it before the split (conformance `ct_pointer_width_types`). The names come from
  // `PLATFORM_ALIASES` — the ONE home — rather than a third spelling of the same three rows, which is what this read.
  const platform = name === undefined ? undefined : /^(__U?X(?:INT|WORD))_TO_/i.exec(name)?.[1]
  const conv = name === undefined ? undefined : parseConversionName(platform === undefined ? name : name.replace(platform, PLATFORM_ALIASES.get(platform.toUpperCase())!))
  if (conv !== undefined) return lowerConversion(lw, e, conv.from && elementaryRef(conv.from.name), elementaryRef(conv.to.name))
  if (name !== undefined && STANDARD_STRING_FUNCTIONS.has(name)) return lowerStandardString(lw, e, name)
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

  const values = e.args.map((a) => a.value!)
  if (name === "TRUNC" || name === "TRUNC_INT") {
    const arg = lowerExpr(lw, values[0]!)
    if (arg === undefined) return undefined
    // Toward zero — TRUNC(-2.7) is -2 — into DINT (TRUNC) or INT (TRUNC_INT). conformance `trunc_functions`.
    const type = elementaryRef(name === "TRUNC" ? "DINT" : "INT")
    return { kind: "builtin", name: "trunc", args: [arg], type, span: e.span }
  }
  if (name === "ABS") {
    const arg = lowerExpr(lw, values[0]!)
    if (arg === undefined) return undefined
    // Promotes like unary minus: ABS(SINT -128) is 128, ABS(INT -32768) into a DINT is 32768 and into an INT wraps
    // back to -32768; ABS of a USINT is the value itself (conformance `abs_values`, `abs_unsigned`).
    const type = promoteForRuntime(arg.type)
    return { kind: "builtin", name: "abs", args: [convert(arg, type)], type, span: e.span }
  }
  if (name === "SHL" || name === "SHR" || name === "ROL" || name === "ROR") {
    const value = lowerExpr(lw, values[0]!)
    const count = value === undefined ? undefined : lowerExpr(lw, values[1]!)
    if (value === undefined || count === undefined) return undefined
    // SHL/SHR shift the PROMOTED value — SHL(BYTE 1, 9) into a WORD is 512 — while ROL/ROR rotate in the value's
    // own width: ROL(BYTE 129, 1) is 3 (conformance `shift_basic`, `rotate_basic`).
    const shift = name === "SHL" || name === "SHR"
    const type = shift ? promoteForRuntime(value.type) : value.type
    const op = name.toLowerCase() as IrBuiltinName
    return { kind: "builtin", name: op, args: [convert(value, type), count], type, span: e.span }
  }
  if (name === "MUX") {
    const index = lowerExpr(lw, values[0]!)
    if (index === undefined) return undefined
    const inputs: IrExpr[] = []
    for (const v of values.slice(1)) {
      const lowered = lowerExpr(lw, v)
      if (lowered === undefined) return undefined
      inputs.push(lowered)
    }
    // The inputs meet like MAX's — MUX(0, INT 10, REAL 2.5) is REAL 10 (conformance `mux_mixed_types`).
    const type = meetOperands(lw, inputs, e.span)
    if (type === undefined) return undefined
    return { kind: "builtin", name: "mux", args: [index, ...inputs.map((i) => convert(i, type))], type, span: e.span }
  }
  if (name === "EXPT") {
    const base = lowerExpr(lw, values[0]!)
    const exponent = base === undefined ? undefined : lowerExpr(lw, values[1]!)
    if (base === undefined || exponent === undefined) return undefined
    // REAL only when BOTH arguments are REAL — EXPT(REAL 2.0, REAL 0.5) is float32's √2 — and LREAL otherwise:
    // EXPT(REAL 3.0, INT 20) is 3486784401 (float32 would give 3486784512), EXPT(INT 2, REAL 0.5) and
    // EXPT(LREAL, REAL) are float64, and EXPT(INT, INT) is LREAL-typed (into an INT it does not compile).
    // conformance `expt_types`, `expt_mixed_width`.
    const type = exptResultType(base.type, exponent.type)
    return { kind: "builtin", name: "expt", args: [convert(base, type), convert(exponent, type)], type, span: e.span }
  }
  if (UNARY_MATH.has(name)) {
    const arg = lowerExpr(lw, values[0]!)
    if (arg === undefined) return undefined
    // A REAL argument computes in REAL — SQRT(REAL 2.0) is float32's 1.4142135381698608 — an LREAL in LREAL, and an
    // INTEGER in LREAL: SQRT(INT 2) is 1.4142135623730951 (conformance `sqrt_precision`, `exp_log_precision`,
    // `trig_precision`).
    const type = elemOf(arg.type)?.family === "real" ? arg.type : elementaryRef("LREAL")
    const math = name.toLowerCase() as IrBuiltinName
    return { kind: "builtin", name: math, args: [convert(arg, type)], type, span: e.span }
  }
  const selector = name === "SEL" ? lowerExpr(lw, values[0]!, elementaryRef("BOOL")) : undefined
  if (name === "SEL" && selector === undefined) return undefined
  const operands: IrExpr[] = []
  for (const v of name === "SEL" ? values.slice(1) : values) {
    const lowered = lowerExpr(lw, v)
    if (lowered === undefined) return undefined
    operands.push(lowered)
  }
  const type = meetOperands(lw, operands, e.span)
  if (type === undefined) return undefined
  // MAX / MIN / LIMIT OVER A STRING WAS REFUSED until the order was measured, and now it is: CODESYS compares two
  // STRINGs BYTE BY BYTE, UNSIGNED, with a prefix losing to what it is a prefix of. Six pairs settle it
  // (`strings/ordering.ts`, 2026-09-19), each asked of MAX, MIN and the operators at once:
  //
  //   'ab' < 'abc'      a prefix loses            '' < 'a'        the same at its limit
  //   '$FF' > 'a'       so the bytes are UNSIGNED  '$FE' < '$FF'  with no ASCII byte to hide behind
  //   'b' > 'abc'       the first byte decides, not the length
  //   'abc' = 'abc'     and MAX of two equal strings answers with the value
  //
  // MAX, MIN and `<` all agree, which is not a given — `string_compare_operators` is committed beside
  // `string_max` because an order for the function and an order for the operator need not be the same. `SEL` needs
  // no order at all: it picks an operand rather than comparing them.
  const args = operands.map((o) => convert(o, type))
  const lower = name.toLowerCase() as IrBuiltinName
  return { kind: "builtin", name: lower, args: selector === undefined ? args : [selector, ...args], type, span: e.span }
}

/**
 * A string function of the referenced Standard library → one `builtin` node — a library-gated intrinsic
 * (plc-library-runtime, tier 1). It binds ONLY when the name resolves to that library's own declaration under
 * `Library Manager/Standard/`: a project that references no Standard has no LEN, and a project FUNCTION called LEN is
 * not this one. The signature is the library's, never recalled — every parameter and result is STRING(255) there,
 * so an argument converts to it (and a longer one is cut on the way in) exactly as the compiler passes it.
 */
export function lowerStandardString(lw: Lowering, e: Extract<Expr, { kind: "call" }>, name: string): IrExpr | undefined {
  const sym = lookup(lw.scope, name)?.symbol
  if (sym === undefined || sym.ast.kind !== "function" || libraryOf(sym) !== "Standard")
    return lw.bail("expr-call", `${name} does not resolve to the Standard library`, e.span)
  const params = sym.ast.varSections
    .filter((s) => s.sectionKind === "VAR_INPUT")
    .flatMap((s) => s.decls.flatMap((d) => d.names.map(() => withStringCapacity(lw.resolve(d.type, lw.project)))))
  const result = sym.ast.returnType === undefined ? UNKNOWN : withStringCapacity(lw.resolve(sym.ast.returnType, lw.project))
  if (e.args.some((a) => a.param !== undefined || a.output || a.value === undefined))
    return lw.bail("call-named-args", `${name} with named or output arguments`, e.span)
  if (e.args.length !== params.length || result === UNKNOWN || params.includes(UNKNOWN))
    return lw.bail("call-arity", `${name} with ${e.args.length} arguments`, e.span)
  const args: IrExpr[] = []
  for (const [i, a] of e.args.entries()) {
    const arg = lowerExpr(lw, a.value!, params[i])
    if (arg === undefined) return undefined
    args.push(convert(arg, params[i]!))
  }
  return { kind: "builtin", name: name.toLowerCase() as IrBuiltinName, args, type: result, span: e.span }
}

/**
 * `X_TO_Y(v)` / `TO_Y(v)` → an explicit `convert` node. The rules themselves live in that IR node (design §11), so
 * implicit and explicit conversions cannot drift apart. `X_TO_Y` first brings `v` to X the way the compiler
 * would; `TO_Y` converts from whatever `v` is. The explicit step is always a NODE, never a retyped constant:
 * `DINT_TO_SINT(300)` is 44, and a constant stamped SINT would print as Rust's out-of-range `300i8`.
 */
export function lowerConversion(lw: Lowering, e: Extract<Expr, { kind: "call" }>, from: Type | undefined, to: Type): IrExpr | undefined {
  const scalar = (t: Type): boolean => ["bool", "int", "bitstring", "real", "time", "date"].includes(elemOf(t)?.family ?? "")
  // `BOOL_TO_BIT` and `BIT_TO_BOOL` change nothing: a BIT holds a BOOLEAN and is one bit only in the LAYOUT (`isBit`,
  // design §9). Typed as the 1-bit bit string it is declared as, each printed a comparison against a Rust `bool`
  // (conformance `ct_bit_fields`).
  const boolLike = (t: Type | undefined): boolean => t !== undefined && (isBit(t) || elemOf(t)?.family === "bool")
  if (boolLike(to) && (from === undefined || boolLike(from))) {
    const only = e.args[0]
    if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
      return lw.bail("call-arity", "a conversion takes exactly one positional argument", e.span)
    const arg = lowerExpr(lw, only.value, elementaryRef("BOOL"))
    if (arg === undefined) return undefined
    return boolLike(arg.type) ? arg : convert(arg, elementaryRef("BOOL"))
  }
  // STRING conversions (design §18): to STRING from an integer, a bit string, BOOL or TIME; from STRING to an integer,
  // REAL or LREAL. REAL_TO_STRING has no single digit rule and stays refused; parsing into a bit string is unmeasured.
  // The result is a sizeless STRING (80) — no text these produce is longer.
  const isInt = (t: Type | undefined, orBits = false): boolean =>
    t !== undefined && (elemOf(t)?.family === "int" || (orBits && elemOf(t)?.family === "bitstring"))
  const isString = (t: Type | undefined): boolean => t !== undefined && elemOf(t)?.family === "string"
  // DATE, DT and TOD print as their literal, zero-padded, a TOD's milliseconds only when non-zero (`temporal_conversions`)
  // LTIME joins the list: its text is a TIME's with the `LTIME#` prefix and three units below a millisecond, and
  // every component boundary is measured (`conversions/to-string-format.ts`). REAL and LREAL deliberately do NOT —
  // see the note where the refusal is raised.
  // the temporal half is `types/isTemporal` — the Rust emitter dispatches on the SAME predicate, so a type added
  // to the table reaches both sites or neither. BOOL and LREAL are named because each has its own renderer.
  const hasText = (t: Type | undefined): boolean => {
    const name = t === undefined ? undefined : elemOf(t)?.name
    return isInt(t, true) || (name !== undefined && (name === "BOOL" || name === "LREAL" || isTemporal(name)))
  }
  const parses = (t: Type): boolean => isInt(t) || elemOf(t)?.family === "real"
  // STRING <-> WSTRING: one code unit per code unit, truncated at the target's capacity (conformance
  // `xo3_string_wide_conversions`: a WSTRING(10) into a STRING(4) is 'abcd', a STRING(6) into a WSTRING(2) is "he").
  // Both sides are ASCII by construction — a non-ASCII literal is already refused — so nothing is re-encoded.
  const wideConversion = isString(to) && isString(from) && elemOf(to)?.name !== elemOf(from ?? UNKNOWN)?.name
  // `TO_STRING(v)` names no source, so `from` is undefined and the text rules below had nothing to test — the catalog
  // only ever wrote `X_TO_STRING`, while the corpus writes the bare form 132 times. The argument's own type is the
  // source (conformance `ct_bare_to_conversions`).
  if (from === undefined && isString(to)) {
    const only = e.args[0]
    if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
      return lw.bail("call-arity", "a conversion takes exactly one positional argument", e.span)
    const arg = lowerExpr(lw, only.value)
    if (arg === undefined) return undefined
    return lowerConversion(lw, e, arg.type, to)
  }
  if (wideConversion || (isString(to) && elemOf(to)?.name === "STRING" && hasText(from)) || (isString(from) && elemOf(from ?? UNKNOWN)?.name === "STRING" && parses(to))) {
    const only = e.args[0]
    if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
      return lw.bail("call-arity", "a conversion takes exactly one positional argument", e.span)
    const arg = lowerExpr(lw, only.value, from)
    if (arg === undefined) return undefined
    const type = withStringCapacity(to)
    return { kind: "convert", value: convert(arg, withStringCapacity(from!)), type, span: e.span }
  }
  // LREAL_TO_STRING IS IMPLEMENTED AND REAL_TO_STRING IS NOT, and the sweep that separated them is the reason.
  // Both were refused on eleven cells each; 68 more (`conversions/to-string-format.ts`, 2026-09-19) determine one
  // formatter completely and leave the other with two cells no rule explains.
  //
  //   LREAL  fifteen significant digits, trailing zeros stripped, FIXED while the decimal exponent is 0..13 and
  //          exponential otherwise, lowercase `e`, no sign and no padding. 26 of 26 cells follow it, including
  //          the boundaries either side (1E13 is '10000000000000.0', 1E14 is '1.0e14', 0.1 is '1.0e-1').
  //
  //   REAL   seven significant digits, UPPERCASE E, exponent padded to two digits, no '.0' on an exponential
  //          mantissa, fixed from 1E-4 up to just below 1E8 — and then two cells that print EIGHT digits
  //          (`1.2345679E08`, `1.2345679E-08`) beside four that print seven at the same magnitudes, and four
  //          fractions whose seventh digit is not what rounding the value to seven gives (1/3 is '0.3333334',
  //          1/7 is '0.1428572', while 1/9 and 1/11 print eight digits and stop). Those are not a rounding mode;
  //          they are a formatter doing something the outputs do not reveal.
  //
  // CANDIDATES MEASURED AGAINST THE 38 RECORDED REAL CELLS, 2026-09-24 — so the next reader does not re-run them:
  //
  //     33/38  seven significant digits, trailing zeros stripped
  //     30/38  shortest representation that round-trips to the same f32
  //     30/38  seven digits, then eight when seven does not round-trip
  //     28/38  seven digits computed through an f32 scale (x * 10^(6-e), rounded)
  //     22/38  eight significant digits · 12/38 nine
  //
  // Seven digits is the closest and the five it misses are the five the paragraph above names. Round-tripping is
  // NOT the discriminator: `3.141593` and `1234.568` keep seven digits although neither round-trips, while
  // `1.2345679E08` takes eight. Nor is double rounding — it explains 1/7 (0.14285714|924 → 0.14285715 → 0.1428572)
  // and not 1/3 (0.33333334|326 → 0.33333334 → 0.3333333, where CODESYS says 0.3333334).
  //
  // So the LREAL side is lowered and the REAL side stays refused. The prelude mirrors the interpreter line for
  // line, so a guess here would be a silent divergence between the two backends, not a rough edge in one — and a
  // rule that is right 33 times in 38 is a rule that is WRONG five times, in a function whose whole output is text.
  if (isString(to) && elemOf(to)?.name === "STRING" && elemOf(from ?? UNKNOWN)?.name === "REAL")
    return lw.bail("conversion-type", "REAL_TO_STRING prints seven digits except where it prints eight — 70 cells and no rule", e.span)
  if (!scalar(to) || (from !== undefined && !scalar(from)))
    return lw.bail("conversion-type", "this STRING conversion is not measured yet", e.span)
  const only = e.args[0]
  if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
    return lw.bail("call-arity", "a conversion takes exactly one positional argument", e.span)
  const arg = lowerExpr(lw, only.value)
  if (arg === undefined) return undefined
  const source = from === undefined ? arg : convert(arg, from)
  const fromName = elemOf(source.type)?.name ?? ""
  const toName = elemOf(to)?.name ?? ""
  // A duration or date converts to and from INTEGERS, in its own unit — TIME_TO_DINT(T#1S500MS) is 1500,
  // DATE_TO_UDINT(D#1970-01-02) is 86400 seconds, TOD_TO_UDINT(TOD#00:00:01) is 1000 ms (conformance `time_conversions`,
  // `date_representation`). Measured beyond that (`temporal_conversions`): DT→DATE keeps the day and DT→TOD the time of
  // day; DATE→DT, TOD→TIME and TIME→TOD keep the count, as the units agree; TIME and DATE → REAL/LREAL are their count;
  // REAL/LREAL→TIME rounds half away from zero (2.5 is 3ms). Any other pair — BOOL, DT/TOD → REAL, DATE→TOD — is refused.
  const real = (name: string) => name === "REAL" || name === "LREAL"
  const pair = `${fromName}>${toName}`
  const span = e.span
  const udint = elementaryRef("UDINT")
  const n = (value: bigint): IrExpr => ({ kind: "const", value, type: udint, span })
  // THE WHOLE DATE FAMILY CONVERTS THROUGH AN ABSOLUTE INSTANT. `DT>DATE` and `DT>TOD` were special-cased here and
  // the other 28 pairs were refused as "not measured yet"; `conversions/cross-family.ts` measured all thirty on
  // 2026-09-19 and they are one rule:
  //
  //   the source's count is an instant in ITS tick unit -> re-express in the DESTINATION's tick
  //   -> keep the part the destination HAS: whole days for DATE/LDATE, the part within the day for TOD/LTOD,
  //      the entire instant for DT/LDT
  //
  //   DATE 2026-05-09 -> TOD   is 0:0:0          midnight has no time of day
  //   TOD  07:05:03.250 -> DT  is 1970-1-1-7:5:3 the epoch day, and DT counts SECONDS so the .250 is gone
  //   TOD  07:05:03.250 -> LDT is …7:5:3.250000000   LDT counts nanoseconds, so it survives
  //
  // The ticks are the table's own (`elementary.ts` `tickNs`), and because every pair is a power-of-ten ratio the
  // instant never has to be materialized in nanoseconds — which matters, since seconds-since-epoch times 1e9
  // overflows 32 bits.
  const fromElem = elemOf(source.type)
  const toElem = elemOf(to)
  // A DURATION CONVERTS THE SAME WAY, minus the day part — a TIME has no calendar, so there is nothing to mask.
  // `TIME_TO_LTIME(T#1S500MS)` is LTIME#1s500ms and `LTIME_TO_TIME` the reverse: milliseconds and nanoseconds are
  // the same instant in different units, not a reinterpretation of the same number.
  const tickFamily = fromElem?.family === "date" || fromElem?.family === "time"
  if (fromElem !== undefined && toElem !== undefined && tickFamily && fromElem.family === toElem.family && fromName !== toName) {
    const fromTick = fromElem.tickNs!
    const toTick = toElem.tickNs!
    // ALWAYS 64 BITS, even for two 32-bit types. `DT_TO_TOD` re-expresses seconds-since-epoch as milliseconds
    // before taking the part within the day, and that intermediate is 1.78e12 — four hundred times what a UDINT
    // holds. The old special case dodged it by masking in SECONDS first, which only works because those two ticks
    // are a factor of 1000 apart; at 64 bits the rule needs no such ordering.
    const work = elementaryRef("ULINT")
    const w = (value: bigint): IrExpr => ({ kind: "const", value, type: work, span })
    let count: IrExpr = convert(source, work)
    if (fromTick > toTick) count = { kind: "binary", op: "mul", left: count, right: w(fromTick / toTick), type: work, span }
    else if (toTick > fromTick) count = { kind: "binary", op: "div", left: count, right: w(toTick / fromTick), type: work, span }
    const dayTicks = 86_400_000_000_000n / toTick
    const part = DATE_PART[toName] ?? "all" // a duration has no calendar part to keep
    if (part !== "all") {
      const inDay: IrExpr = { kind: "binary", op: "mod", left: count, right: w(dayTicks), type: work, span }
      count = part === "inDay" ? inDay : { kind: "binary", op: "sub", left: count, right: inDay, type: work, span }
    }
    return { kind: "convert", value: count, type: to, span }
  }
  const temporal = (t: Type): boolean => ["time", "date"].includes(elemOf(t)?.family ?? "")
  void udint
  const fromTemporal = temporal(source.type)
  const toTemporal = temporal(to)
  const integral = (name: string): boolean => !real(name) && name !== "BOOL"
  const measured =
    (fromTemporal !== toTemporal && integral(fromName) && integral(toName)) ||
    ["DATE>DT", "TOD>TIME", "TIME>TOD"].includes(pair) ||
    ((fromName === "TIME" || fromName === "DATE") && real(toName)) ||
    (real(fromName) && toName === "TIME")
  if ((fromTemporal || toTemporal) && fromName !== toName && !measured)
    return lw.bail("conversion-type", `${fromName}_TO_${toName} is not measured yet`, e.span)
  return fromName === toName ? source : { kind: "convert", value: source, type: to, span: e.span }
}

/** Which part of an instant each date type CARRIES — measured, see the conversion rule above. */
const DATE_PART: Readonly<Record<string, "day" | "inDay" | "all">> = {
  DATE: "day",
  LDATE: "day",
  TOD: "inDay",
  TIME_OF_DAY: "inDay",
  LTOD: "inDay",
  LTIME_OF_DAY: "inDay",
  DT: "all",
  DATE_AND_TIME: "all",
  LDT: "all",
  LDATE_AND_TIME: "all",
}

/** The one type a list of operands meets at — a binary operator's rule, over N operands: variables decide, a
 *  REAL constant still widens (as in `int7 / 2.0`), all-constant integers fold as LINT, and the result promotes. */
export function meetOperands(lw: Lowering, operands: readonly IrExpr[], span: Span): Type | undefined {
  const variables = operands.filter((o) => o.kind !== "const")
  let type =
    variables.length > 0
      ? variables.map((o) => o.type).reduce(commonType)
      : operands.map((o) => (elemOf(o.type)?.family === "int" ? elementaryRef("LINT") : o.type)).reduce(commonType)
  for (const o of operands) if (o.kind === "const" && elemOf(o.type)?.family === "real") type = commonType(type, o.type)
  if (type === UNKNOWN) return lw.bail("type-unknown", "the arguments have no common type", span)
  return promoteForRuntime(type)
}
