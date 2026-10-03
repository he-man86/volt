/**
 * THE COMPILER'S BUILT-IN RESULT TYPES — the one home of "what type does this built-in hand back" (openspec
 * frontend-conformance design.md P3 "1.6 in full", §3.2). Two kinds of answer:
 *
 *   FIXED    a built-in whose result does not depend on its arguments — `BUILTIN_RESULT`, data. The reference catalog
 *            (`reference/reference.ts`) reads its hover text's return type from here; there is no second table;
 *   RULES    a built-in whose result is a function of its arguments' types — the one-argument math functions, EXPT,
 *            TwinCAT's `__XADD`, and `__POSITION` named bare. Inference (`infer.ts`) infers the arguments and asks here.
 *
 * A conversion's result (`INT_TO_REAL`, `TO_REAL`) is derived, not listed: `parseConversionName` names it.
 */
import { CODESYS_ONLY_KEYWORDS, type Dialect, type Target } from "../syntax/index.js"
import { isAssignable } from "./compat.js"
import { CODESYS_ONLY_TYPES } from "./elementary.js"
import { elementaryTypeOn, isElementaryTypeName } from "./platform.js"
import { integerOfWidth } from "./width.js"
import { DEFAULT_STRING_LENGTH } from "./defaults.js"
import { elementaryRef, elementaryTypeRef, elemOf, UNKNOWN, type Type } from "./type.js"
import { conversionSides, parseConversionName } from "./conversion-name.js"
import { REAL_LITERAL_TYPE } from "./literal.js"

/**
 * THE COMPILER'S OWN NAMES — the operators and the IEC standard functions every project has without referencing a
 * library (upper-case). The one home of the set: the bare-name search order asks it (`names.ts` `resolveBareName`), and
 * the reference catalog (`reference/reference.ts`) holds the hover text of exactly these names and refuses any other. A
 * LIBRARY'S element is never here — not Standard's LEN or TON: it exists only where a project references its library,
 * and resolves through that library's materialized declaration.
 *
 * `CALC` is the instruction-list conditional call, which CODESYS's ST parser knows too: `calc : INT;` is a CALC whose
 * `(` is missing, not an undefined name (`ilc_calc_*`). It compiles in no form.
 */
export const BUILTIN_OPERATOR_NAMES: ReadonlySet<string> = new Set([
  // boolean / bitwise, arithmetic, size
  "AND", "OR", "XOR", "NOT", "AND_THEN", "OR_ELSE", "ADD", "SUB", "MUL", "DIV", "MOD", "MOVE", "INDEXOF", "SIZEOF", "XSIZEOF",
  // shift / rotate, comparison (function form)
  "SHL", "SHR", "ROL", "ROR", "GT", "LT", "GE", "LE", "EQ", "NE",
  // address, math
  "ADR", "BITADR", "LN", "LOG", "EXP", "EXPT", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN",
  // system operators
  "CALC", "__NEW", "__DELETE", "__ISVALIDREF", "__QUERYINTERFACE", "__QUERYPOINTER", "__TRY", "__CATCH", "__FINALLY", "__ENDTRY",
  "__VARINFO", "__POSITION", "__POUNAME", "__CURRENTTASK", "__COMPARE_AND_SWAP", "__XADD", "__POOL", "TEST_AND_SET", "INI",
  // the IEC standard functions the compiler provides, and the array bounds
  "ABS", "SQRT", "SEL", "MUX", "MIN", "MAX", "LIMIT", "TRUNC", "TRUNC_INT", "UPPER_BOUND", "LOWER_BOUND",
])

/**
 * The compiler-provided names nobody declares: `THIS`/`SUPER` (the instance and its base), `IoConfig_Globals` (the
 * generated I/O-mapping list) and `TYPE_CLASS` (the system enum of `__VARINFO`). Upper-case.
 */
export const COMPILER_IMPLICITS: ReadonlySet<string> = new Set(["THIS", "SUPER", "IOCONFIG_GLOBALS", "TYPE_CLASS"])

/** What kind of compiler-provided name a bare name is (`builtinName`). */
export type BuiltinName = "system-operator" | "conversion" | "implicit" | "operator" | "type"

/**
 * `name` as one of the compiler's own names in `dialect`, or undefined. A `__` name is a system operator — and none of the
 * CODESYS-only names (`XSIZEOF` too) is one on TwinCAT, which has never heard of them ("Identifier '__POSITION' not defined",
 * `syntax/lex/vocabulary.ts`). A conversion is only as real as the types it names: `DATE_TO_LDATE` is no TwinCAT
 * operator, LDATE being no TwinCAT type (`TO_LDATE` neither — the parsed conversion is asked, not the spelling).
 */
export function builtinName(name: string, dialect: Dialect | undefined): BuiltinName | undefined {
  const upper = name.toUpperCase()
  if (dialect === "twincat" && CODESYS_ONLY_KEYWORDS.has(upper)) return undefined
  if (upper.startsWith("__")) return "system-operator"
  const conversion = conversionSides(name)
  if (conversion !== undefined)
    return [conversion.to, conversion.from].every((n) => n === undefined || !(dialect === "twincat" && CODESYS_ONLY_TYPES.has(n)))
      ? "conversion"
      : undefined
  if (COMPILER_IMPLICITS.has(upper)) return "implicit"
  if (BUILTIN_OPERATOR_NAMES.has(upper)) return "operator"
  return isElementaryTypeName(upper) ? "type" : undefined
}

/**
 * FIXED RESULT TYPES, measured. Without one each of these inferred UNKNOWN, which is assignable to anything, so nothing
 * downstream could see a wrong destination.
 *
 *   `__POSITION`          a STRING, and the CALL form is the only one that works: `here := __POSITION();` into a DINT is
 *                         "Cannot convert type 'STRING(INT#23)' to type 'DINT'" (`sysop_position_call_form`). The length
 *                         is the position text's own and cannot be known offline, so the plain STRING is what is claimed.
 *   `__COMPARE_AND_SWAP`  BOOL (`calls/atomic-operands.ts`, 2026-09-19).
 *   `__XADD`              DINT whatever the operand was: `__XADD(anInt, 5)` into an INT is "Cannot convert type 'DINT'
 *                         to type 'INT'" — on CODESYS (TwinCAT's is `twincatXaddResultType`).
 *   `TEST_AND_SET`        a DWORD, and the operand does not change it: `TEST_AND_SET(aBool)` into a BOOL is still "Cannot
 *                         convert type 'DWORD' to type 'BOOL'". The one fixture that
 *                         recorded this read as an OPERAND rule and is not one.
 *
 * …and each named by the compiler where its result is stored into a STRING (`types/arithmetic-results.ts`, both vendors
 * 2026-10-03, rules AR22–AR31; TwinCAT has no XSIZEOF):
 *
 *   `BITADR`              DWORD (`ar_bitadr_type`, of a BOOL located at `%MX4.3`).
 *   `__ISVALIDREF`, `__QUERYINTERFACE`, `__QUERYPOINTER`   BOOL (`ar_isvalidref_type`, `ar_queryinterface_type`,
 *                         `ar_querypointer_type`).
 *   `TRUNC`               DINT, of a REAL and of an LREAL alike; `TRUNC_INT` INT (`ar_trunc_type`, `ar_trunc_int_type`).
 *   `UPPER_BOUND`, `LOWER_BOUND`   DINT (`ar_upper_bound_type`, `ar_lower_bound_type`, of an `ARRAY[*]` in-out).
 *   `XSIZEOF`             the platform's unsigned integer, `__UXINT` — ULINT on the 64-bit recording target
 *                         (`ar_xsizeof_type`, `cp_xsizeof`).
 *
 * EXPT has no fixed result — it is REAL when BOTH arguments are REAL, LREAL otherwise (`exptResultType`).
 */
export const BUILTIN_RESULT: ReadonlyMap<string, string> = new Map([
  ["__POSITION", "STRING"],
  ["__COMPARE_AND_SWAP", "BOOL"],
  ["__XADD", "DINT"],
  ["TEST_AND_SET", "DWORD"],
  ["BITADR", "DWORD"],
  ["__ISVALIDREF", "BOOL"],
  ["__QUERYINTERFACE", "BOOL"],
  ["__QUERYPOINTER", "BOOL"],
  ["TRUNC", "DINT"],
  ["TRUNC_INT", "INT"],
  ["UPPER_BOUND", "DINT"],
  ["LOWER_BOUND", "DINT"],
  ["XSIZEOF", "__UXINT"],
])

/**
 * A call to built-in `name` — a conversion `<X>_TO_<Y>`/`TO_<Y>` yields elementary `<Y>`; an operator with a FIXED
 * result yields that — or undefined. An operator the project's dialect does not have models NOTHING: on TwinCAT
 * `__POSITION()` is a call to a name nothing declares, not a STRING (`syntax/lex/vocabulary.ts`).
 */
export function builtinCallResult(name: string, dialect: Dialect | undefined, target: Target | undefined): Type | undefined {
  const upper = name.toUpperCase()
  const known = dialect === "twincat" && CODESYS_ONLY_KEYWORDS.has(upper) ? undefined : BUILTIN_RESULT.get(upper)
  // …and a conversion naming a type the dialect lacks is no operator either (`builtinName`): `BOOL_TO_LDATE(v)` on TwinCAT is
  // "Cannot convert type 'Unknown type: 'BOOL_TO_LDATE(v)'' to type 'LDATE'" (`xp_bool_to_ldate`, 2026-10-03), not an LDATE
  const sides = conversionSides(name)
  const inDialect = sides === undefined || [sides.to, sides.from].every((n) => n === undefined || !(dialect === "twincat" && CODESYS_ONLY_TYPES.has(n)))
  const conversion = inDialect ? parseConversionName(name, target) : undefined
  const modeled = conversion?.to.name ?? known
  if (modeled === undefined) return undefined
  // a platform integer (XSIZEOF's `__UXINT`) is the target's; on an unknown target it has no facts — no result
  const elem = elementaryTypeOn(modeled, target)
  return elem === undefined ? undefined : elementaryTypeRef(elem)
}

/**
 * THE BUILT-INS THAT HAND BACK AN ARGUMENT'S OWN TYPE, and which argument: the shifts and rotates their first (the
 * operand, not the count), ABS and MOVE their one. Measured into a STRING on both vendors (`types/arithmetic-results.ts`,
 * 2026-10-03): `SHL`/`SHR`/`ROL`/`ROR` of each of the twelve integers and bit strings name that very type — `SHL(aSint, n)`
 * is a SINT, `ROR(aWord, n)` a WORD, never promoted (`ar_<op>_<type>_type`, rule AR10); `ABS` of a SINT, INT, UINT, BYTE,
 * REAL and LREAL, and `MOVE` of a SINT, BYTE, REAL and TIME, likewise (`ar_abs_type`, `ar_move_type`, rule AR29).
 */
export const ARGUMENT_TYPED: ReadonlyMap<string, number> = new Map([
  ["SHL", 0],
  ["SHR", 0],
  ["ROL", 0],
  ["ROR", 0],
  ["ABS", 0],
  ["MOVE", 0],
])

/**
 * THE SELECTION FUNCTIONS' VALUE ARGUMENTS — the ones that meet (`arith/checked` `checkedMeetType`) into the result, each
 * converting into it: every argument of MIN, MAX and LIMIT, SEL's two after the selector, MUX's after the index. Undefined
 * for any other name. Measured over mixed pairs in both orders (`ar_limit_mixed_types`, `ar_sel_mixed_types`,
 * `ar_mux_mixed_types`, both vendors 2026-10-03, rules AR13/AR14): LIMIT/SEL/MUX of an INT and a UINT is INT with a sign
 * change on every UINT argument, of a LINT and a REAL is REAL with the LINT's loss warning, of two BYTEs USINT — the MIN and
 * MAX rule (`operators/selection.ts`, `ar_minmax_bitstring_types`).
 */
export function selectionValueArguments<T>(name: string, args: readonly T[]): readonly T[] | undefined {
  switch (name.toUpperCase()) {
    case "MIN":
    case "MAX":
    case "LIMIT":
      return args
    case "SEL":
    case "MUX":
      return args.slice(1)
    default:
      return undefined
  }
}

/**
 * `TIME()` AND `LTIME()` — a type NAME called with no argument is the clock read, of that type (`cs_clock_reads`; named by
 * the compiler in `ar_time_call`, `ar_ltime_call`, both vendors 2026-10-03, rule AR31). The two measured; any other type
 * name called bare is no such read.
 */
export function clockCallResult(name: string, argCount: number): Type | undefined {
  const upper = name.toUpperCase()
  return argCount === 0 && (upper === "TIME" || upper === "LTIME") ? elementaryRef(upper) : undefined
}

/**
 * SIZEOF'S TYPE IS THE SMALLEST UNSIGNED INTEGER THAT HOLDS THE SIZE — `SIZEOF(anInt)` (2) and `SIZEOF(LINT)` (8) are USINT
 * and `SIZEOF` of a 100000-byte array UDINT, on both vendors (`ar_sizeof_type`, 2026-10-03, rule AR23); the steps are where
 * the width runs out — 255 bytes USINT, 256 and 65535 UINT, 65536 UDINT (`ar_sizeof_width_edges`). `bytes` is the size,
 * when it is known (`scalarStorageBytes`).
 */
export function sizeofResultType(bytes: bigint): Type {
  for (const bits of [8, 16, 32, 64]) if (bytes < 1n << BigInt(bits)) return elementaryTypeRef(integerOfWidth(bits, false))
  return UNKNOWN
}

/**
 * The bytes a value of `t` occupies where no layout question arises — an elementary type (a STRING its capacity plus the
 * terminator, `mem_sizeof_struct_mixed` 81 for a sizeless one; a WSTRING twice that — but a stated length that did not
 * fold has no size), or an array of such with every bound folded (elements are contiguous). Undefined for a struct, an FB, a pointer, a BIT or anything else whose size the
 * memory model owns (the transpiler's `lower/bytes`).
 */
export function scalarStorageBytes(t: Type): bigint | undefined {
  if (t.kind === "array") {
    const element = scalarStorageBytes(t.element)
    if (element === undefined || t.bounds === undefined) return undefined
    return t.bounds.reduce((n, b) => n * (b.upper - b.lower + 1n), element)
  }
  if (t.kind !== "elementary") return undefined
  const e = t.elem
  if (e.family === "string" && t.unfoldedLength === true) return undefined
  if (e.family === "string") return BigInt((t.length ?? DEFAULT_STRING_LENGTH) + 1) * (e.name === "WSTRING" ? 2n : 1n)
  if (e.family === "bool") return 1n
  return e.bits % 8 === 0 ? BigInt(e.bits / 8) : undefined
}

/**
 * `__POSITION` HAS A VALUE WITHOUT ITS PARENTHESES. Every other intrinsic named bare is a reference to a function and
 * has no type; this one is the source position, and CODESYS types it even where the statement around it is broken —
 * `here : DINT := __POSITION;` answers "Cannot convert type 'STRING(INT#13)' to type 'DINT'" (`sysop_position_initializer`).
 * The LENGTH is the position text's own and cannot be known offline. …on CODESYS. TwinCAT has no `__POSITION` at all
 * and answers "Identifier '__POSITION' not defined", so there the name is an ordinary identifier that resolves nowhere.
 */
export function bareBuiltinType(name: string, dialect: Dialect | undefined): Type | undefined {
  return name.toUpperCase() === "__POSITION" && dialect !== "twincat" ? elementaryRef("STRING") : undefined
}

/** The one-argument math functions whose result IS their argument's real type (measured — `mathResultType`). */
export const MATH_ARG_TYPED: ReadonlySet<string> = new Set(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"])

/**
 * A ONE-ARGUMENT MATH FUNCTION HANDS BACK THE REAL IT WAS GIVEN. All ten, both ways (`mathret_*`, 2026-09-21):
 * `rv : REAL := SQRT(aReal)` is silent and `SQRT(anLreal)` warns about the mantissa, and the same for LN, LOG, EXP, SIN,
 * COS, TAN, ASIN, ACOS and ATAN. EXPT is the same rule with two arguments (`exptResultType`).
 *
 * ANYTHING THAT IS NOT A REAL COMES BACK LREAL. An untyped real literal has no standalone type here — it takes one from
 * its context, and its context in a call is the function, which reads it as the default: `SQRT(16.0)` is an LREAL, which
 * is why `rv : REAL := SQRT(16.0)` warns (`cfold_sqrt`, `cfold_expt`). An INTEGER argument: measured 2026-09-21 on both
 * live IDEs, all ten functions with an INT argument (`mathret_*_int`) — every one is "Implicit conversion from 'LREAL'
 * to 'REAL'". So the rule is the argument's own REAL type, or LREAL.
 *
 * `arg` is the argument's inferred type; `argIsLiteral` whether it is written as a literal. Undefined when neither
 * decides (an unknown non-literal argument).
 */
export function mathResultType(arg: Type, argIsLiteral: boolean): Type | undefined {
  if (arg.kind === "elementary" && arg.elem.family === "real") return arg
  if (arg.kind !== "unknown" || argIsLiteral) return elementaryRef(REAL_LITERAL_TYPE)
  return undefined
}

/**
 * EXPT's type: REAL only when BOTH arguments are REAL, LREAL otherwise. Measured twice — by conformance (`cc_expt_*`:
 * `real := EXPT(real, real)` is silent, EXPT(INT, INT), EXPT(REAL, INT) and EXPT(LREAL, REAL) into a REAL warn LREAL →
 * REAL) and by execution (conformance `expt_types`, `expt_mixed_width`: EXPT(REAL 3.0, INT 20) is 3486784401, which
 * float32 cannot hold).
 */
export function exptResultType(base: Type, exponent: Type): Type {
  const real32 = (t: Type): boolean => elemOf(t)?.family === "real" && elemOf(t)?.bits === 32
  return real32(base) && real32(exponent) ? elementaryRef("REAL") : elementaryRef("LREAL")
}

/**
 * What EXPT's two arguments are, for its CHECKED type: REAL, NOT REAL, an integer literal (no width, but never a REAL),
 * or unknown (a REAL literal can take either width).
 */
export type ExptArgument = "real" | "not-real" | "int-literal" | "unknown"

/**
 * EXPT's checked type — `exptResultType` once both arguments are known. An unknown argument keeps it UNKNOWN. An
 * integer LITERAL counts as not-REAL: `REAL_TO_DINT(EXPT(10, n))` warns LREAL → REAL in a real project (build
 * conformance). A REAL beside an integer literal was not measured — silence rather than a guessed type.
 */
export function exptCheckedType(kinds: readonly ExptArgument[]): Type {
  if (kinds.length !== 2 || kinds.includes("unknown")) return UNKNOWN
  if (kinds.includes("real") && kinds.includes("int-literal")) return UNKNOWN
  const asType = (k: string): Type => elementaryRef(k === "real" ? "REAL" : "LINT")
  return exptResultType(asType(kinds[0]!), asType(kinds[1]!))
}

/**
 * TWINCAT'S `__XADD` HANDS BACK WHAT IT WAS GIVEN, where CODESYS's is always a DINT. The same six operand types that
 * pinned the ARGUMENT also pin the result: `res : INT := __XADD(anInt, 1)` builds clean on TwinCAT and is "Cannot
 * convert type 'DINT' to type 'INT'" on CODESYS, and a DWORD operand warns about a sign change on CODESYS alone
 * (`atomic_xadd_int`, `atomic_xadd_dword`, both recordings 2026-09-20). …and an operand it REFUSES yields no usable
 * result: `__XADD(pDint, 1)` is one error about the pointer on TwinCAT (`atomic_xadd_pointer`), not that error plus a
 * conversion complaint about what it returned. `first` is the first argument's inferred type.
 */
export function twincatXaddResultType(first: Type): Type {
  return first.kind === "elementary" && isAssignable(elementaryRef("DINT"), first) ? first : UNKNOWN
}

/**
 * WHAT AN ATOMIC INTRINSIC TAKES ITS FIRST OPERAND AS, per dialect (`calls/atomic-operands.ts`, both recordings 2026-09-19/20,
 * TwinCAT on x64), or undefined for a name that is none of them (or that the dialect lacks):
 *   `TEST_AND_SET`        a DWORD by address, on both vendors — the operand STORED into one, by the assignment rule
 *                         (`store`: refused or warned as `x : DWORD := flag` would be);
 *   `__XADD`              CODESYS takes the ADDRESS — any pointer, every other operand refused into `POINTER TO DINT`
 *                         ("Cannot convert type 'DINT' to type 'POINTER TO DINT'"); TwinCAT takes the DINT ITSELF, an
 *                         operand that does not convert into a DINT refused ("Cannot convert type 'POINTER TO DINT' to
 *                         type 'DINT'"; INT and DWORD pass — widening, and a sign crossing TwinCAT does not warn about at
 *                         an argument);
 *   `__COMPARE_AND_SWAP`  CODESYS only (TwinCAT: "Identifier '__COMPARE_AND_SWAP' not defined"), as `__XADD` with
 *                         `POINTER TO LWORD`.
 * `refuses` judges a KNOWN operand type; an unknown one is never refused.
 */
export type AtomicOperand = { type: Type; store: true } | { type: Type; store: false; refuses: (operand: Type) => boolean }

export function atomicOperand(name: string, dialect: Dialect | undefined): AtomicOperand | undefined {
  const upper = name.toUpperCase()
  if (upper === "TEST_AND_SET") return { type: elementaryRef("DWORD"), store: true }
  const pointee = upper === "__XADD" ? "DINT" : upper === "__COMPARE_AND_SWAP" ? "LWORD" : undefined
  if (pointee === undefined) return undefined
  if (dialect === "twincat") {
    if (CODESYS_ONLY_KEYWORDS.has(upper)) return undefined
    const target = elementaryRef(pointee)
    return { type: target, store: false, refuses: (t) => t.kind !== "unknown" && (t.kind !== "elementary" || !isAssignable(target, t)) }
  }
  return { type: { kind: "pointer", target: elementaryRef(pointee) }, store: false, refuses: (t) => t.kind !== "pointer" && t.kind !== "unknown" }
}

/**
 * `ADR(x)` IS A POINTER TO x's TYPE and `__NEW(T)` A POINTER TO T: "Cannot convert type 'POINTER TO INT' to type 'STRING'",
 * 'POINTER TO ARRAY [0..3] OF BYTE', 'POINTER TO DUT_LANG_ar_new_target' (`ar_adr_type`, `ar_new_type`, both vendors
 * 2026-10-03, rules AR22/AR24). `target` is what is addressed or created; an unknown one leaves the pointer unknown.
 */
export function pointerTo(target: Type): Type {
  return target.kind === "unknown" ? UNKNOWN : { kind: "pointer", target }
}
